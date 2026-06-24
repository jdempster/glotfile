import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, nextTick, defineComponent } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import DetailPanel from "./DetailPanel.vue";
import type { KeyEntry } from "@/types.js";

// DetailPanel's tooltips need a TooltipProvider ancestor — wrap, then drill back to the panel.
function mountPanel(props: { keyName: string; entry: KeyEntry; lintIgnore?: string[] }) {
  return mount(TooltipProvider, {
    slots: { default: () => h(DetailPanel, props) },
  }).findComponent(DetailPanel);
}

// A reactive harness so tests can swap props (e.g. simulate a live-reload that
// replaces the entry object) — setProps only works on a mounted root, not a child.
const Harness = defineComponent({
  props: { keyName: { type: String, required: true }, entry: { type: Object, required: true } },
  setup(props) {
    return () => h(TooltipProvider, null, { default: () => h(DetailPanel, { keyName: props.keyName, entry: props.entry }) });
  },
});

vi.mock("@/api.js", () => ({
  patchKey: vi.fn(() => Promise.resolve({})),
  uploadScreenshot: vi.fn(() => Promise.resolve({})),
  deleteScreenshot: vi.fn(() => Promise.resolve({})),
  convertToPlural: vi.fn(() => Promise.resolve({})),
  convertToScalar: vi.fn(() => Promise.resolve({})),
  buildContextStream: vi.fn(async function*() { yield { type: "done", requested: 0, written: 0, errors: [] }; }),
  keyUsage: vi.fn(() => Promise.resolve({ indexed: false, count: 0, refs: [] })),
  suppressFinding: vi.fn(() => Promise.resolve({})),
  unsuppressFinding: vi.fn(() => Promise.resolve({})),
  addLintIgnore: vi.fn(() => Promise.resolve({})),
  removeLintIgnore: vi.fn(() => Promise.resolve({})),
}));

import { convertToPlural, convertToScalar, keyUsage, patchKey, suppressFinding, unsuppressFinding, addLintIgnore, removeLintIgnore, type KeyUsage } from "@/api.js";

const scalarEntry: KeyEntry = {
  values: { en: { value: "Home", state: "source" } },
};

const pluralEntry: KeyEntry = {
  plural: { arg: "count" },
  values: { en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" } },
};

describe("DetailPanel plural conversion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults the count arg to 'count' for a scalar key", async () => {
    const w = mountPanel({ keyName: "home.title", entry: scalarEntry });
    const makePlural = w.findAll("button").find((b) => b.text() === "Make plural")!;
    await makePlural.trigger("click");
    await flushPromises();

    expect(convertToPlural).toHaveBeenCalledWith("home.title", "count");
  });

  it("converts a plural key back to scalar", async () => {
    const w = mountPanel({ keyName: "cart.items", entry: pluralEntry });
    const makeScalar = w.findAll("button").find((b) => b.text() === "Make single")!;
    await makeScalar.trigger("click");
    await flushPromises();

    expect(convertToScalar).toHaveBeenCalledWith("cart.items");
    expect(w.emitted("changed")).toBeTruthy();
  });
});

describe("DetailPanel usage links", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it("renders an exact usage ref as a VS Code editor link", async () => {
    vi.mocked(keyUsage).mockResolvedValue({
      indexed: true, project: "proj", count: 1,
      refs: [{ file: "app/Foo.php", abs: "/Users/me/app/Foo.php", line: 12, col: 5, scanner: "laravel" }],
      prefixCount: 0, prefixRefs: [],
    } as KeyUsage);
    const w = mountPanel({ keyName: "auth.login", entry: scalarEntry });
    await flushPromises();
    const link = w.findAll("a").find((a) => a.attributes("href")?.startsWith("vscode://"));
    expect(link).toBeTruthy();
    expect(link!.attributes("href")).toBe("vscode://file/Users/me/app/Foo.php:12:5");
  });

  it("makes the filename itself an editor link, opening at its first usage", async () => {
    vi.mocked(keyUsage).mockResolvedValue({
      indexed: true, project: "proj", count: 2,
      refs: [
        { file: "app/Foo.php", abs: "/Users/me/app/Foo.php", line: 12, col: 5, scanner: "laravel" },
        { file: "app/Foo.php", abs: "/Users/me/app/Foo.php", line: 30, col: 1, scanner: "laravel" },
      ],
      prefixCount: 0, prefixRefs: [],
    } as KeyUsage);
    const w = mountPanel({ keyName: "auth.login", entry: scalarEntry });
    await flushPromises();
    const fileLink = w.findAll("a").find((a) => a.text().includes("Foo.php"));
    expect(fileLink).toBeTruthy();
    // Opens at the first (lowest-line) occurrence.
    expect(fileLink!.attributes("href")).toBe("vscode://file/Users/me/app/Foo.php:12:5");
  });

  it("shows prefix matches as 'Possible usage' and does not flag the key unused", async () => {
    vi.mocked(keyUsage).mockResolvedValue({
      indexed: true, project: "proj", count: 0, refs: [],
      prefixCount: 1,
      prefixRefs: [{ file: "app/Bar.php", abs: "/Users/me/app/Bar.php", line: 7, col: 9, scanner: "laravel", prefix: "messages." }],
    } as KeyUsage);
    const w = mountPanel({ keyName: "messages.welcome", entry: scalarEntry });
    await flushPromises();
    expect(w.text()).toContain("Possible usage");
    expect(w.text()).toContain("messages.*");
    expect(w.text()).not.toContain("may be unused");
  });
});

describe("DetailPanel live-reload edit safety", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves an in-progress context edit when a live-reload replaces the entry object", async () => {
    const w = mount(Harness, {
      props: { keyName: "home.title", entry: { values: { en: { value: "Home", state: "source" } }, context: "old" } },
    });
    await nextTick();
    await w.find("#detail-context").setValue("my unsaved edit");
    // Live-reload: same key, brand-new entry object reference (state swapped wholesale).
    await w.setProps({ keyName: "home.title", entry: { values: { en: { value: "Home", state: "source" } }, context: "old" } });
    await nextTick();
    expect((w.find("#detail-context").element as HTMLTextAreaElement).value).toBe("my unsaved edit");
  });

  it("resets the form when navigating to a different key", async () => {
    const w = mount(Harness, {
      props: { keyName: "a", entry: { values: {}, context: "A ctx" } },
    });
    await nextTick();
    await w.setProps({ keyName: "b", entry: { values: {}, context: "B ctx" } });
    await nextTick();
    expect((w.find("#detail-context").element as HTMLTextAreaElement).value).toBe("B ctx");
  });

  it("syncs an untouched form to new server data on live-reload (e.g. suggested context)", async () => {
    const w = mount(Harness, {
      props: { keyName: "home.title", entry: { values: {}, context: "" } },
    });
    await nextTick();
    // No user edit; an out-of-band write adds context for the same key.
    await w.setProps({ keyName: "home.title", entry: { values: {}, context: "suggested context" } });
    await nextTick();
    expect((w.find("#detail-context").element as HTMLTextAreaElement).value).toBe("suggested context");
  });
});

describe("DetailPanel lint ignores", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a whole-key lint-ignore note with the matching glob", async () => {
    const w = mountPanel({ keyName: "legal.terms", entry: scalarEntry, lintIgnore: ["legal.*", "debug.*"] });
    await flushPromises();
    expect(w.text()).toContain("Lint ignore");
    expect(w.text()).toContain("legal.*");
    // A non-matching glob isn't shown.
    expect(w.text()).not.toContain("debug.*");
  });

  it("offers 'Ignore this key' when the key has issues and isn't ignored, and adds the exact key", async () => {
    const w = mount(TooltipProvider, {
      slots: { default: () => h(DetailPanel, {
        keyName: "home.title",
        entry: scalarEntry,
        issues: [{ key: "home.title", locale: "fr", check: "identical", message: "Identical to the source text" }],
      }) },
    }).findComponent(DetailPanel);
    await flushPromises();
    await w.get('[data-testid="ignore-key"]').trigger("click");
    await flushPromises();
    expect(addLintIgnore).toHaveBeenCalledWith("home.title");
    expect(w.emitted("changed")).toBeTruthy();
  });

  it("removes a matching ignore glob from the panel", async () => {
    const w = mountPanel({ keyName: "legal.terms", entry: scalarEntry, lintIgnore: ["legal.*"] });
    await flushPromises();
    expect(w.text()).toContain("legal.*");
    await w.find('[aria-label="Stop ignoring legal.*"]').trigger("click");
    await flushPromises();
    expect(removeLintIgnore).toHaveBeenCalledWith("legal.*");
  });

  it("makes every issue dismissable, including error-level placeholder/glossary", async () => {
    const w = mount(TooltipProvider, {
      slots: { default: () => h(DetailPanel, {
        keyName: "greeting",
        entry: scalarEntry,
        issues: [
          { key: "greeting", locale: "fr", check: "placeholder", message: "drops {name}" },
          { key: "greeting", locale: "de", check: "glossary", message: "missing term" },
        ],
      }) },
    }).findComponent(DetailPanel);
    await flushPromises();

    const dismissBtns = w.findAll('[aria-label="Dismiss until the source changes"]');
    expect(dismissBtns).toHaveLength(2);

    await dismissBtns[0]!.trigger("click");
    await flushPromises();
    expect(suppressFinding).toHaveBeenCalledWith("greeting", "placeholder-mismatch", "fr");
  });

  it("lists dismissed findings and restores one on click", async () => {
    const entry: KeyEntry = {
      values: { en: { value: "Home", state: "source" } },
      suppressions: [{ rule: "spelling", locale: "fr", source: "abc123" }],
    };
    const w = mountPanel({ keyName: "home.title", entry });
    await flushPromises();
    expect(w.text()).toContain("1 dismissed");

    // Dismissed findings are collapsed by default — expand to reveal them.
    await w.find('[aria-expanded]').trigger("click");
    expect(w.text()).toContain("FR");

    await w.find('[aria-label="Restore this check"]').trigger("click");
    await flushPromises();
    expect(unsuppressFinding).toHaveBeenCalledWith("home.title", "spelling", "fr");
    expect(w.emitted("changed")).toBeTruthy();
  });
});

describe("DetailPanel metadata save", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears a previously-filled context by sending empty values, not undefined", async () => {
    const w = mountPanel({
      keyName: "home.title",
      entry: { values: { en: { value: "Home", state: "source" } }, context: "old context" },
    });
    await nextTick();

    await w.find("#detail-context").setValue("");
    await w.findAll("button").find((b) => b.text() === "Save details")!.trigger("click");
    await flushPromises();

    expect(patchKey).toHaveBeenCalledWith("home.title", {
      metadata: { context: "", tags: [], maxLength: null },
    });
  });
});
