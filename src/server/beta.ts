// Beta features are hidden by default and revealed by setting the matching env
// var. They aren't ready for general use, so this gate keeps them out of the
// shipped UI, API and CLI until the work is finished — without forking a build.
// Any non-empty value other than "0"/"false" counts as enabled (so `=1` works).
function envFlag(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

// AI-powered glossary term suggestions (the "Suggest terms with AI" affordance,
// the /glossary/suggest* API routes and the `suggest-glossary` CLI command).
export const glossarySuggestEnabled = (): boolean => envFlag("GLOTFILE_BETA_GLOSSARY_SUGGEST");

// The feature flags reported to the UI so it can hide beta affordances. Mirrors
// the shape consumed by ui/src/api.ts#getFeatures.
export function betaFeatures(): { glossarySuggest: boolean } {
  return { glossarySuggest: glossarySuggestEnabled() };
}
