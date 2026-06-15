import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ShortcutsDialog from "./ShortcutsDialog.vue";
import { shortcuts } from "@/hotkeys.js";

describe("ShortcutsDialog", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("titles the overlay and lists one row per registry entry", async () => {
    mount(ShortcutsDialog, { props: { open: true } });
    await nextTick();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Keyboard shortcuts");
    for (const s of shortcuts) {
      expect(text).toContain(s.label);
    }
    // Renders the literal key chips (e.g. an "Editor" row showing g and e).
    const kbds = Array.from(document.querySelectorAll("kbd")).map((k) => k.textContent?.trim());
    expect(kbds).toContain("g");
    expect(kbds).toContain("e");
    expect(kbds).toContain("a");
  });

  it("renders nothing while closed", async () => {
    mount(ShortcutsDialog, { props: { open: false } });
    await nextTick();
    expect(document.querySelectorAll("kbd").length).toBe(0);
  });
});
