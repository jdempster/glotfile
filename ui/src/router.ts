import { ref, readonly } from "vue";

export const routes = ["editor", "analytics", "glossary", "screenshots", "settings", "activity", "docs"] as const;
export type Route = (typeof routes)[number];

function parseHash(): { route: Route; search: string } {
  const raw = location.hash.replace(/^#\/?/, "");
  const idx = raw.indexOf("?");
  const routePart = idx === -1 ? raw : raw.slice(0, idx);
  const searchPart = idx === -1 ? "" : raw.slice(idx + 1);
  const route = (routes as readonly string[]).includes(routePart) ? (routePart as Route) : "editor";
  return { route, search: searchPart };
}

const route = ref<Route>(parseHash().route);

window.addEventListener("hashchange", () => {
  route.value = parseHash().route;
});

// A view with unsaved work registers a guard so it can intercept a navigation
// away (e.g. Settings warning about an unsaved draft). Returning false aborts
// the navigation — the guard owns the confirmation UI and re-invokes navigate()
// once the user decides. Only one guard is active at a time; the owning view
// clears it (setLeaveGuard(null)) when it unmounts.
type LeaveGuard = (to: Route) => boolean;
let leaveGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  leaveGuard = guard;
}

export function navigate(to: Route, search?: string): void {
  if (leaveGuard && !leaveGuard(to)) return;
  // No query string by default: the editor's search params are filter state and
  // must not leak into other routes. Cross-view filter hand-off goes through
  // drilldown.ts (pendingFilter), and deep links restore from the hash on load.
  // `search` is an explicit opt-in (e.g. deep-linking to a Settings subsection).
  location.hash = search ? `${to}?${search}` : to;
}

export function useRoute() {
  return readonly(route);
}

export function getHashSearch(): URLSearchParams {
  return new URLSearchParams(parseHash().search);
}

export function setHashSearch(params: URLSearchParams): void {
  const qs = params.toString();
  const newHash = `#${parseHash().route}${qs ? `?${qs}` : ""}`;
  history.replaceState(null, "", newHash);
}
