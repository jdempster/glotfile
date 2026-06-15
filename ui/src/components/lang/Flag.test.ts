import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Flag from "./Flag.vue";

describe("Flag", () => {
  it("renders an <img> for a code with a resolvable flag region", () => {
    const w = mount(Flag, { props: { code: "en" } }); // → US, vendored
    expect(w.find("img").exists()).toBe(true);
    expect(w.find("img").attributes("src")).toMatch(/\.svg/);
  });

  it("renders the Globe fallback when the flag is explicitly neutral", () => {
    const w = mount(Flag, { props: { code: "en", override: { flag: null } } });
    expect(w.find("img").exists()).toBe(false);
    expect(w.find("svg").exists()).toBe(true); // lucide Globe
  });

  it("renders the Globe fallback for a custom code", () => {
    const w = mount(Flag, { props: { code: "en_PIRATE" } });
    expect(w.find("img").exists()).toBe(false);
    expect(w.find("svg").exists()).toBe(true);
  });
});
