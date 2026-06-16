import { ref, computed } from "vue";
import { triggerScan, scanSummary } from "./api.js";
import { timeAgo } from "./time.js";

// Shared scan status so the header chip (App.vue), the editor (Unused filter,
// per-key usage) and the Scan settings panel stay in sync no matter where a scan
// is triggered from. Same module-ref channel pattern as drilldown.ts.
export interface ScanInfo {
  files: number;
  refs: number;
  scannedAt: string;
}

export const scanInfo = ref<ScanInfo | null>(null);
export const scanPending = ref(false);
export const scanFailed = ref(false);

// Compact freshness label for the header chip.
export const scanLabel = computed(() => {
  if (scanPending.value) return "scanning…";
  if (scanFailed.value) return "scan failed";
  if (scanInfo.value) return `scanned ${timeAgo(scanInfo.value.scannedAt)}`;
  return "not scanned";
});

// Fuller one-line detail for tooltips and the Settings panel.
export const scanDetail = computed(() => {
  if (scanPending.value) return "Scanning your codebase…";
  if (scanFailed.value) return "Last scan failed — try again.";
  if (scanInfo.value) {
    const { files, refs, scannedAt } = scanInfo.value;
    return `Last scan: ${timeAgo(scannedAt)} · ${files.toLocaleString()} files · ${refs.toLocaleString()} refs`;
  }
  return "Not scanned yet.";
});

// Load the last persisted scan (incl. the boot scan) without re-scanning.
export async function refreshScanSummary(): Promise<void> {
  if (scanPending.value) return;
  try {
    const sum = await scanSummary();
    if (sum.indexed && sum.scannedAt) {
      scanInfo.value = { files: sum.files, refs: sum.refs, scannedAt: sum.scannedAt };
    }
  } catch {
    /* no index yet — UI shows "not scanned" */
  }
}

// Run a fresh scan. Returns true on success so callers can react.
export async function runScan(): Promise<boolean> {
  if (scanPending.value) return false;
  scanPending.value = true;
  scanFailed.value = false;
  try {
    const result = await triggerScan();
    scanInfo.value = { files: result.files, refs: result.refs, scannedAt: result.scannedAt };
    return true;
  } catch {
    scanFailed.value = true;
    return false;
  } finally {
    scanPending.value = false;
  }
}
