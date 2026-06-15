// Presentational only: turn a locale code (e.g. "en", "pt-BR") into a human
// language name for the wizard. Flags are rendered separately via <Flag>. The
// backend only knows codes — names never leave the client and don't affect what
// gets imported.

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  ca: "Catalan",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  cs: "Czech",
  sk: "Slovak",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  nb: "Norwegian Bokmål",
  fi: "Finnish",
  tr: "Turkish",
  el: "Greek",
  ro: "Romanian",
  hu: "Hungarian",
  bg: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sl: "Slovenian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  he: "Hebrew",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  fa: "Persian",
};

export interface LocaleMeta {
  code: string;
  name: string;
}

export function localeMeta(code: string): LocaleMeta {
  const [langRaw = "", regionRaw] = code.split(/[-_]/);
  const lang = langRaw.toLowerCase();
  const region = regionRaw && /^[A-Za-z]{2}$/.test(regionRaw) ? regionRaw.toUpperCase() : undefined;
  const baseName = LANGUAGE_NAMES[lang] ?? code;
  const name = region ? `${baseName} (${region})` : baseName;
  return { code, name };
}
