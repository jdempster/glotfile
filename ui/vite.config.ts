import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { docsPlugin } from "./src/plugins/vite-plugin-docs.js";

const docsDir = fileURLToPath(new URL("../docs", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [vue(), tailwindcss(), docsPlugin(docsDir)],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    // Flag SVGs must be emitted as separate files (fetched on demand), not inlined
    // into the JS bundle — there are ~271 of them and only the displayed one is loaded.
    assetsInlineLimit: (filePath: string) =>
      filePath.includes("/assets/flags/") ? false : undefined,
    outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      // Silence harmless misplaced-/* #__PURE__ */ annotation warnings coming
      // from dependencies (e.g. @vueuse/core via reka-ui) — not our code.
      onLog(level, log, handler) {
        if (log.code === "INVALID_ANNOTATION" && (log.id ?? log.message).includes("node_modules")) return;
        handler(level, log);
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787", "^/[^/]+-screenshots/": "http://127.0.0.1:8787" } },
});
