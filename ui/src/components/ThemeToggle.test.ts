import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

// Mock the store: ThemeToggle's job is purely to reflect `mode` and call
// `setTheme`. The resolution/persistence logic lives in theme.test.ts.
vi.mock("@/theme", async () => {
  const { ref } = await import("vue");
  return { mode: ref("system"), setTheme: vi.fn() };
});

import ThemeToggle from "@/components/ThemeToggle.vue";
import { mode, setTheme } from "@/theme";
import { TooltipProvider } from "@/components/ui/tooltip";

// reka-ui tooltips need a TooltipProvider ancestor, so mount the toggle inside one.
const mountToggle = () =>
  mount(
    { components: { ThemeToggle, TooltipProvider }, template: "<TooltipProvider><ThemeToggle /></TooltipProvider>" },
  );

beforeEach(() => {
  vi.mocked(setTheme).mockClear();
  mode.value = "system";
});

describe("ThemeToggle", () => {
  it("offers a button for each of system, light, and dark", () => {
    const w = mountToggle();
    expect(w.find('[data-mode="system"]').exists()).toBe(true);
    expect(w.find('[data-mode="light"]').exists()).toBe(true);
    expect(w.find('[data-mode="dark"]').exists()).toBe(true);
  });

  it("calls setTheme with the chosen mode on click", async () => {
    const w = mountToggle();
    await w.find('[data-mode="dark"]').trigger("click");
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("highlights the active mode and not the others", () => {
    mode.value = "light";
    const w = mountToggle();
    expect(w.find('[data-mode="light"]').classes()).toContain("bg-primary");
    expect(w.find('[data-mode="dark"]').classes()).not.toContain("bg-primary");
    expect(w.find('[data-mode="system"]').classes()).not.toContain("bg-primary");
  });
});
