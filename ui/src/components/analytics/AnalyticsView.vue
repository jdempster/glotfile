<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  fetchState, fetchLint, suppressFinding, unsuppressFinding, acceptLintFindings, addToDictionary,
} from "@/api.js";
import { drillTo } from "@/drilldown.js";
import { onExternalChange } from "@/liveReload";
import { buildCockpit, drillFilterFor, RULE_LABELS, type LocaleReadiness, type Verdict, type Severity } from "./cockpit.js";
import { usePager } from "./usePager.js";
import { resolveLanguage } from "@/languages.js";
import type { State, LintReport, LintFinding, LintRuleId } from "@/types.js";
import {
  CircleCheckBig, OctagonAlert, ClockAlert, TriangleAlert, CircleDot, Circle,
  ChevronRight, ChevronDown, Ship, Flag, Check, BellOff, BookPlus, RotateCcw,
} from "lucide-vue-next";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const state = ref<State | null>(null);
// The release gate runs on the server's /lint report — the same rules (and the
// same config.lint.rules skips) as `glotfile check`, so UI and CLI always agree.
// Fetched with suppressed findings included; the gate runs on the visible subset
// and the suppressed remainder feeds the "Suppressed (n)" drawer.
const report = ref<LintReport>({ findings: [], counts: { error: 0, warn: 0, suppressed: 0 }, ok: true });
const loading = ref(true);

const visibleReport = computed<LintReport>(() => ({
  ...report.value,
  findings: report.value.findings.filter((f) => !f.suppressed),
}));
const suppressedFindings = computed(() => report.value.findings.filter((f) => f.suppressed));

const cockpit = computed(() => (state.value ? buildCockpit(state.value, visibleReport.value) : null));
const noKeys = computed(() => !!cockpit.value && (cockpit.value.totals.keys === 0 || cockpit.value.totals.locales === 0));
const empty = computed(() => !!cockpit.value && cockpit.value.totals.translatedPct === 0);

async function reload() {
  const [s, r] = await Promise.all([fetchState(), fetchLint({ includeSuppressed: true }).catch(() => null)]);
  state.value = s;
  if (r) report.value = r;
}
// Refresh when the catalog changes on disk out of band.
onExternalChange(reload);

onMounted(async () => {
  try {
    await reload();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
});

// ── Dismissing warnings ──────────────────────────────────────────────────────
// A dismissed finding is suppressed for that key+locale until the key's source
// text changes; spelling findings instead offer "add to dictionary" first, which
// fixes every occurrence of the word at once.

const showSuppressed = ref(false);
const acting = ref(false);

// The worklist, Quality findings and suppressed drawer are all unbounded — a large
// project yields thousands of rows. Render a capped window and reveal more on demand
// so the page stays light (see usePager).
const pager = usePager(50);

// output-stale findings key a file path, not a translation key, so drilling lands
// on an empty editor filter — there's nothing to navigate to. Their detail (which
// file, why) lives entirely in the message, so keep them static and readable.
const canDrill = (f: LintFinding) => f.ruleId !== "output-stale";
function activateFinding(f: LintFinding) {
  if (canDrill(f)) drillTo(drillFilterFor(f));
}

function wordOf(f: LintFinding): string | undefined {
  return f.ruleId === "spelling" ? /"([^"]+)"/.exec(f.message)?.[1] : undefined;
}

async function act(label: string, run: () => Promise<unknown>) {
  if (acting.value) return;
  acting.value = true;
  try {
    await run();
    await reload();
    toast.success(label);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    acting.value = false;
  }
}

const dismiss = (f: LintFinding) =>
  act(`Dismissed until the source of ${f.key} changes`, () => suppressFinding(f.key, f.ruleId, f.locale));
const restore = (f: LintFinding) =>
  act(`Restored ${RULE_LABELS[f.ruleId].toLowerCase()} on ${f.key}`, () => unsuppressFinding(f.key, f.ruleId, f.locale));
const dismissRule = (ruleId: LintRuleId, n: number) =>
  act(`Dismissed ${n} warning${n === 1 ? "" : "s"}`, () => acceptLintFindings({ rules: [ruleId] }));
const addWord = (f: LintFinding) => {
  const w = wordOf(f);
  if (w) void act(`Added "${w}" to the dictionary`, () => addToDictionary(w));
};

interface RuleGroup { ruleId: LintRuleId; findings: LintFinding[] }
function groupsFor(key: Severity): RuleGroup[] {
  const map = new Map<LintRuleId, LintFinding[]>();
  for (const f of cockpit.value!.risk[key]) {
    const arr = map.get(f.ruleId);
    if (arr) arr.push(f);
    else map.set(f.ruleId, [f]);
  }
  return [...map.entries()].map(([ruleId, findings]) => ({ ruleId, findings }));
}

// --- presentation meta (static class strings so Tailwind's JIT keeps them) ---
const VERDICT: Record<Verdict | "none", { label: string; icon: unknown; text: string; border: string; bar: string; soft: string }> = {
  ready:   { label: "Ready",       icon: CircleCheckBig, text: "text-emerald-600 dark:text-emerald-400", border: "border-l-emerald-500", bar: "bg-emerald-500",          soft: "bg-emerald-500/10" },
  almost:  { label: "Almost",      icon: ClockAlert,     text: "text-amber-600 dark:text-amber-400",     border: "border-l-amber-500",   bar: "bg-amber-500",            soft: "bg-amber-500/10" },
  blocked: { label: "Blocked",     icon: OctagonAlert,   text: "text-red-600 dark:text-red-400",         border: "border-l-red-500",     bar: "bg-red-500",              soft: "bg-red-500/10" },
  none:    { label: "Not started", icon: Ship,           text: "text-muted-foreground",                  border: "border-l-border",      bar: "bg-muted-foreground/40",  soft: "bg-muted" },
};
const PRIORITY: Record<string, { label: string; icon: unknown; text: string; border: string; soft: string }> = {
  breaking: { label: "Breaking", icon: OctagonAlert,  text: "text-red-600 dark:text-red-400",     border: "border-l-red-500",            soft: "bg-red-500/10" },
  missing:  { label: "Missing",  icon: Circle,        text: "text-muted-foreground",              border: "border-l-muted-foreground/40", soft: "bg-muted" },
  stale:    { label: "Stale",    icon: ClockAlert,    text: "text-amber-600 dark:text-amber-400", border: "border-l-amber-500",          soft: "bg-amber-500/10" },
  warning:  { label: "Warning",  icon: TriangleAlert, text: "text-amber-600 dark:text-amber-400", border: "border-l-amber-500",          soft: "bg-amber-500/10" },
};
// Lint-error findings block the release; warn findings are worth a look. The
// severity per rule is config.lint.rules — shared with `glotfile check`.
const TIERS: { key: Severity; label: string; blurb: string; text: string; bar: string }[] = [
  { key: "breaking", label: "Breaking", blurb: "Lint errors — `glotfile check` fails on these. Ship-blocking.", text: "text-red-600 dark:text-red-400",     bar: "bg-red-500" },
  { key: "warning",  label: "Warning",  blurb: "Lint warnings — worth a look, won't block a release.",          text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
];

// hero tone — "can I ship?"
const heroTone = computed<Verdict | "none">(() => {
  const c = cockpit.value!;
  if (empty.value) return "none";
  if (c.projectErrors > 0) return "blocked";
  return c.totals.ready === c.totals.locales && c.totals.locales > 0 ? "ready" : "blocked";
});
const heroHeadline = computed(() =>
  heroTone.value === "none" ? "Nothing to ship yet" : heroTone.value === "ready" ? "Ready to ship" : "Not ready to ship");

// reason text shown on a readiness card / locale row
function reasonText(l: LocaleReadiness): string {
  if (l.verdict === "ready") return l.notes.length ? l.notes.join(" · ") : "Clean — clears the gate";
  return l.blockers.join(" · ");
}

// the actionable subset a locale drills into
function localeFilter(l: LocaleReadiness) {
  if (l.missingKeys.length) return { locale: l.locale, states: ["missing" as const] };
  if (l.errors.length) return { locale: l.locale, ...drillFilterFor(l.errors[0]!) };
  if (l.staleKeys.length) return { locale: l.locale, states: ["needs-review" as const] };
  return { locale: l.locale };
}

function langName(code: string): string {
  return resolveLanguage(code).name;
}

// composition bar segments (real four-state colours, % of total)
function seg(n: number, total: number): string {
  return (total ? (n / total) * 100 : 0) + "%";
}

// tier header drill: the union of editor filters for that tier's findings
function tierFilter(key: Severity) {
  const checks = [...new Set(cockpit.value!.risk[key].flatMap((f) => drillFilterFor(f).issues ?? []))];
  return checks.length ? { issues: checks } : { needsAttention: true };
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-6">
    <div v-if="loading" class="mt-8 text-center text-sm text-muted-foreground">Loading analytics…</div>

    <div v-else-if="noKeys" class="mt-8 text-center text-sm text-muted-foreground">
      No keys yet — add keys in the Editor to see analytics.
    </div>

    <div v-else-if="cockpit" class="mx-auto flex max-w-[1080px] flex-col gap-4">
      <!-- Stat strip -->
      <section class="flex flex-wrap divide-x rounded-xl border bg-card px-2 py-3 shadow-sm">
        <div class="flex flex-col px-5"><span class="text-lg font-semibold tabular-nums">{{ cockpit.totals.keys }}</span><span class="text-xs text-muted-foreground">keys</span></div>
        <div class="flex flex-col px-5"><span class="text-lg font-semibold tabular-nums">{{ cockpit.totals.locales }}</span><span class="text-xs text-muted-foreground">locales</span></div>
        <div class="flex flex-col px-5"><span class="text-lg font-semibold tabular-nums">{{ cockpit.totals.translatedPct }}%</span><span class="text-xs text-muted-foreground">translated</span></div>
        <div class="flex flex-col px-5"><span class="text-lg font-semibold tabular-nums">{{ cockpit.totals.reviewedPct }}%</span><span class="text-xs text-muted-foreground">reviewed</span></div>
        <button type="button" class="group flex flex-col px-5 text-left" data-test="open-issues"
          :disabled="!cockpit.totals.openIssues" @click="drillTo({ needsAttention: true })">
          <span class="text-lg font-semibold tabular-nums" :class="cockpit.totals.breaking ? 'text-red-600 dark:text-red-400' : ''">{{ cockpit.totals.openIssues }}</span>
          <span class="text-xs text-muted-foreground group-hover:text-foreground">open issues</span>
        </button>
        <div class="flex flex-col px-5"><span class="text-lg font-semibold tabular-nums">{{ cockpit.totals.sourceWords }}</span><span class="text-xs text-muted-foreground">source words</span></div>
      </section>

      <!-- Readiness hero — "can I ship?" -->
      <section class="rounded-2xl border border-l-4 bg-card p-6 shadow-sm" :class="VERDICT[heroTone].border">
        <div class="flex flex-wrap items-start justify-between gap-6">
          <div class="min-w-0">
            <div class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Can I ship?</div>
            <h1 class="mt-1.5 flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
              <component :is="VERDICT[heroTone].icon" class="size-6" :class="VERDICT[heroTone].text" />
              {{ heroHeadline }}
            </h1>
            <p class="mt-1.5 text-sm text-muted-foreground">
              <template v-if="empty">Add translations to get started — run a sync to let the AI fill them in.</template>
              <template v-else>
                <strong class="text-emerald-600 dark:text-emerald-400">{{ cockpit.totals.ready }}</strong> of {{ cockpit.totals.locales }} locales ready<template
                  v-if="cockpit.totals.almost"> · <strong class="text-amber-600 dark:text-amber-400">{{ cockpit.totals.almost }}</strong> need a refresh</template><template
                  v-if="cockpit.totals.blocked"> · <strong class="text-red-600 dark:text-red-400">{{ cockpit.totals.blocked }}</strong> blocked</template>
              </template>
            </p>
            <!-- project-level blockers: empty sources, stale output files… -->
            <ul v-if="cockpit.project.length" class="mt-2 flex flex-col gap-1">
              <li v-for="f in cockpit.project" :key="`${f.ruleId}:${f.key}`" class="flex items-center gap-1.5 text-xs"
                :class="f.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'">
                <OctagonAlert v-if="f.severity === 'error'" class="size-3 shrink-0" />
                <TriangleAlert v-else class="size-3 shrink-0" />
                <span class="font-semibold">{{ RULE_LABELS[f.ruleId] }}</span>
                <span class="font-mono text-muted-foreground">{{ f.key }}</span>
                <span class="text-muted-foreground">{{ f.message }}</span>
              </li>
            </ul>
          </div>
          <div class="flex gap-2">
            <div v-for="s in [
                { n: cockpit.totals.ready, label: 'ready', cls: 'text-emerald-600 dark:text-emerald-400' },
                { n: cockpit.totals.almost, label: 'almost', cls: 'text-amber-600 dark:text-amber-400' },
                { n: cockpit.totals.blocked, label: 'blocked', cls: 'text-red-600 dark:text-red-400' },
              ]" :key="s.label"
              class="flex min-w-[66px] flex-col items-center rounded-xl border px-4 py-2">
              <span class="text-2xl font-semibold tabular-nums" :class="s.n ? s.cls : 'text-muted-foreground/50'">{{ s.n }}</span>
              <span class="text-[11px] uppercase tracking-wide text-muted-foreground">{{ s.label }}</span>
            </div>
          </div>
        </div>
        <!-- the release gate, spelled out -->
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3.5">
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Release gate</span>
          <span class="flex items-center gap-1 text-xs text-muted-foreground"><Check class="size-3 text-emerald-500" /> 100% translated</span>
          <span class="flex items-center gap-1 text-xs text-muted-foreground"><Check class="size-3 text-emerald-500" /> 0 lint errors</span>
          <span class="flex items-center gap-1 text-xs text-muted-foreground"><Check class="size-3 text-emerald-500" /> outputs exported</span>
          <span class="flex items-center gap-1 text-xs text-muted-foreground"><Check class="size-3 text-emerald-500" /> nothing stale</span>
          <span class="ml-auto text-[11px] italic text-muted-foreground">same rules as <code class="font-mono not-italic">glotfile check</code> · skip via <code class="font-mono not-italic">config.lint.rules</code></span>
        </div>
      </section>

      <!-- Release readiness -->
      <section class="rounded-2xl border bg-card p-5 shadow-sm">
        <header class="mb-4">
          <h2 class="text-base font-semibold">Release readiness</h2>
          <p class="mt-0.5 text-sm text-muted-foreground">Per-locale status against the release gate. Click any locale to drill in.</p>
        </header>
        <div v-if="empty" class="flex items-center gap-3 rounded-xl bg-muted p-4">
          <Flag class="size-5 text-muted-foreground" />
          <div class="flex flex-col">
            <b class="text-sm">No locale is ready yet.</b>
            <span class="text-sm text-muted-foreground">Translate your strings, then locales appear here as they clear the gate.</span>
          </div>
        </div>
        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(218px,1fr))] gap-3">
          <button v-for="l in cockpit.locales" :key="l.locale" type="button" :data-test="`rcard-${l.locale}`"
            class="flex flex-col gap-2 rounded-xl border border-l-[3px] p-3.5 text-left transition hover:-translate-y-0.5 hover:bg-muted/50"
            :class="VERDICT[l.verdict].border" @click="drillTo(localeFilter(l))">
            <div class="flex items-start justify-between gap-2">
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-mono text-xs font-semibold uppercase">{{ l.locale }}</span>
                <span class="truncate text-[11px] text-muted-foreground" :title="langName(l.locale)">{{ langName(l.locale) }}</span>
              </span>
              <span class="flex items-center gap-1 text-[11px] font-semibold" :class="VERDICT[l.verdict].text">
                <component :is="VERDICT[l.verdict].icon" class="size-3" />{{ VERDICT[l.verdict].label }}
              </span>
            </div>
            <div class="text-2xl font-semibold tabular-nums leading-none">{{ l.pct }}<span class="ml-0.5 text-xs text-muted-foreground">%</span></div>
            <!-- composition bar: reviewed · needs-review (stale) · machine · missing -->
            <div class="flex h-[7px] w-full overflow-hidden rounded-full bg-muted">
              <span class="h-full bg-emerald-500" :style="{ width: seg(l.counts.reviewed, l.total) }" />
              <span class="h-full bg-amber-500" :style="{ width: seg(l.counts.needsReview, l.total) }" />
              <span class="h-full bg-sky-500" :style="{ width: seg(l.counts.machine, l.total) }" />
            </div>
            <div class="flex min-h-[20px] items-center gap-1.5 text-xs text-muted-foreground">
              <component v-if="l.verdict !== 'ready'" :is="VERDICT[l.verdict].icon" class="size-3 shrink-0" :class="VERDICT[l.verdict].text" />
              <span class="truncate">{{ reasonText(l) }}</span>
            </div>
          </button>
        </div>
      </section>

      <!-- Needs attention — prioritized worklist -->
      <section class="rounded-2xl border bg-card p-5 shadow-sm">
        <header class="mb-4">
          <h2 class="text-base font-semibold">Needs attention</h2>
          <p class="mt-0.5 text-sm text-muted-foreground">
            {{ empty ? "Your prioritized worklist will fill in as the AI translates." : "Prioritized — fix the top item first. Each opens the matching strings." }}
          </p>
        </header>
        <div v-if="!cockpit.worklist.length" class="flex items-center gap-3 rounded-xl bg-muted p-4">
          <CircleCheckBig class="size-5 text-emerald-500" />
          <div class="flex flex-col">
            <b class="text-sm">Nothing needs attention.</b>
            <span class="text-sm text-muted-foreground">Every translated string clears its checks and is up to date.</span>
          </div>
        </div>
        <ol v-else class="flex flex-col gap-2">
          <li v-for="(it, i) in pager.slice('worklist', cockpit.worklist)" :key="it.id">
            <button type="button"
              class="grid w-full grid-cols-[30px_1fr_auto_16px] items-center gap-3 rounded-xl border border-l-[3px] px-3.5 py-3 text-left transition enabled:hover:bg-muted/50"
              :class="[PRIORITY[it.priority].border, i === 0 ? PRIORITY[it.priority].soft : '']"
              :disabled="!it.filter" @click="it.filter && drillTo(it.filter)">
              <span class="flex size-[30px] items-center justify-center rounded-lg" :class="[PRIORITY[it.priority].soft, PRIORITY[it.priority].text]">
                <component :is="PRIORITY[it.priority].icon" class="size-4" />
              </span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="flex items-center gap-2 text-sm font-semibold">
                  {{ it.title }}
                  <span v-if="i === 0" class="rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-white" :class="PRIORITY[it.priority].text.includes('red') ? 'bg-red-500' : PRIORITY[it.priority].text.includes('amber') ? 'bg-amber-500' : 'bg-muted-foreground'">Start here</span>
                </span>
                <span class="truncate font-mono text-xs text-muted-foreground">{{ it.where }}</span>
              </span>
              <span class="rounded-full px-2.5 py-1 text-[11px] font-semibold" :class="[PRIORITY[it.priority].soft, PRIORITY[it.priority].text]">{{ PRIORITY[it.priority].label }}</span>
              <ChevronRight class="size-4 text-muted-foreground" />
            </button>
          </li>
          <li v-if="pager.remaining('worklist', cockpit.worklist)">
            <button type="button"
              class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/50"
              @click="pager.more('worklist')">
              <ChevronDown class="size-3.5" />
              Show {{ Math.min(pager.pageSize, pager.remaining('worklist', cockpit.worklist)) }} more
              <span class="text-muted-foreground/60">· {{ pager.remaining('worklist', cockpit.worklist) }} hidden</span>
            </button>
          </li>
        </ol>
      </section>

      <!-- Quality (risk) + By locale -->
      <div v-if="!empty" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- Quality as risk -->
        <section class="rounded-2xl border bg-card p-5 shadow-sm">
          <header class="mb-4">
            <h2 class="text-base font-semibold">Quality</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">Grouped by risk — a broken placeholder is not a typo.</p>
          </header>
          <div v-if="!cockpit.totals.openIssues" class="flex items-center gap-3 rounded-xl bg-muted p-4">
            <CircleCheckBig class="size-5 text-emerald-500" />
            <div class="flex flex-col"><b class="text-sm">No issues found.</b><span class="text-sm text-muted-foreground">All translated strings pass their checks.</span></div>
          </div>
          <div v-else class="flex flex-col gap-2.5">
            <div v-for="t in TIERS" :key="t.key" class="overflow-hidden rounded-xl border">
              <button type="button" class="flex w-full items-center gap-3 px-3.5 py-3 text-left enabled:hover:bg-muted/50"
                :disabled="!cockpit.risk[t.key].length" @click="drillTo(tierFilter(t.key))">
                <span class="w-1 self-stretch rounded-full" :class="t.bar" />
                <span class="min-w-[22px] text-xl font-semibold tabular-nums" :class="t.text">{{ cockpit.risk[t.key].length }}</span>
                <span class="flex flex-1 flex-col">
                  <span class="text-sm font-semibold">{{ t.label }}</span>
                  <span class="text-xs text-muted-foreground">{{ t.blurb }}</span>
                </span>
                <ChevronRight v-if="cockpit.risk[t.key].length" class="size-4 text-muted-foreground" />
              </button>
              <div v-if="cockpit.risk[t.key].length" class="border-t">
                <template v-for="g in groupsFor(t.key)" :key="g.ruleId">
                  <div class="flex items-center justify-between gap-2 border-b bg-muted/40 px-3.5 py-1.5">
                    <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {{ RULE_LABELS[g.ruleId] }} · {{ g.findings.length }}
                    </span>
                    <button
                      v-if="t.key === 'warning'"
                      type="button"
                      class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      :disabled="acting"
                      :title="`Hide all ${g.findings.length} until each key's source changes`"
                      @click="dismissRule(g.ruleId, g.findings.length)"
                    >
                      <BellOff class="size-3" /> Dismiss all
                    </button>
                  </div>
                  <div v-for="(f, idx) in pager.slice(`${t.key}:${g.ruleId}`, g.findings)" :key="idx"
                    :role="canDrill(f) ? 'button' : undefined"
                    :tabindex="canDrill(f) ? 0 : undefined"
                    class="group grid w-full grid-cols-[42px_minmax(90px,1fr)_1.4fr_auto] items-center gap-2.5 border-b px-3.5 py-2.5 text-left text-xs last:border-b-0"
                    :class="canDrill(f) ? 'cursor-pointer hover:bg-muted/50' : ''"
                    @click="activateFinding(f)"
                    @keydown.enter="activateFinding(f)">
                    <span class="font-mono font-semibold uppercase text-muted-foreground" :title="f.locale ? langName(f.locale) : 'project-wide'">{{ f.locale || "—" }}</span>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span class="truncate font-medium"><span class="font-mono text-muted-foreground">{{ f.key }}</span></span>
                      </TooltipTrigger>
                      <TooltipContent class="max-w-md break-all font-mono">{{ f.key }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span class="truncate text-muted-foreground">{{ f.message }}</span>
                      </TooltipTrigger>
                      <TooltipContent class="max-w-md">{{ f.message }}</TooltipContent>
                    </Tooltip>
                    <span class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        v-if="wordOf(f)"
                        type="button"
                        class="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        :disabled="acting"
                        :title="`Never flag &quot;${wordOf(f)}&quot; again`"
                        @click.stop="addWord(f)"
                      >
                        <BookPlus class="size-3" /> Add word
                      </button>
                      <button
                        v-if="f.severity === 'warn'"
                        type="button"
                        class="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        :disabled="acting"
                        title="Hide until this key's source changes"
                        @click.stop="dismiss(f)"
                      >
                        <BellOff class="size-3" /> Dismiss
                      </button>
                    </span>
                  </div>
                  <button v-if="pager.remaining(`${t.key}:${g.ruleId}`, g.findings)" type="button"
                    class="flex w-full items-center justify-center gap-1.5 border-b bg-muted/20 py-2 text-[11px] font-medium text-muted-foreground transition last:border-b-0 hover:bg-muted/50"
                    @click="pager.more(`${t.key}:${g.ruleId}`)">
                    <ChevronDown class="size-3" />
                    Show {{ Math.min(pager.pageSize, pager.remaining(`${t.key}:${g.ruleId}`, g.findings)) }} more · {{ pager.remaining(`${t.key}:${g.ruleId}`, g.findings) }} hidden
                  </button>
                </template>
              </div>
            </div>
          </div>

          <!-- Suppressed findings drawer -->
          <div v-if="suppressedFindings.length" class="mt-3 overflow-hidden rounded-xl border">
            <button type="button" class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted/50"
              @click="showSuppressed = !showSuppressed">
              <component :is="showSuppressed ? ChevronDown : ChevronRight" class="size-3.5" />
              <BellOff class="size-3.5" />
              Suppressed ({{ suppressedFindings.length }}) — hidden until each key's source changes
            </button>
            <div v-if="showSuppressed" class="border-t">
              <div v-for="(f, idx) in pager.slice('suppressed', suppressedFindings)" :key="idx"
                class="grid w-full grid-cols-[42px_minmax(90px,1fr)_1.4fr_auto] items-center gap-2.5 border-b px-3.5 py-2.5 text-left text-xs text-muted-foreground last:border-b-0">
                <span class="font-mono font-semibold uppercase">{{ f.locale || "—" }}</span>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span class="truncate">{{ RULE_LABELS[f.ruleId] }} · <span class="font-mono">{{ f.key }}</span></span>
                  </TooltipTrigger>
                  <TooltipContent class="max-w-md break-all font-mono">{{ f.key }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span class="truncate">{{ f.message }}</span>
                  </TooltipTrigger>
                  <TooltipContent class="max-w-md">{{ f.message }}</TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  class="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent hover:text-foreground"
                  :disabled="acting"
                  @click="restore(f)"
                >
                  <RotateCcw class="size-3" /> Restore
                </button>
              </div>
              <button v-if="pager.remaining('suppressed', suppressedFindings)" type="button"
                class="flex w-full items-center justify-center gap-1.5 border-b bg-muted/20 py-2 text-[11px] font-medium text-muted-foreground transition last:border-b-0 hover:bg-muted/50"
                @click="pager.more('suppressed')">
                <ChevronDown class="size-3" />
                Show {{ Math.min(pager.pageSize, pager.remaining('suppressed', suppressedFindings)) }} more · {{ pager.remaining('suppressed', suppressedFindings) }} hidden
              </button>
            </div>
          </div>
        </section>

        <!-- By locale -->
        <section class="rounded-2xl border bg-card p-5 shadow-sm">
          <header class="mb-4">
            <h2 class="text-base font-semibold">By locale</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">Full breakdown.</p>
          </header>
          <div class="grid grid-cols-[minmax(96px,1.4fr)_52px_64px_50px_72px_72px_16px] gap-2 border-b pb-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Locale</span><span class="text-center">Done</span><span class="text-center">Missing</span><span class="text-center">Stale</span><span class="text-center">Breaking</span><span class="text-center">Warnings</span><span />
          </div>
          <button v-for="l in cockpit.locales" :key="l.locale" type="button"
            class="grid w-full grid-cols-[minmax(96px,1.4fr)_52px_64px_50px_72px_72px_16px] items-center gap-2 border-b py-2.5 text-left text-sm last:border-b-0 hover:bg-muted/50"
            @click="drillTo(localeFilter(l))">
            <span class="flex min-w-0 items-center gap-2">
              <span class="size-2 shrink-0 rounded-full" :class="VERDICT[l.verdict].bar" />
              <span class="flex min-w-0 flex-col">
                <span class="whitespace-nowrap font-mono uppercase leading-tight">{{ l.locale }}</span>
                <span class="truncate text-xs leading-tight text-muted-foreground" :title="langName(l.locale)">{{ langName(l.locale) }}</span>
              </span>
            </span>
            <span class="text-center font-mono tabular-nums">{{ l.pct }}%</span>
            <span class="text-center font-mono tabular-nums" :class="l.missingKeys.length ? '' : 'text-muted-foreground'">{{ l.missingKeys.length || "—" }}</span>
            <span class="text-center font-mono tabular-nums" :class="l.staleKeys.length ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">{{ l.staleKeys.length || "—" }}</span>
            <span class="text-center font-mono tabular-nums" :class="l.breaking ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'">{{ l.breaking || "—" }}</span>
            <span class="text-center font-mono tabular-nums" :class="l.warning ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">{{ l.warning || "—" }}</span>
            <ChevronRight class="size-3.5 text-muted-foreground" />
          </button>
        </section>
      </div>

      <!-- Quality (low-data) -->
      <section v-else class="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold">Quality</h2>
        <div class="flex items-center gap-3 rounded-xl bg-muted p-4">
          <CircleDot class="size-5 text-muted-foreground" />
          <div class="flex flex-col"><b class="text-sm">No checks run yet.</b><span class="text-sm text-muted-foreground">Quality checks appear once strings are translated.</span></div>
        </div>
      </section>
    </div>
  </div>
</template>
