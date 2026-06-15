import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server/cli.ts", "src/server/server.ts"],
  format: ["esm"],
  outDir: "dist/server",
  target: "node20",
  clean: false,
  splitting: false,
  shims: false,
  external: ["nspell"],
});
