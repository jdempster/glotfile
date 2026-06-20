import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

// A fake EventSource so the SSE wiring is testable without a live server.
const sources: FakeEventSource[] = [];
class FakeEventSource {
  url: string;
  closed = false;
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(url: string) {
    this.url = url;
    sources.push(this);
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener() {}
  emit(type: string) {
    for (const cb of this.listeners[type] ?? []) cb({});
  }
  close() {
    this.closed = true;
  }
}

// Fresh module state per test (the composable keeps a module-level connection +
// listener registry), with EventSource stubbed.
async function load() {
  vi.resetModules();
  sources.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  const live = await import("./liveReload.js");
  return { live };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Mounts a throwaway host so onExternalChange's setup/onUnmounted lifecycle runs.
function host(register: () => void) {
  const Host = defineComponent({
    setup() {
      register();
      return () => h("div");
    },
  });
  return mount(Host);
}

describe("liveReload", () => {
  it("runs subscribed listeners and flashes the refresh indicator on an external change", async () => {
    const { live } = await load();
    const refresh = vi.fn();
    const wrapper = host(() => live.onExternalChange(refresh));

    expect(live.refreshing.value).toBe(false);
    live.dispatchExternalChange();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(live.refreshing.value).toBe(true);
    wrapper.unmount();
  });

  it("stops calling a listener after its component unmounts", async () => {
    const { live } = await load();
    const refresh = vi.fn();
    const wrapper = host(() => live.onExternalChange(refresh));

    wrapper.unmount();
    live.dispatchExternalChange();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens /api/events and dispatches on a state-changed message", async () => {
    const { live } = await load();
    live.startLiveReload();
    expect(sources).toHaveLength(1);
    const es = sources[0]!;
    expect(es.url).toBe("/api/events");

    const refresh = vi.fn();
    const wrapper = host(() => live.onExternalChange(refresh));
    es.emit("state-changed");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(live.refreshing.value).toBe(true);
    wrapper.unmount();
  });

  it("opens only one connection no matter how many times it is started", async () => {
    const { live } = await load();
    live.startLiveReload();
    live.startLiveReload();
    expect(sources).toHaveLength(1);
  });
});
