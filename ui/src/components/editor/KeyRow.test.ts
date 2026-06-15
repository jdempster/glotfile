import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import KeyRow from "./KeyRow.vue";
import TranslationRow from "./TranslationRow.vue";
import { translate, bulkMeta } from "@/api.js";
import type { Issue, KeyEntry } from "@/types.js";

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
  translate: vi.fn(() => Promise.resolve({ requested: 0, written: 0, errors: [] })),
  bulkMeta: vi.fn(() => Promise.resolve({ updated: 1 })),
}));

vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
  it("shows an in-flight indicator while the translate call is pending, then clears it", async () => {
    let resolveTranslate!: (v: { requested: number; written: number; errors: [] }) => void;
    vi.mocked(translate).mockReturnValueOnce(
      new Promise((r) => {
        resolveTranslate = r;
      }),
    );

    const w = mountInProvider({
      keyName: "home.title", entry, sourceLocale: "en", locales: ["en", "fr", "de"], selected: false,
    });
    const row = w.findComponent(KeyRow);

    expect(row.find('[data-testid="translating-missing"]').exists()).toBe(false);

    // Invoke the dropdown action directly — the menu portal closes on select, so
    // the row-level indicator is the only feedback during the pending call.
    (row.vm as unknown as { translateMissing: () => Promise<void> }).translateMissing();
    await nextTick();
    expect(row.find('[data-testid="translating-missing"]').exists()).toBe(true);
    expect(row.find('[data-testid="translating-missing"]').text()).toContain("Translating");

    // Only the empty `de` target is being filled — `fr` already has a value, `en` is source.
    expect(row.findAll('[data-testid="filling-hint"]')).toHaveLength(1);

    resolveTranslate({ requested: 2, written: 2, errors: [] });
    await nextTick();
    await nextTick();
    expect(row.find('[data-testid="translating-missing"]').exists()).toBe(false);
    expect(row.findAll('[data-testid="filling-hint"]')).toHaveLength(0);
  });

  it("does not show the filling hint on a plural locale that already has complete forms", async () => {
    vi.mocked(translate).mockReturnValueOnce(new Promise(() => {}));

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
