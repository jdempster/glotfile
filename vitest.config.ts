import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: { name: "server", environment: "node", include: ["src/server/**/*.test.ts"], setupFiles: ["./src/server/test-setup.ts"] },
      },
      {
        plugins: [vue()],
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./ui/src", import.meta.url)),
            // The docs Vite plugin isn't loaded under vitest; point the virtual
            // bundle at a deterministic fixture so DocsView mounts in tests.
            "virtual:docs-bundle": fileURLToPath(
              new URL("./ui/src/components/docs/docs-bundle.fixture.ts", import.meta.url),
            ),
          },
        },
        // Disable asset inlining so that ?url glob imports return paths rather than data URIs
        build: { assetsInlineLimit: 0 },
        // Mirror ui/vite.config.ts so components reading __APP_VERSION__ mount under vitest
        define: { __APP_VERSION__: JSON.stringify(pkg.version) },
        test: { name: "ui", environment: "happy-dom", include: ["ui/src/**/*.test.ts"] },
      },
    ],
  },
});
