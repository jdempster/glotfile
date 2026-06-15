export interface ParsedKey {
  values: Record<string, string>;
  placeholders?: Record<string, { type?: string; format?: string; example?: string }>;
  // Source-code locations a parser can recover from the catalog itself (Angular's
  // <context-group purpose="location">). Feeds the usage cache for formats whose
  // keys never appear literally in code, so the code scanner can't find them.
  locations?: { file: string; line: number }[];
}

export interface ParseResult {
  locales: string[];
  keys: Record<string, ParsedKey>;
  warnings: string[];
}

export interface Parser {
  name: string;
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult;
}
