import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { Button } from "./button/index.js";

describe("Button", () => {
  it("renders its slot text", () => {
    const wrapper = mount(Button, { slots: { default: "Save key" } });
    expect(wrapper.text()).toBe("Save key");
  });

  it("applies a variant class", () => {
    const wrapper = mount(Button, { props: { variant: "destructive" } });
    expect(wrapper.classes()).toContain("bg-destructive");
  });
});
