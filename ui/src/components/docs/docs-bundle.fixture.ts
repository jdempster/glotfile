// Stand-in for the `virtual:docs-bundle` module under vitest, which doesn't load
// the docs Vite plugin. Aliased in vitest.config.ts. Covers a curated section
// (Frameworks) and one absent from SECTION_ORDER (Bonus) to exercise grouping.
export const pages = [
  { id: "home", title: "Home", section: "", html: "<p>home body</p>", text: "home body" },
  { id: "frameworks/angular", title: "Angular", section: "Frameworks", html: "<p>angular body</p>", text: "angular body" },
  { id: "frameworks/laravel", title: "Laravel", section: "Frameworks", html: "<p>laravel body</p>", text: "laravel body" },
  { id: "bonus/extra", title: "Extra", section: "Bonus", html: "<p>extra body</p>", text: "extra body" },
];
