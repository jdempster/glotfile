<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Search, X } from "lucide-vue-next";
import { pages } from "virtual:docs-bundle";
import { getHashSearch } from "@/router.js";

const SECTION_ORDER = [
  "",
  "Getting Started",
  "Frameworks",
  "Web UI",
  "CLI",
  "Concepts",
  "AI Translation",
  "Reference",
  "Guides",
  "Help",
];

// The doc id is carried in the hash search (`#docs?doc=<id>`) so a page can be
// deep-linked, restored on reload, and walked with browser back/forward.
function docFromUrl(): string {
  const id = getHashSearch().get("doc");
  return id && pages.some((p) => p.id === id) ? id : (pages[0]?.id ?? "");
}

const selectedId = ref(docFromUrl());
const query = ref("");

const grouped = computed(() => {
  const map = new Map<string, typeof pages>();
  for (const page of pages) {
    if (!map.has(page.section)) map.set(page.section, []);
    map.get(page.section)!.push(page);
  }
  // Curated order first, then any section not in SECTION_ORDER so a freshly
  // added docs/<Section>/ never silently vanishes from the nav.
  const ordered = [...SECTION_ORDER, ...[...map.keys()].filter((s) => !SECTION_ORDER.includes(s))];
  return ordered
    .map((s) => ({ section: s, pages: map.get(s) ?? [] }))
    .filter((g) => g.pages.length > 0);
});

// Search results: pages whose title or body contains the query, each with a
// short snippet of surrounding text and the match offsets for highlighting.
const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  const out: { id: string; title: string; section: string; before: string; match: string; after: string }[] = [];
  for (const page of pages) {
    const haystack = page.text.toLowerCase();
    const titleHit = page.title.toLowerCase().includes(q);
    const idx = haystack.indexOf(q);
    if (idx === -1 && !titleHit) continue;
    if (idx === -1) {
      out.push({ id: page.id, title: page.title, section: page.section, before: "", match: "", after: "" });
      continue;
    }
    const start = Math.max(0, idx - 40);
    const end = Math.min(page.text.length, idx + q.length + 80);
    out.push({
      id: page.id,
      title: page.title,
      section: page.section,
      before: (start > 0 ? "…" : "") + page.text.slice(start, idx),
      match: page.text.slice(idx, idx + q.length),
      after: page.text.slice(idx + q.length, end) + (end < page.text.length ? "…" : ""),
    });
  }
  return out;
});

const currentPage = computed(() => pages.find((p) => p.id === selectedId.value) ?? pages[0]);

// Selecting a page pushes a new history entry (`#docs?doc=<id>`) so back/forward
// step between visited docs; the hash listener mirrors those traversals back.
function selectDoc(id: string) {
  if (id === selectedId.value) return;
  selectedId.value = id;
  history.pushState(null, "", `#docs?${new URLSearchParams({ doc: id })}`);
}

function openResult(id: string) {
  selectDoc(id);
  query.value = "";
}

function onHashChange() {
  selectedId.value = docFromUrl();
}

onMounted(() => window.addEventListener("hashchange", onHashChange));
onUnmounted(() => window.removeEventListener("hashchange", onHashChange));
</script>

<template>
  <div class="flex min-h-0 flex-1 overflow-hidden">
    <!-- Sidebar -->
    <nav class="flex w-56 shrink-0 flex-col overflow-hidden border-r bg-muted/30">
      <!-- Search -->
      <div class="relative shrink-0 px-2 py-2">
        <Search class="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="query"
          type="search"
          placeholder="Search docs…"
          class="w-full rounded-md border bg-background py-1 pl-7 pr-7 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          v-if="query"
          type="button"
          class="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          @click="query = ''"
        >
          <X class="size-3.5" />
        </button>
      </div>

      <!-- Search results -->
      <div v-if="query.trim()" class="flex flex-col gap-1 overflow-y-auto px-2 pb-3">
        <div class="px-2 py-1 text-xs text-muted-foreground">
          {{ results.length }} result{{ results.length === 1 ? "" : "s" }}
        </div>
        <button
          v-for="r in results"
          :key="r.id"
          type="button"
          class="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
          @click="openResult(r.id)"
        >
          <div class="text-sm font-medium">{{ r.title }}</div>
          <div v-if="r.section" class="text-[10px] uppercase tracking-wider text-muted-foreground">{{ r.section }}</div>
          <div v-if="r.match" class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {{ r.before }}<mark class="bg-primary/20 text-foreground">{{ r.match }}</mark>{{ r.after }}
          </div>
        </button>
      </div>

      <!-- Browse -->
      <div v-else class="flex flex-col gap-1 overflow-y-auto px-2 pb-3">
        <template v-for="(group, i) in grouped" :key="group.section">
          <div
            v-if="group.section"
            :class="['px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground', i > 0 ? 'mt-3' : '']"
          >
            {{ group.section }}
          </div>
          <button
            v-for="page in group.pages"
            :key="page.id"
            type="button"
            :class="[
              'w-full rounded-md px-2 py-1 text-left text-sm transition-colors',
              selectedId === page.id
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-accent hover:text-accent-foreground',
            ]"
            @click="selectDoc(page.id)"
          >
            {{ page.title }}
          </button>
        </template>
      </div>
    </nav>

    <!-- Content -->
    <div class="min-w-0 flex-1 overflow-y-auto">
      <div
        class="prose prose-sm dark:prose-invert mx-auto max-w-3xl px-8 py-6"
        v-html="currentPage?.html"
      />
    </div>
  </div>
</template>
