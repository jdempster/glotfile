import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, nextTick, defineComponent } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import KeyRow from "./KeyRow.vue";
import TranslationRow from "./TranslationRow.vue";
import { translateStream, bulkMeta, bulkClear, bulkState } from "@/api.js";
import { copyText } from "@/lib/utils";
import type { Issue, KeyEntry } from "@/types.js";

// A controllable async-generator stand-in for translateStream: yields a "start"
// event, blocks on a gate, then yields "done" once the test releases it — so the
// in-flight indicator/filling hints can be asserted mid-run.
function deferredStream(total = 1, locale = "de") {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  async function* gen() {
    yield { type: "start" as const, total, locales: [{ locale, total }] };
    await gate;
    yield { type: "done" as const, written: total, errors: [] };
  }
  return { gen, release };
}

// A generator that never completes — keeps translating* true for the assertion.
async function* hangingStream() {
  await new Promise(() => {});
}

// KeyRow's TranslationRows use Tooltip, which needs a TooltipProvider ancestor.
function mountInProvider(props: Record<string, unknown>) {
  return mount(TooltipProvider, {
    slots: { default: () => h(KeyRow, props) },
  });
}

vi.mock("@/api.js", () => ({
  patchKey: vi.fn(() => Promise.resolve({})),
  deleteKey: vi.fn(() => Promise.resolve({})),
  setValue: vi.fn(() => Promise.resolve({})),
  setState: vi.fn(() => Promise.resolve({})),
  // eslint-disable-next-line require-yield
  translateStream: vi.fn(async function* () {}),
  bulkMeta: vi.fn(() => Promise.resolve({ updated: 1 })),
  bulkClear: vi.fn(() => Promise.resolve({ updated: 1 })),
  bulkState: vi.fn(() => Promise.resolve({ updated: 1 })),
}));

vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, copyText: vi.fn(() => Promise.resolve()) };
});

const entry: KeyEntry = {
  tags: ["nav"],
  values: {
    en: { value: "Home", state: "source" },
    fr: { value: "Accueil", state: "reviewed" },
    de: { value: "", state: "needs-review" },
  },
};

describe("KeyRow issue badge", () => {
  const issues: Issue[] = [
    { key: "home.title", locale: "fr", check: "placeholder", message: "Placeholder mismatch: missing name" },
  ];

  it("shows an issue count badge when issues are present", () => {
    const w = mountInProvider({
      keyName: "home.title", entry, sourceLocale: "en", locales: ["en", "fr", "de"], selected: false, issues,
    });
    const badge = w.find('[data-testid="issue-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("1");
  });

  it("renders no badge when there are no issues", () => {
    const w = mountInProvider({
      keyName: "home.title", entry, sourceLocale: "en", locales: ["en", "fr", "de"], selected: false, issues: [],
    });
    expect(w.find('[data-testid="issue-badge"]').exists()).toBe(false);
  });
});

describe("KeyRow translate-missing indicator", () => {
  it("shows an in-flight indicator while the translate stream is running, then clears it", async () => {
    const { gen, release } = deferredStream(1, "de");
    vi.mocked(translateStream).mockReturnValueOnce(gen());

    const w = mountInProvider({
      keyName: "home.title", entry, sourceLocale: "en", locales: ["en", "fr", "de"], selected: false,
    });
    const row = w.findComponent(KeyRow);

    expect(row.find('[data-testid="translating-missing"]').exists()).toBe(false);

    // Invoke the dropdown action directly — the menu portal closes on select, so
    // the row-level indicator is the only feedback during the pending call.
    (row.vm as unknown as { translateMissing: () => Promise<void> }).translateMissing();
    await flushPromises();
    expect(row.find('[data-testid="translating-missing"]').exists()).toBe(true);
    expect(row.find('[data-testid="translating-missing"]').text()).toContain("Translating");
    // The in-button progress bar is present while the stream runs.
    expect(row.find('[data-testid="translate-missing-progress"]').exists()).toBe(true);

    // Only the empty `de` target is being filled — `fr` already has a value, `en` is source.
    expect(row.findAll('[data-testid="filling-hint"]')).toHaveLength(1);

    release();
    await flushPromises();
    expect(row.find('[data-testid="translating-missing"]').exists()).toBe(false);
    expect(row.findAll('[data-testid="filling-hint"]')).toHaveLength(0);
  });

  it("does not show the filling hint on a plural locale that already has complete forms", async () => {
    vi.mocked(translateStream).mockReturnValueOnce(hangingStream());

    // Plural key: fr has every form filled (translated); de has none (missing).
    // Plural content lives in `forms`, not the scalar `value`.
    const pluralEntry: KeyEntry = {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
        fr: { forms: { zero: "0", one: "1", two: "2", few: "f", many: "m", other: "n" }, state: "reviewed" },
        de: { forms: {}, state: "needs-review" },
      },
    };

    const w = mountInProvider({
      keyName: "cart.items", entry: pluralEntry, sourceLocale: "en", locales: ["en", "fr", "de"], selected: false,
    });
    const row = w.findComponent(KeyRow);

    (row.vm as unknown as { translateMissing: () => Promise<void> }).translateMissing();
    await nextTick();

    // Only `de` is missing — `fr`'s forms are complete, `en` is source.
    const hints = row.findAll('[data-testid="filling-hint"]');
    expect(hints).toHaveLength(1);
  });
});

describe("KeyRow retranslate-stale indicator", () => {
  // A stale cell: holds a value AND is needs-review.
  const staleEntry: KeyEntry = {
    values: {
      en: { value: "Home", state: "source" },
      fr: { value: "Accueil", state: "needs-review" },
    },
  };
  // What that cell looks like after a force re-translation lands: machine state,
  // no longer stale — so staleTargetLocales() now returns [].
  const freshEntry: KeyEntry = {
    values: {
      en: { value: "Home", state: "source" },
      fr: { value: "Salut", state: "machine" },
    },
  };

  // A reactive wrapper so the test can swap `entry` mid-run, mimicking the
  // parent's reload after each progress event emits "changed".
  const Wrapper = defineComponent({
    props: { entry: { type: Object, required: true } },
    setup(props) {
      return () => h(TooltipProvider, null, {
        default: () => h(KeyRow, {
          keyName: "home.title", entry: props.entry, sourceLocale: "en", locales: ["en", "fr"], selected: false,
        }),
      });
    },
  });

  it("keeps the in-flight progress bar visible after the value stops being stale mid-run", async () => {
    const { gen, release } = deferredStream(1, "fr");
    vi.mocked(translateStream).mockReturnValueOnce(gen());

    const w = mount(Wrapper, { props: { entry: staleEntry } });
    const row = w.findComponent(KeyRow);
    expect(row.find('[data-testid="retranslate-stale-btn"]').exists()).toBe(true);

    (row.vm as unknown as { retranslateStale: () => Promise<void> }).retranslateStale();
    await flushPromises();
    // The in-button progress bar shows while the stream runs.
    expect(row.find('[data-testid="retranslate-stale-progress"]').exists()).toBe(true);

    // The force re-translation lands and the parent reloads: fr is now `machine`,
    // so it is no longer stale. The run is still in flight — the progress bar must
    // stay visible, not vanish along with the (now-empty) stale-locale list.
    await w.setProps({ entry: freshEntry });
    expect(row.find('[data-testid="retranslate-stale-progress"]').exists()).toBe(true);

    release();
    await flushPromises();
  });
});

describe("KeyRow", () => {
  it("renders the key name and a TranslationRow per locale in multilingual mode", () => {
    const w = mountInProvider({
      keyName: "home.title",
      entry,
      sourceLocale: "en",
      locales: ["en", "fr", "de"],
      selected: false,
    });
    expect(w.text()).toContain("home.title");
    expect(w.findAllComponents(TranslationRow)).toHaveLength(3);
  });

  it("renders exactly source + target in bilingual mode", () => {
    const w = mountInProvider({
      keyName: "home.title",
      entry,
      sourceLocale: "en",
      locales: ["en", "de"],
      selected: false,
    });
    const rows = w.findAllComponents(TranslationRow);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.props("locale"))).toEqual(["en", "de"]);
  });
});

describe("KeyRow bulk checkbox", () => {
  const baseProps = {
    keyName: "home.title",
    entry,
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    selected: false,
    issues: [] as Issue[],
  };

  it("emits toggle-select with the shift flag when the checkbox is clicked", async () => {
    const w = mountInProvider({ ...baseProps, checked: false });
    await w.find('[data-testid="row-select"]').trigger("click", { shiftKey: true });
    const ev = w.findComponent(KeyRow).emitted("toggle-select");
    expect(ev).toBeTruthy();
    expect(ev![0]![0]).toEqual({ shift: true });
  });

  it("does not emit select (detail open) when the checkbox is clicked", async () => {
    const w = mountInProvider({ ...baseProps, checked: false });
    await w.find('[data-testid="row-select"]').trigger("click");
    expect(w.findComponent(KeyRow).emitted("select")).toBeFalsy();
  });

  it("renders the checkbox as checked when checked=true", () => {
    const w = mountInProvider({ ...baseProps, checked: true });
    expect(w.find('[data-testid="row-select"]').attributes("aria-checked")).toBe("true");
  });
});

describe("KeyRow row click selects", () => {
  const baseProps = {
    keyName: "home.title",
    entry,
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    selected: false,
    issues: [] as Issue[],
  };

  it("emits select when the translations area (not just the key column) is clicked", async () => {
    const w = mountInProvider(baseProps);
    // A TranslationRow sits outside the left key column — clicking it must still select the row.
    await w.findAllComponents(TranslationRow)[0]!.trigger("click");
    expect(w.findComponent(KeyRow).emitted("select")).toBeTruthy();
  });

  it("emits select when a value cell editor is opened", async () => {
    const w = mountInProvider(baseProps);
    // The empty `de` cell renders a button that enters edit mode — opening it selects the row.
    await w.find('[data-testid="empty-marker"]').trigger("click");
    expect(w.findComponent(KeyRow).emitted("select")).toBeTruthy();
  });

  it("does not emit select again when clicking inside an already-open editing textarea", async () => {
    const w = mountInProvider(baseProps);
    await w.find('[data-testid="empty-marker"]').trigger("click");
    await nextTick();
    const textarea = w.find("textarea");
    expect(textarea.exists()).toBe(true);
    // Opening the editor selected the row once; clicking within the textarea must not re-select.
    const before = w.findComponent(KeyRow).emitted("select")!.length;
    await textarea.trigger("click");
    expect(w.findComponent(KeyRow).emitted("select")!.length).toBe(before);
  });
});

describe("KeyRow copy key", () => {
  const baseProps = {
    keyName: "home.title",
    entry,
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    selected: false,
    issues: [] as Issue[],
  };

  it("copies the key name and flips the button to a copied state", async () => {
    const w = mountInProvider(baseProps);
    const btn = w.find('[data-testid="copy-key"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("aria-label")).toBe("Copy key");
    await btn.trigger("click");
    await flushPromises();
    expect(copyText).toHaveBeenCalledWith("home.title");
    expect(w.find('[data-testid="copy-key"]').attributes("aria-label")).toBe("Copied");
  });

  it("does not select or toggle the row when the copy button is clicked", async () => {
    const w = mountInProvider(baseProps);
    await w.find('[data-testid="copy-key"]').trigger("click");
    const row = w.findComponent(KeyRow);
    expect(row.emitted("select")).toBeFalsy();
    expect(row.emitted("toggle-select")).toBeFalsy();
  });
});

describe("KeyRow focus key", () => {
  const baseProps = {
    keyName: "home.title",
    entry,
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    selected: false,
    issues: [] as Issue[],
  };

  it("emits focus-key with the key name when the inline focus button is clicked", async () => {
    const w = mountInProvider(baseProps);
    const btn = w.find('[data-testid="focus-key"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    const ev = w.findComponent(KeyRow).emitted("focus-key");
    expect(ev).toBeTruthy();
    expect(ev![0]).toEqual(["home.title"]);
  });

  it("does not select or toggle the row when the focus button is clicked", async () => {
    const w = mountInProvider(baseProps);
    await w.find('[data-testid="focus-key"]').trigger("click");
    const row = w.findComponent(KeyRow);
    expect(row.emitted("select")).toBeFalsy();
    expect(row.emitted("toggle-select")).toBeFalsy();
  });
});

describe("KeyRow skip-translate", () => {
  const baseProps = {
    keyName: "home.title",
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    selected: false,
    issues: [] as Issue[],
  };

  it("shows a SKIP badge when the key is flagged skip-translate", () => {
    const w = mountInProvider({ ...baseProps, entry: { ...entry, skipTranslate: true } });
    expect(w.find('[data-testid="skip-badge"]').exists()).toBe(true);
  });

  it("renders no SKIP badge for a normal key", () => {
    const w = mountInProvider({ ...baseProps, entry });
    expect(w.find('[data-testid="skip-badge"]').exists()).toBe(false);
  });

  it("toggles skip-translate via the row menu, then reloads", async () => {
    const w = mount(TooltipProvider, {
      attachTo: document.body,
      slots: { default: () => h(KeyRow, { ...baseProps, entry }) },
    });
    await w.get('[aria-label="Key actions"]').trigger("click");
    await nextTick();
    const item = document.querySelector('[data-testid="toggle-skip"]') as HTMLElement;
    expect(item).not.toBeNull();
    item.click();
    await flushPromises();
    expect(bulkMeta).toHaveBeenCalledWith(["home.title"], { skipTranslate: true });
    expect(w.findComponent(KeyRow).emitted("changed")).toBeTruthy();
  });
});

describe("KeyRow row-level status & clear actions", () => {
  const baseProps = {
    keyName: "home.title",
    entry,
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    selected: false,
    issues: [] as Issue[],
    // Multilingual scope: both targets, source excluded — mirrors the editor's bulk scope.
    scopeLocales: ["fr", "de"],
    scopeLabel: "all 2 targets",
  };

  it("exposes Mark reviewed, Mark needs-review and Clear translations in the row menu", async () => {
    const w = mount(TooltipProvider, {
      attachTo: document.body,
      slots: { default: () => h(KeyRow, baseProps) },
    });
    await w.get('[aria-label="Key actions"]').trigger("click");
    await nextTick();
    expect(document.querySelector('[data-testid="row-mark-reviewed"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="row-mark-needs-review"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="row-clear"]')).not.toBeNull();
  });

  it("marks the key's scope locales reviewed, then reloads", async () => {
    const w = mountInProvider(baseProps);
    const row = w.findComponent(KeyRow);
    await (row.vm as unknown as { markState: (s: string) => Promise<void> }).markState("reviewed");
    await flushPromises();
    expect(bulkState).toHaveBeenCalledWith(["home.title"], ["fr", "de"], "reviewed");
    expect(row.emitted("changed")).toBeTruthy();
  });

  it("clears translations for the key's scope locales, then reloads", async () => {
    const w = mountInProvider(baseProps);
    const row = w.findComponent(KeyRow);
    await (row.vm as unknown as { doClear: () => Promise<void> }).doClear();
    await flushPromises();
    expect(bulkClear).toHaveBeenCalledWith(["home.title"], ["fr", "de"]);
    expect(row.emitted("changed")).toBeTruthy();
  });
});
