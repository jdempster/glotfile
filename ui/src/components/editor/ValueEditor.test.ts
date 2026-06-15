import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ValueEditor from "./ValueEditor.vue";

vi.mock("@/api.js", () => ({
  patchKey: vi.fn(() => Promise.resolve({})),
  setValue: vi.fn(() => Promise.resolve({})),
}));

import { patchKey, setValue } from "@/api.js";

describe("ValueEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits a target-locale edit via setValue", async () => {
    const w = mount(ValueEditor, {
      props: { keyName: "a.key", locale: "fr", sourceLocale: "en", value: "Bonjour" },
    });
    await w.get("button").trigger("click");
    const input = w.get("textarea");
    await input.setValue("Salut");
    await input.trigger("blur");
    await flushPromises();

    expect(setValue).toHaveBeenCalledWith("a.key", "fr", "Salut");
    expect(patchKey).not.toHaveBeenCalled();
    expect(w.emitted("changed")).toBeTruthy();
  });

  it("commits a source-locale edit via patchKey({source}) and never setValue", async () => {
    const w = mount(ValueEditor, {
      props: { keyName: "a.key", locale: "en", sourceLocale: "en", value: "Hello" },
    });
    await w.get("button").trigger("click");
    const input = w.get("textarea");
    await input.setValue("Hi there");
    await input.trigger("blur");
    await flushPromises();

    expect(patchKey).toHaveBeenCalledWith("a.key", { source: "Hi there" });
    expect(setValue).not.toHaveBeenCalled();
    expect(w.emitted("changed")).toBeTruthy();
  });

  it("does not call the api or emit when the value is unchanged", async () => {
    const w = mount(ValueEditor, {
      props: { keyName: "a.key", locale: "fr", sourceLocale: "en", value: "Bonjour" },
    });
    await w.get("button").trigger("click");
    await w.get("textarea").trigger("blur");
    await flushPromises();

    expect(setValue).not.toHaveBeenCalled();
    expect(patchKey).not.toHaveBeenCalled();
    expect(w.emitted("changed")).toBeFalsy();
  });

  it("shows a muted Empty marker for an empty target cell, click opens an editor", async () => {
    const w = mount(ValueEditor, {
      props: { keyName: "a.key", locale: "fr", sourceLocale: "en", value: "" },
    });
    const marker = w.get('[data-testid="empty-marker"]');
    expect(marker.text()).toContain("Empty");
    await marker.trigger("click");
    expect(w.find("textarea").exists()).toBe(true);
  });

  it("emits edit-start when opening the editor on a populated cell", async () => {
    const w = mount(ValueEditor, {
      props: { keyName: "a.key", locale: "fr", sourceLocale: "en", value: "Bonjour" },
    });
    await w.get("button").trigger("click");
    expect(w.emitted("edit-start")).toBeTruthy();
  });

  it("emits edit-start when opening the editor on an empty cell", async () => {
    const w = mount(ValueEditor, {
      props: { keyName: "a.key", locale: "fr", sourceLocale: "en", value: "" },
    });
    await w.get('[data-testid="empty-marker"]').trigger("click");
    expect(w.emitted("edit-start")).toBeTruthy();
  });
});
