import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { marked } from "marked";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:docs-bundle";
const RESOLVED_ID = "\0virtual:docs-bundle";

const SECTION_ORDER: [string, string][] = [
  ["Getting Started", "Getting Started"],
  ["Frameworks", "Frameworks"],
  ["Web UI", "Web UI"],
  ["CLI", "CLI"],
  ["Concepts", "Concepts"],
  ["AI Translation", "AI Translation"],
  ["Reference", "Reference"],
  ["Guides", "Guides"],
];

function toSlug(dirName: string, fileName: string): string {
  return [dirName, fileName.replace(/\.md$/, "")]
    .map((s) => s.toLowerCase().replace(/\s+/g, "-"))
    .join("/");
}

function extractTitle(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() ?? fallback;
}

// Plain-text projection of the markdown, used for client-side search. Strips
// code fences, inline markup, links and table pipes down to bare words.
function toSearchText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectPages(docsDir: string) {
  const pages: { id: string; title: string; section: string; html: string; text: string }[] = [];

  // Root Home.md — listed first as "home" with no section
  const homePath = join(docsDir, "Home.md");
  try {
    const content = readFileSync(homePath, "utf8");
    pages.push({
      id: "home",
      title: "Home",
      section: "",
      html: marked.parse(content, { async: false }),
      text: toSearchText(content),
    });
  } catch { /* skip if missing */ }

  for (const [dirName, sectionLabel] of SECTION_ORDER) {
    const sectionDir = join(docsDir, dirName);
    let entries: string[];
    try {
      entries = readdirSync(sectionDir);
    } catch {
      continue;
    }
    const mdFiles = entries
      .filter((f) => extname(f) === ".md" && !f.startsWith("2026-"))
      .sort();
    for (const file of mdFiles) {
      const absPath = join(sectionDir, file);
      if (!statSync(absPath).isFile()) continue;
      const content = readFileSync(absPath, "utf8");
      pages.push({
        id: toSlug(dirName, file),
        title: extractTitle(content, basename(file, ".md")),
        section: sectionLabel,
        html: marked.parse(content, { async: false }),
        text: toSearchText(content),
      });
    }
  }

  // Root Troubleshooting and FAQ.md — in "Help" section
  const faqPath = join(docsDir, "Troubleshooting and FAQ.md");
  try {
    const content = readFileSync(faqPath, "utf8");
    pages.push({
      id: "troubleshooting-and-faq",
      title: "Troubleshooting and FAQ",
      section: "Help",
      html: marked.parse(content, { async: false }),
      text: toSearchText(content),
    });
  } catch { /* skip if missing */ }

  return pages;
}

export function docsPlugin(docsDir: string): Plugin {
  return {
    name: "vite-plugin-docs",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      const pages = collectPages(docsDir);
      return `export const pages = ${JSON.stringify(pages)};`;
    },
  };
}
