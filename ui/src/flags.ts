// Vite resolves this glob at build time into a map of source paths → emitted asset
// URLs. `eager` builds the (tiny) URL map up front; the SVG bytes are only fetched
// when an <img> actually requests one.
const modules = import.meta.glob("./assets/flags/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byRegion = new Map<string, string>();
for (const [path, url] of Object.entries(modules)) {
  const match = path.match(/\/([^/]+)\.svg$/);
  if (match) byRegion.set(match[1]!.toLowerCase(), url);
}

export function flagUrl(region: string): string | undefined {
  return byRegion.get(region.toLowerCase());
}
