import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractRefs, extractPrefixes, isNextIntlFile, runScan } from "./scanner.js";
import { computeUsedKeys } from "./scan.js";
import { defaultState } from "./schema.js";
import { createKey } from "./state.js";

const IMPORT = `import { useTranslations } from 'next-intl';\n`;
const SERVER_IMPORT = `import { getTranslations } from 'next-intl/server';\n`;

describe("isNextIntlFile", () => {
  it("matches a next-intl import", () => {
    expect(isNextIntlFile(`import {useTranslations} from "next-intl";`)).toBe(true);
    expect(isNextIntlFile(`import {getTranslations} from 'next-intl/server';`)).toBe(true);
  });
  it("does not match an unrelated import", () => {
    expect(isNextIntlFile(`import { t } from 'i18next';`)).toBe(false);
  });
});

describe("extractRefs – next-intl namespace resolution", () => {
  it("prefixes a relative key with the useTranslations namespace", () => {
    const refs = extractRefs(`${IMPORT}const t = useTranslations('index');\nt('heading');`, "next-intl");
    expect(refs).toEqual([expect.objectContaining({ key: "index.heading", scanner: "next-intl" })]);
  });

  it("resolves several bound translators in one file independently", () => {
    const src = `${IMPORT}const t = useTranslations('checkout');\nconst formT = useTranslations('form');\nt('heading');\nformT('labels.email');`;
    const refs = extractRefs(src, "next-intl");
    expect(refs.map((r) => r.key).sort()).toEqual(["checkout.heading", "form.labels.email"]);
  });

  it("resolves t.rich / t.markup / t.raw / t.has calls", () => {
    const src = `${IMPORT}const t = useTranslations('checkout');\nt.rich('invoice_request', {});\nt.markup('a');\nt.raw('b');\nt.has('c');`;
    const refs = extractRefs(src, "next-intl");
    expect(refs.map((r) => r.key).sort()).toEqual([
      "checkout.a", "checkout.b", "checkout.c", "checkout.invoice_request",
    ]);
  });

  it("handles getTranslations (await) with a string namespace", () => {
    const src = `${SERVER_IMPORT}const t = await getTranslations('index');\nt('meta.title');`;
    const refs = extractRefs(src, "next-intl");
    expect(refs).toEqual([expect.objectContaining({ key: "index.meta.title" })]);
  });

  it("handles getTranslations with an options object namespace", () => {
    const src = `${SERVER_IMPORT}const t = await getTranslations({ locale, namespace: 'index' });\nt('meta.title');`;
    const refs = extractRefs(src, "next-intl");
    expect(refs).toEqual([expect.objectContaining({ key: "index.meta.title" })]);
  });

  it("uses the relative key unchanged when useTranslations has no namespace", () => {
    const src = `${IMPORT}const t = useTranslations();\nt('foo.bar');`;
    const refs = extractRefs(src, "next-intl");
    expect(refs).toEqual([expect.objectContaining({ key: "foo.bar" })]);
  });

  it("supports a dotted namespace", () => {
    const src = `${IMPORT}const t = useTranslations('a.b');\nt('c');`;
    const refs = extractRefs(src, "next-intl");
    expect(refs).toEqual([expect.objectContaining({ key: "a.b.c" })]);
  });

  it("resolves the nearest preceding binding when a name is rebound", () => {
    const src = `${IMPORT}const t = useTranslations('first');\nt('a');\nconst t2 = useTranslations('second');\nt2('b');`;
    const refs = extractRefs(src, "next-intl");
    expect(refs.map((r) => r.key).sort()).toEqual(["first.a", "second.b"]);
  });

  it("auto-detects next-intl from the import even when called as the js-i18n scanner", () => {
    const src = `${IMPORT}const t = useTranslations('index');\nt('heading');`;
    const refs = extractRefs(src, "js-i18n");
    expect(refs).toEqual([expect.objectContaining({ key: "index.heading", scanner: "next-intl" })]);
  });

  it("leaves a plain js-i18n file (no next-intl import) on the js-i18n path", () => {
    const refs = extractRefs(`t('plain.key');`, "js-i18n");
    expect(refs).toEqual([expect.objectContaining({ key: "plain.key", scanner: "js-i18n" })]);
  });
});

describe("extractPrefixes – next-intl dynamic keys", () => {
  it("prefixes a concatenated head with the namespace", () => {
    const src = `${IMPORT}const t = useTranslations('form');\nt('errors.' + code);`;
    const prefixes = extractPrefixes(src, "next-intl");
    expect(prefixes).toEqual([expect.objectContaining({ prefix: "form.errors.", scanner: "next-intl" })]);
  });

  it("prefixes a template-literal head with the namespace", () => {
    const src = "import {useTranslations} from 'next-intl';\nconst t = useTranslations('form');\nt(`errors.${code}`);";
    const prefixes = extractPrefixes(src, "next-intl");
    expect(prefixes).toEqual([expect.objectContaining({ prefix: "form.errors." })]);
  });

  it("treats a fully dynamic key as covering the whole namespace", () => {
    const src = `${IMPORT}const t = useTranslations('index');\nt(dynamicKey);`;
    const prefixes = extractPrefixes(src, "next-intl");
    expect(prefixes).toEqual([expect.objectContaining({ prefix: "index." })]);
  });
});

describe("runScan – next-intl through a .tsx file", () => {
  it("records namespaced keys so unused-key detection works", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-next-intl-scan-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src", "Page.tsx"),
      `import { useTranslations } from 'next-intl';\nexport function Page() {\n  const t = useTranslations('index');\n  return <h1>{t('heading')}</h1>;\n}\n`,
    );
    const cache = runScan(dir, {});
    const refs = Object.values(cache.files).flatMap((f) => f.refs);
    expect(refs).toEqual([expect.objectContaining({ key: "index.heading", scanner: "next-intl" })]);

    const state = defaultState();
    createKey(state, "index.heading", "Your package");
    createKey(state, "index.unused", "Nobody references me");
    expect(computeUsedKeys(state, cache)).toEqual(["index.heading"]);
  });
});
