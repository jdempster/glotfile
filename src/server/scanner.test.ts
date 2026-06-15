import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractRefs, extractPrefixes, extractLiterals, scannerForExt, runScan, CACHE_VERSION } from "./scanner.js";
import { loadUsageCache } from "./scan.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "glot-scanner-"));
}

// ---------------------------------------------------------------------------
// extractRefs — pattern matching per scanner
// ---------------------------------------------------------------------------

describe("extractRefs – laravel", () => {
  it("finds __() single-quoted", () => {
    const refs = extractRefs("echo __('auth.login');", "laravel");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "auth.login", line: 1, scanner: "laravel" });
  });

  it("finds __() double-quoted", () => {
    const refs = extractRefs('return __("messages.welcome");', "laravel");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "messages.welcome", line: 1, scanner: "laravel" });
  });

  it("finds trans()", () => {
    const refs = extractRefs("trans('nav.home')", "laravel");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "nav.home", line: 1, scanner: "laravel" });
  });

  it("finds @lang blade directive", () => {
    const refs = extractRefs('@lang("nav.back")', "laravel");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "nav.back", line: 1, scanner: "laravel" });
  });

  it("finds trans_choice()", () => {
    const refs = extractRefs("trans_choice('file.count', $n)", "laravel");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "file.count", scanner: "laravel" });
  });

  it("reports correct line numbers across multiple lines", () => {
    const text = "<?php\n$a = __('a.key');\n$b = trans('b.key');";
    const refs = extractRefs(text, "laravel");
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "a.key", line: 2 }),
      expect.objectContaining({ key: "b.key", line: 3 }),
    ]));
  });

  it("reports col as 1-based position of the function call start", () => {
    const refs = extractRefs("    __('x')", "laravel");
    expect(refs[0]!.col).toBe(5);
  });
});

describe("extractRefs – js-i18n", () => {
  it("finds $t() single-quoted", () => {
    const refs = extractRefs("$t('home.title')", "js-i18n");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "home.title", line: 1, scanner: "js-i18n" });
  });

  it("finds $t() double-quoted", () => {
    const refs = extractRefs('$t("home.title")', "js-i18n");
    expect(refs[0]).toMatchObject({ key: "home.title" });
  });

  it("finds t() with word boundary (not part of another word)", () => {
    const refs = extractRefs("const x = t('nav.home')", "js-i18n");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "nav.home", scanner: "js-i18n" });
  });

  it("does NOT match t() inside a longer word like 'const'", () => {
    const refs = extractRefs("const store = createStore()", "js-i18n");
    expect(refs).toHaveLength(0);
  });

  it("does NOT match t() inside gettext()", () => {
    const refs = extractRefs("gettext('key')", "js-i18n");
    expect(refs).toHaveLength(0);
  });

  it("finds i18n.t() call", () => {
    const refs = extractRefs("i18n.t('page.title')", "js-i18n");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "page.title" });
  });

  it("finds i18next.t() call", () => {
    const refs = extractRefs("i18next.t('page.title')", "js-i18n");
    expect(refs[0]).toMatchObject({ key: "page.title" });
  });

  it("skips template literal with interpolation", () => {
    const refs = extractRefs("t(`prefix.${key}`)", "js-i18n");
    expect(refs).toHaveLength(0);
  });

  it("matches template literal without interpolation", () => {
    const refs = extractRefs("t(`home.title`)", "js-i18n");
    expect(refs[0]).toMatchObject({ key: "home.title" });
  });

  it("matches React-i18next <Trans i18nKey=…>", () => {
    expect(extractRefs('<Trans i18nKey="home.title" />', "js-i18n")[0]).toMatchObject({ key: "home.title" });
    expect(extractRefs("<Trans i18nKey='nav.home'>x</Trans>", "js-i18n")[0]).toMatchObject({ key: "nav.home" });
  });

  it("matches vue-i18n $tc and destructured tc pluralization calls", () => {
    expect(extractRefs("$tc('cart.items', n)", "js-i18n")[0]).toMatchObject({ key: "cart.items" });
    expect(extractRefs("const x = tc('cart.items', n)", "js-i18n")[0]).toMatchObject({ key: "cart.items" });
  });

  it("matches a renamed translate() wrapper but not a method .translate()", () => {
    expect(extractRefs("translate('auth.login')", "js-i18n")[0]).toMatchObject({ key: "auth.login" });
    expect(extractRefs("svc.translate('not a key')", "js-i18n")).toHaveLength(0);
  });
});

describe("extractRefs – flutter", () => {
  it("finds AppLocalizations.of(context).keyName", () => {
    const refs = extractRefs("AppLocalizations.of(context).homeTitle", "flutter");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "homeTitle", scanner: "flutter" });
  });

  it("finds l10n.keyName shorthand", () => {
    const refs = extractRefs("Text(l10n.navHome)", "flutter");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: "navHome" });
  });

  it("finds loc.keyName shorthand", () => {
    const refs = extractRefs("loc.fileCount", "flutter");
    expect(refs[0]).toMatchObject({ key: "fileCount" });
  });

  // Real-world Flutter convention (kiosk, companion): the gen_l10n accessor is
  // assigned to a local named `translations`, then used as `translations.key`.
  it("finds the `translations` accessor (the standard gen_l10n convention)", () => {
    const src = [
      "final translations = AppLocalizations.of(context)!;",
      "return Text(translations.common_continue);",
    ].join("\n");
    const refs = extractRefs(src, "flutter");
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "common_continue", line: 2, scanner: "flutter" }),
    ]));
  });

  it("tolerates the `!` null-assertion in AppLocalizations.of(context)!.key", () => {
    const refs = extractRefs("Text(AppLocalizations.of(context)!.auth_welcome_title)", "flutter");
    expect(refs[0]).toMatchObject({ key: "auth_welcome_title", scanner: "flutter" });
  });

  // Accessor named anything — detected from its assignment, then matched.
  it("auto-detects an arbitrarily-named accessor variable", () => {
    const src = [
      "final t = AppLocalizations.of(context)!;",
      "Text(t.welcome_start_button)",
    ].join("\n");
    const refs = extractRefs(src, "flutter");
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "welcome_start_button" }),
    ]));
  });

  // companion passes the accessor as a typed parameter (no `.of` assignment).
  it("auto-detects an accessor declared as an AppLocalizations parameter", () => {
    const src = [
      "String label(AppLocalizations strings) {",
      "  return strings.actions_sign_in;",
      "}",
    ].join("\n");
    const refs = extractRefs(src, "flutter");
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "actions_sign_in" }),
    ]));
  });

  it("does not treat AppLocalizations method declarations as accessors", () => {
    // The generated file declares `static AppLocalizations of(...)` — `of` must
    // not become an accessor name (it would mis-match `Navigator.of(...)` etc).
    const src = "static AppLocalizations of(BuildContext context) => x;\nof.foo_bar";
    const refs = extractRefs(src, "flutter");
    expect(refs.some((r) => r.key === "foo_bar")).toBe(false);
  });

  it("honours extra accessor names from config (opts.accessors)", () => {
    const refs = extractRefs("i18n.home_title", "flutter", { accessors: ["i18n"] });
    expect(refs[0]).toMatchObject({ key: "home_title" });
  });

  it("honours custom config patterns (opts.patterns) — e.g. easy_localization", () => {
    const refs = extractRefs("Text(LocaleKeys.home_title.tr())", "flutter", {
      patterns: ["LocaleKeys\\.(\\w+)\\.tr\\(\\)"],
    });
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "home_title" }),
    ]));
  });

  it("finds a key when the accessor and the property are on different lines", () => {
    const src = [
      "description: translations",
      "                          .auth_permissions_local_network_description,",
    ].join("\n");
    const refs = extractRefs(src, "flutter");
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "auth_permissions_local_network_description", scanner: "flutter" }),
    ]));
  });
});

describe("extractRefs – gettext", () => {
  it("finds _()", () => {
    const refs = extractRefs("print(_('welcome'))", "gettext");
    expect(refs[0]).toMatchObject({ key: "welcome", scanner: "gettext" });
  });

  it("finds gettext()", () => {
    const refs = extractRefs("msg = gettext(\"auth.login\")", "gettext");
    expect(refs[0]).toMatchObject({ key: "auth.login" });
  });

  it("finds ngettext()", () => {
    const refs = extractRefs("ngettext('item.one', 'item.many', n)", "gettext");
    expect(refs[0]).toMatchObject({ key: "item.one" });
  });
});

describe("extractRefs – apple", () => {
  it("finds NSLocalizedString", () => {
    const refs = extractRefs('NSLocalizedString("auth.login", comment: "")', "apple");
    expect(refs[0]).toMatchObject({ key: "auth.login", scanner: "apple" });
  });

  it("finds String(localized:)", () => {
    const refs = extractRefs('String(localized: "nav.home")', "apple");
    expect(refs[0]).toMatchObject({ key: "nav.home" });
  });

  it("finds the \"key\".localized / .localised String-extension idiom", () => {
    expect(extractRefs('label.text = "Tap to start".localized', "apple")[0])
      .toMatchObject({ key: "Tap to start", scanner: "apple" });
    expect(extractRefs('let s = "Thank you for signing in".localised', "apple")[0])
      .toMatchObject({ key: "Thank you for signing in" });
  });
});

// ---------------------------------------------------------------------------
// extractPrefixes — dynamically-built keys (concatenation / interpolation)
// ---------------------------------------------------------------------------

describe("extractPrefixes – laravel", () => {
  it("captures the prefix from single-quoted concatenation", () => {
    const refs = extractPrefixes("__('messages.' . $type)", "laravel");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ prefix: "messages.", line: 1, scanner: "laravel" });
  });

  it("captures the prefix from double-quoted concatenation", () => {
    const refs = extractPrefixes('trans("validation." . $rule)', "laravel");
    expect(refs[0]).toMatchObject({ prefix: "validation." });
  });

  it("captures the prefix from curly interpolation", () => {
    const refs = extractPrefixes('__("messages.{$type}")', "laravel");
    expect(refs[0]).toMatchObject({ prefix: "messages." });
  });

  it("captures the prefix from simple interpolation", () => {
    const refs = extractPrefixes('__("errors.$code")', "laravel");
    expect(refs[0]).toMatchObject({ prefix: "errors." });
  });

  it("does NOT capture a fully static key", () => {
    expect(extractPrefixes("__('auth.login')", "laravel")).toHaveLength(0);
  });

  it("reports col as the function-call start", () => {
    const refs = extractPrefixes("    __('x.' . $y)", "laravel");
    expect(refs[0]!.col).toBe(5);
  });
});

describe("extractPrefixes – js-i18n", () => {
  it("captures the prefix from string concatenation", () => {
    const refs = extractPrefixes("$t('errors.' + code)", "js-i18n");
    expect(refs[0]).toMatchObject({ prefix: "errors.", scanner: "js-i18n" });
  });

  it("captures the prefix from a bare t() concatenation", () => {
    const refs = extractPrefixes("const m = t('nav.' + key)", "js-i18n");
    expect(refs[0]).toMatchObject({ prefix: "nav." });
  });

  it("captures the prefix from template-literal interpolation", () => {
    const refs = extractPrefixes("t(`nav.${id}`)", "js-i18n");
    expect(refs[0]).toMatchObject({ prefix: "nav." });
  });

  it("captures the prefix from $t template interpolation", () => {
    const refs = extractPrefixes("$t(`page.${x}`)", "js-i18n");
    expect(refs[0]).toMatchObject({ prefix: "page." });
  });

  it("does NOT capture a static template literal", () => {
    expect(extractPrefixes("t(`home.title`)", "js-i18n")).toHaveLength(0);
  });

  it("does NOT capture an empty prefix", () => {
    expect(extractPrefixes("$t('' + x)", "js-i18n")).toHaveLength(0);
    expect(extractPrefixes("t(`${x}`)", "js-i18n")).toHaveLength(0);
  });
});

describe("extractPrefixes – unsupported scanners", () => {
  it("returns nothing for flutter (no prefix patterns yet)", () => {
    expect(extractPrefixes("AppLocalizations.of(c).x", "flutter")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractLiterals — key-shaped string literals outside call sites
// ---------------------------------------------------------------------------

describe("extractLiterals", () => {
  it("finds a key-shaped literal in a ternary assignment", () => {
    const content = "$key = $cond\n  ? 'sms/plant-watered.delivery_message'\n  : 'sms/plant-watered.message';";
    const lits = extractLiterals(content);
    expect(lits).toEqual([
      expect.objectContaining({ literal: "sms/plant-watered.delivery_message", line: 2 }),
      expect.objectContaining({ literal: "sms/plant-watered.message", line: 3 }),
    ]);
  });

  it("finds key-shaped literals in arrays and double quotes", () => {
    const content = '$fields = ["messages.group.delivery.fields.signature"];';
    expect(extractLiterals(content)).toEqual([
      expect.objectContaining({ literal: "messages.group.delivery.fields.signature", line: 1 }),
    ]);
  });

  it("captures the literal head of an interpolated string as a trailing-dot prefix", () => {
    const php = '$key = "emails/export-complete.subjects.{$reportType}";';
    expect(extractLiterals(php)).toEqual([
      expect.objectContaining({ literal: "emails/export-complete.subjects." }),
    ]);
    const js = "const key = `emails/export-complete.subjects.${reportType}`;";
    expect(extractLiterals(js)).toEqual([
      expect.objectContaining({ literal: "emails/export-complete.subjects." }),
    ]);
  });

  it("keeps %s placeholders so sprintf-built keys stay matchable", () => {
    expect(extractLiterals("sprintf('messages.notification.%s.title', $type)")).toEqual([
      expect.objectContaining({ literal: "messages.notification.%s.title" }),
    ]);
  });

  it("ignores strings that aren't key-shaped", () => {
    const content = "$a = 'Hello world'; $b = 'no-dots'; $c = 'spaced out.key'; $d = '';";
    expect(extractLiterals(content)).toEqual([]);
  });

  it("dedupes repeats at the same position only, keeping distinct occurrences", () => {
    const content = "'a.b'\n'a.b'";
    expect(extractLiterals(content)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// scannerForExt
// ---------------------------------------------------------------------------

describe("scannerForExt", () => {
  it("returns laravel for .php", () => { expect(scannerForExt(".php")).toBe("laravel"); });
  it("returns js-i18n for .vue", () => { expect(scannerForExt(".vue")).toBe("js-i18n"); });
  it("returns js-i18n for .ts", () => { expect(scannerForExt(".ts")).toBe("js-i18n"); });
  it("returns js-i18n for .js", () => { expect(scannerForExt(".js")).toBe("js-i18n"); });
  it("returns js-i18n for .tsx", () => { expect(scannerForExt(".tsx")).toBe("js-i18n"); });
  it("returns flutter for .dart", () => { expect(scannerForExt(".dart")).toBe("flutter"); });
  it("returns gettext for .py", () => { expect(scannerForExt(".py")).toBe("gettext"); });
  it("returns apple for .swift", () => { expect(scannerForExt(".swift")).toBe("apple"); });
  it("returns null for .json", () => { expect(scannerForExt(".json")).toBeNull(); });
  it("returns null for .md", () => { expect(scannerForExt(".md")).toBeNull(); });
});

// ---------------------------------------------------------------------------
// multi-line calls — function token and key on different lines
// ---------------------------------------------------------------------------

describe("extractRefs – multi-line calls", () => {
  it("finds a key when the $t( call and the key string are on different lines", () => {
    const content = "x = this.$t(\n    'banners.taa.description',\n    {date: d},\n);";
    const refs = extractRefs(content, "js-i18n");
    expect(refs).toEqual([
      expect.objectContaining({ key: "banners.taa.description", line: 1, scanner: "js-i18n" }),
    ]);
  });
});

describe("extractPrefixes – multi-line calls", () => {
  it("finds a prefix when the i18n.t( call and the dynamic key are on different lines", () => {
    const content = "x = i18n.t(\n    'errors.' + code,\n);";
    const prefixes = extractPrefixes(content, "js-i18n");
    expect(prefixes).toEqual([
      expect.objectContaining({ prefix: "errors.", line: 1, scanner: "js-i18n" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// runScan — integration with real filesystem
// ---------------------------------------------------------------------------

describe("runScan", () => {
  it("scans a Vue file and returns a valid UsageCacheFile", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "Home.vue"), "<template>{{ $t('home.title') }}</template>");
    const result = runScan(dir, {});
    expect(result.version).toBe(CACHE_VERSION);
    expect(typeof result.scannedAt).toBe("string");
    expect(result.files["Home.vue"]).toBeDefined();
    expect(result.files["Home.vue"]!.refs).toEqual([
      expect.objectContaining({ key: "home.title", line: 1, scanner: "js-i18n" }),
    ]);
  });

  it("records mtime and size for each scanned file", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "app.php"), "__('auth.login')");
    const result = runScan(dir, {});
    const entry = result.files["app.php"]!;
    expect(entry.mtime).toBeGreaterThan(0);
    expect(entry.size).toBeGreaterThan(0);
  });

  it("writes the cache to .glotfile/usage.json", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "app.ts"), "t('app.key')");
    runScan(dir, {});
    const saved = loadUsageCache(dir);
    expect(saved).not.toBeNull();
    expect(saved!.files["app.ts"]).toBeDefined();
  });

  it("excludes node_modules by default", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, "node_modules", "lib"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "lib", "main.js"), "t('some.key')");
    const result = runScan(dir, {});
    expect(Object.keys(result.files).some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("excludes .git by default", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "t('git.key')");
    const result = runScan(dir, {});
    expect(Object.keys(result.files).some((f) => f.startsWith(".git"))).toBe(false);
  });

  it("respects custom include patterns", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "t('app.key')");
    writeFileSync(join(dir, "README.md"), "not source");
    const result = runScan(dir, { include: ["src/**"] });
    expect(result.files["src/app.ts"]).toBeDefined();
    expect(result.files["README.md"]).toBeUndefined();
  });

  it("respects custom exclude patterns", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "t('app.key')");
    writeFileSync(join(dir, "src", "app.test.ts"), "t('test.key')");
    const result = runScan(dir, { exclude: ["**/*.test.ts"] });
    expect(result.files["src/app.ts"]).toBeDefined();
    expect(result.files["src/app.test.ts"]).toBeUndefined();
  });

  it("scans multiple file types in the same project", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "src", "Home.vue"), "$t('home.title')");
    writeFileSync(join(dir, "app", "Auth.php"), "__('auth.login')");
    const result = runScan(dir, {});
    expect(result.files["src/Home.vue"]!.refs[0]).toMatchObject({ scanner: "js-i18n" });
    expect(result.files["app/Auth.php"]!.refs[0]).toMatchObject({ scanner: "laravel" });
  });

  it("reuses cached entry when mtime and size are unchanged", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "app.php"), "__('auth.login')");
    const first = runScan(dir, {});
    const second = runScan(dir, {}, first);
    // Same object reference for the unchanged file entry
    expect(second.files["app.php"]).toBe(first.files["app.php"]);
  });

  it("re-scans a file when its mtime has changed", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "app.php"), "__('auth.login')");
    const first = runScan(dir, {});
    // Fake a stale cache by changing the mtime stored in the cache
    const stale: typeof first = {
      ...first,
      files: { "app.php": { ...first.files["app.php"]!, mtime: 0 } },
    };
    const second = runScan(dir, {}, stale);
    expect(second.files["app.php"]).not.toBe(first.files["app.php"]);
    expect(second.files["app.php"]!.refs).toHaveLength(1);
  });

  it("re-extracts files when the cached version predates the current scanner", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "auth.js"), "i18n.t(`auth_error.${code}`)");
    const fresh = runScan(dir, {});
    // A cache written by an older scanner version: unchanged mtime/size, but
    // missing the prefix the current scanner extracts (prefix scanning is newer
    // than this entry). It must not be reused just because the file is unchanged.
    const stale: typeof fresh = {
      ...fresh,
      version: 1,
      files: { "auth.js": { ...fresh.files["auth.js"]!, prefixes: [] } },
    };
    const result = runScan(dir, {}, stale);
    expect(result.files["auth.js"]!.prefixes).toEqual([
      expect.objectContaining({ prefix: "auth_error.", scanner: "js-i18n" }),
    ]);
  });

  it("returns empty refs array for files with no i18n calls", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "utils.ts"), "export const add = (a: number, b: number) => a + b;");
    const result = runScan(dir, {});
    expect(result.files["utils.ts"]!.refs).toHaveLength(0);
  });

  it("populates prefixes for dynamically-built keys", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "Lang.php"), "__('messages.' . $type)");
    const result = runScan(dir, {});
    expect(result.files["Lang.php"]!.prefixes).toEqual([
      expect.objectContaining({ prefix: "messages.", scanner: "laravel" }),
    ]);
  });
});
