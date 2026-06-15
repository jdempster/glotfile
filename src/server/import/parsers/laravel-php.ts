import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import type { Parser, ParseResult, ParsedKey } from "../types.js";
import { flattenObject } from "../flatten.js";
import { laravelToCanonical } from "../placeholders.js";

function listDirs(dir: string): string[] {
  return readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
}

function listPhpFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".php")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

// One php process reads every file (paths on stdin, newline-separated) and emits a
// single JSON map of path -> returned array. A real Laravel repo can have hundreds
// of lang files across locales; spawning php per file made a large project (e.g. 17
// locales) take ~1300 spawns and block for tens of seconds. This is one spawn.
const PHP_READ_ALL =
  '$fs=array_filter(array_map("trim",explode("\\n",stream_get_contents(STDIN))),"strlen");' +
  '$o=[];foreach($fs as $f){try{$o[$f]=require $f;}catch(\\Throwable $e){}}' +
  "echo json_encode($o);";

function readPhpArrays(files: string[]): Record<string, unknown> {
  if (files.length === 0) return {};
  let stdout: string;
  try {
    stdout = execFileSync("php", ["-r", PHP_READ_ALL], {
      input: files.join("\n"),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("php is required to import Laravel PHP files but was not found on PATH");
    }
    throw new Error(`php failed to evaluate Laravel lang files: ${(err as Error).message}`);
  }
  return JSON.parse(stdout) as Record<string, unknown>;
}

export const laravelPhp: Parser = {
  name: "laravel-php",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    // Collect every (locale, group, file) up front so all files go through php once.
    const entries: { locale: string; group: string; file: string }[] = [];
    for (const locale of listDirs(localeRoot).sort()) {
      if (locale === "vendor") continue;
      if (opts?.locales && !opts.locales.includes(locale)) continue;
      const localeDir = join(localeRoot, locale);
      locales.push(locale);
      for (const file of listPhpFiles(localeDir)) {
        const group = relative(localeDir, file).replace(/\\/g, "/").replace(/\.php$/, "");
        entries.push({ locale, group, file });
      }
    }

    const data = readPhpArrays(entries.map((e) => e.file));

    for (const { locale, group, file } of entries) {
      if (!(file in data)) {
        warnings.push(`laravel-php: failed to read ${file}`);
        continue;
      }
      for (const [inner, value] of Object.entries(flattenObject(data[file], "", warnings))) {
        const key = `${group}.${inner}`;
        (keys[key] ??= { values: {} }).values[locale] = laravelToCanonical(value);
      }
    }
    return { locales, keys, warnings };
  },
};
