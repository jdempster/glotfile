import { describe, it, expect, vi } from "vitest";
import { createEventHub } from "./events.js";

describe("createEventHub", () => {
  it("delivers a broadcast to every subscriber", () => {
    const hub = createEventHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe(a);
    hub.subscribe(b);

    hub.broadcast("state-changed", "{}");

    expect(a).toHaveBeenCalledWith("state-changed", "{}");
    expect(b).toHaveBeenCalledWith("state-changed", "{}");
  });

  it("stops delivering after unsubscribe", () => {
    const hub = createEventHub();
    const a = vi.fn();
    const unsubscribe = hub.subscribe(a);

    unsubscribe();
    hub.broadcast("state-changed", "{}");

    expect(a).not.toHaveBeenCalled();
  });

  it("tracks the live subscriber count", () => {
    const hub = createEventHub();
    expect(hub.size()).toBe(0);
    const unsubscribe = hub.subscribe(vi.fn());
    expect(hub.size()).toBe(1);
    unsubscribe();
    expect(hub.size()).toBe(0);
  });

  it("isolates one failing subscriber so the rest still receive the event", () => {
    const hub = createEventHub();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    hub.subscribe(bad);
    hub.subscribe(good);

    expect(() => hub.broadcast("state-changed", "{}")).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});
