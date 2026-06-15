// A bare {name} in a format whose interpolation sigil is NOT a brace (Laravel
// :name, Rails %{name}) is literal text, so mark it as a canonical apostrophe-
// quoted literal. The (?<!%) guard leaves Rails' own %{name} placeholders for
// the format-specific pass that follows.
export function markBareBracesLiteral(value: string): string {
  return value.replace(/(?<!%)\{(\w+)\}/g, "'{$1}'");
}

// Laravel :name -> glotfile canonical {name}. Only converts letter-led tokens
// so "12:30" and "https://..." are left intact. A bare {name} in the source is
// literal (Laravel interpolates :name, not braces), so it is quoted first.
export function laravelToCanonical(value: string): string {
  return markBareBracesLiteral(value).replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, "{$1}");
}

// Rails %{name} -> glotfile canonical {name}: inverse of placeholders.ts#toRuby.
// A bare {name} is literal (Rails interpolates %{name}, not braces), so it is
// quoted first — the markBareBracesLiteral guard leaves the %{name} forms alone.
export function railsToCanonical(value: string): string {
  return markBareBracesLiteral(value).replace(/%\{(\w+)\}/g, "{$1}");
}
