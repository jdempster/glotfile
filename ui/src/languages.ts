// Locale → display identity. Pure: no I/O, no config. Mirrors the spec's resolution
// order (override → Intl → fallback). The UI is English, so names resolve in "en".
const DISPLAY_LOCALE = "en";

export interface LanguageOverride {
  name?: string;
  // string = a region into the flag set; null = neutral globe; absent = auto-derive.
  flag?: string | null;
}

export interface ResolvedLanguage {
  code: string; // stored code, verbatim
  bcp47: string; // underscores→hyphens, canonicalised when valid
  name: string; // override → Intl.DisplayNames → code
  endonym?: string; // name in the language's own locale, when resolvable
  flagRegion: string | null; // override → maximize().region → null
  isCustom: boolean; // true when Intl can't resolve the code: invalid tag OR a variant subtag
  rtl: boolean; // base language is written right-to-left
}

const displayNames = new Intl.DisplayNames([DISPLAY_LOCALE], { type: "language" });
const endonymCache = new Map<string, string | undefined>();

function endonymFor(bcp47: string): string | undefined {
  if (!endonymCache.has(bcp47)) {
    let value: string | undefined;
    try {
      value = new Intl.DisplayNames([bcp47], { type: "language" }).of(bcp47) ?? undefined;
    } catch {
      value = undefined;
    }
    endonymCache.set(bcp47, value);
  }
  return endonymCache.get(bcp47);
}

// BCP47 variant subtags are 5-8 alpha chars, or digit + 3 alphanums. We treat ANY
// tag carrying a variant as custom — a deliberate simplification: glotfile's real
// custom-locale case is invented codes like "en_PIRATE" (pseudo-locales). Genuine
// IANA variants (e.g. "de-1901", "zh-Latn-pinyin") are vanishingly rare in a
// translation catalog and intentionally fall back to code + globe, overridable later.
function hasVariantSubtag(bcp47: string): boolean {
  return bcp47.split("-").slice(1).some((part) => /^[a-zA-Z]{5,8}$/.test(part) || /^[0-9][a-zA-Z0-9]{3}$/.test(part));
}

// Base languages written right-to-left. Region/script subtags inherit the base
// direction, so we test the primary subtag only.
const RTL_LANGUAGES = new Set([
  "ar", "he", "iw", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb", "ks", "nqo", "rhg",
]);

export function isRtl(code: string): boolean {
  const base = code.split(/[-_]/)[0]?.toLowerCase() ?? "";
  return RTL_LANGUAGES.has(base);
}

export function resolveLanguage(code: string, override?: LanguageOverride): ResolvedLanguage {
  const dashed = code.replace(/_/g, "-");

  let bcp47 = dashed;
  let isCustom = false;
  try {
    bcp47 = Intl.getCanonicalLocales(dashed)[0] ?? dashed;
    // Variant subtags (e.g. "pirate") are structurally valid BCP47 but represent
    // custom locales that Intl cannot meaningfully resolve.
    if (hasVariantSubtag(bcp47)) {
      isCustom = true;
    }
  } catch {
    isCustom = true;
  }

  // name: override → Intl.DisplayNames (only when resolvable) → raw code.
  let name = code;
  if (override?.name !== undefined) {
    name = override.name;
  } else if (!isCustom) {
    name = displayNames.of(bcp47) ?? code;
  }

  // flagRegion: explicit override (incl. null) → combined `en` → maximize().region → null.
  let flagRegion: string | null;
  if (override && override.flag !== undefined) {
    // explicit override: a region string, or null for the neutral globe
    flagRegion = override.flag;
  } else if (isCustom) {
    flagRegion = null;
  } else if (bcp47 === "en") {
    // Region-less English represents a UK/US product, not the US specifically.
    // maximize() would pick "US"; instead use the combined UK/US flag (en.svg).
    flagRegion = "en";
  } else {
    flagRegion = new Intl.Locale(bcp47).maximize().region ?? null;
  }

  return {
    code,
    bcp47,
    name,
    endonym: isCustom ? undefined : endonymFor(bcp47),
    flagRegion,
    isCustom,
    rtl: isRtl(code),
  };
}
