import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import OutputEditor from "./OutputEditor.vue";
import { Select } from "@/components/ui/select";
import type { OutputForm } from "./config-form.js";

const base = { formatIndent: 2, formatFinalNewline: true, locales: ["en", "fr", "de"], adapters: ["flutter-arb", "laravel-php", "vue-i18n-json"] };

// OutputEditor's tooltips need a TooltipProvider ancestor — wrap, then drill back to the editor.
function mountEditor(output: OutputForm) {
  const wrapper = mount(TooltipProvider, {
    slots: { default: () => h(OutputEditor, { output, ...base }) },
  });
  return wrapper.findComponent(OutputEditor);
}

// Expand the panel where localeCase/localeMap live (collapsed by default).
async function expand(wrapper: ReturnType<typeof mountEditor>) {
  await wrapper.get('[aria-label="Expand options"]').trigger("click");
  await nextTick();
}

// Find the Select whose subtree contains the given aria-labelled trigger.
function selectByLabel(wrapper: ReturnType<typeof mountEditor>, label: string) {
  return wrapper.findAllComponents(Select).find((s) => s.find(`[aria-label="${label}"]`).exists());
}

function lastEmitted(wrapper: ReturnType<typeof mountEditor>): OutputForm {
  const events = wrapper.emitted("update:output")!;
  return events[events.length - 1]![0] as OutputForm;
}

describe("OutputEditor localeCase", () => {
  it("labels the Default option with the adapter convention (ARB)", async () => {
    const wrapper = mountEditor({ adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    await expand(wrapper);
    expect(wrapper.text()).toContain("Default (Flutter: en_US)");
  });

  it("labels the Default option with en-us for lower-hyphen adapters", async () => {
    const wrapper = mountEditor({ adapter: "vue-i18n-json", path: "locales/{locale}.json" });
    await expand(wrapper);
    expect(wrapper.text()).toContain("Default (en-us)");
  });

  it("labels the Default option with the Laravel convention (en_US)", async () => {
    const wrapper = mountEditor({ adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    await expand(wrapper);
    expect(wrapper.text()).toContain("Default (Laravel: en_US)");
  });

  it("labels the Default option with the Angular convention (en-US)", async () => {
    const wrapper = mountEditor({ adapter: "angular-xliff", path: "src/locale/messages.{locale}.xlf" });
    await expand(wrapper);
    expect(wrapper.text()).toContain("Default (Angular: en-US)");
  });

  it("emits the chosen localeCase value", async () => {
    const wrapper = mountEditor({ adapter: "laravel-php", path: "p/{locale}" });
    await expand(wrapper);
    await selectByLabel(wrapper, "Locale code format")!.vm.$emit("update:modelValue", "bcp47-hyphen");
    expect(lastEmitted(wrapper).localeCase).toBe("bcp47-hyphen");
  });

  it("clears localeCase when Default is chosen", async () => {
    const wrapper = mountEditor({ adapter: "laravel-php", path: "p/{locale}", localeCase: "bcp47-hyphen" });
    await expand(wrapper);
    await selectByLabel(wrapper, "Locale code format")!.vm.$emit("update:modelValue", "default");
    expect(lastEmitted(wrapper).localeCase).toBeUndefined();
  });
});

describe("OutputEditor localeMap", () => {
  it("renders a row per mapped locale", async () => {
    const wrapper = mountEditor({ adapter: "laravel-php", path: "p/{locale}", localeMap: { fr: "fr_FR" } });
    await expand(wrapper);
    expect(wrapper.find('input[aria-label="Export code for fr"]').exists()).toBe(true);
    expect((wrapper.get('input[aria-label="Export code for fr"]').element as HTMLInputElement).value).toBe("fr_FR");
  });

  it("emits an updated token when the input changes", async () => {
    const wrapper = mountEditor({ adapter: "laravel-php", path: "p/{locale}", localeMap: { fr: "fr_FR" } });
    await expand(wrapper);
    await wrapper.get('input[aria-label="Export code for fr"]').setValue("fr_CA");
    expect(lastEmitted(wrapper).localeMap).toEqual({ fr: "fr_CA" });
  });

  it("removes a mapping when its delete button is clicked", async () => {
    const wrapper = mountEditor({ adapter: "laravel-php", path: "p/{locale}", localeMap: { fr: "fr_FR", de: "de_DE" } });
    await expand(wrapper);
    await wrapper.get('[aria-label="Remove override fr"]').trigger("click");
    expect(lastEmitted(wrapper).localeMap).toEqual({ de: "de_DE" });
  });

  it("seeds a new mapping with the locale code when added", async () => {
    const wrapper = mountEditor({ adapter: "laravel-php", path: "p/{locale}" });
    await expand(wrapper);
    await selectByLabel(wrapper, "Add locale override")!.vm.$emit("update:modelValue", "de");
    expect(lastEmitted(wrapper).localeMap).toEqual({ de: "de" });
  });
});

describe("OutputEditor angular-xliff", () => {
  it("shows a friendly label and only the options the adapter honours", async () => {
    const wrapper = mountEditor({ adapter: "angular-xliff", path: "src/locale/messages.{locale}.xlf" });
    expect(wrapper.text()).toContain("Angular XLIFF");
    await expand(wrapper);
    expect(wrapper.text()).toContain("Empty keys");
    // Fixed XML layout: indent / final-newline overrides don't apply.
    expect(wrapper.text()).not.toContain("Indent");
    expect(wrapper.text()).not.toContain("Final newline");
  });
});

describe("OutputEditor rails-yaml", () => {
  it("shows a friendly label and the YAML formatting options", async () => {
    const wrapper = mountEditor({ adapter: "rails-yaml", path: "config/locales/{locale}.yml" });
    expect(wrapper.text()).toContain("Rails YAML");
    await expand(wrapper);
    expect(wrapper.text()).toContain("Empty keys");
    expect(wrapper.text()).toContain("Indent");
    expect(wrapper.text()).toContain("Final newline");
    expect(wrapper.text()).toContain("Default (Rails: en-US)");
  });
});
