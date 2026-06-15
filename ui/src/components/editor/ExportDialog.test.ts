import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import ExportDialog from "./ExportDialog.vue";

vi.mock("@/api.js", () => ({
  exportPreview: vi.fn(() =>
    Promise.resolve({
      files: [
        { path: "lang/fr.json", contents: '{"hello":"Bonjour"}' },
        { path: "lang/de.json", contents: '{"hello":"Hallo"}' },
      ],
      warnings: ['laravel-php: "items" uses ICU plural/select; written unconverted (fr).'],
    }),
  ),
  runExport: vi.fn(() => Promise.resolve({ files: 2, warnings: [] })),
}));

import { exportPreview, runExport } from "@/api.js";

// Dialog content teleports to document.body via reka-ui's portal.
function buttonByText(text: string) {
  const el = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  return new DOMWrapper(el!);
}

describe("ExportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("lists file paths, shows warnings, renders contents, and writes on click", async () => {
    // ExportDialog's file-list tooltips need a TooltipProvider ancestor.
    mount(TooltipProvider, { slots: { default: () => h(ExportDialog, { open: true }) } });
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(exportPreview).toHaveBeenCalledTimes(1);

    const text = document.body.textContent ?? "";
    // Both paths are listed (sorted: de before fr).
    expect(text).toContain("lang/de.json");
    expect(text).toContain("lang/fr.json");
    // The warning banner is shown.
    expect(text).toContain("ICU plural/select");
    // The first (selected) file's contents render in the preview pane.
    expect(text).toContain("Hallo");

    await buttonByText("Write 2 files").trigger("click");
    await flushPromises();

    expect(runExport).toHaveBeenCalledTimes(1);
  });
});
