import { describe, it, expect, beforeEach, vi } from "vitest";
import { classifyToken, applyChatLink } from "./chatLinks";
import { knownKeys, knownLocales } from "./keyIndex";
import * as drilldown from "./drilldown";

describe("classifyToken", () => {
  beforeEach(() => {
    knownKeys.value = new Set(["plant.water", "plant.feed"]);
    knownLocales.value = new Set(["de", "pt-br"]);
  });

  it("classifies a known key path as a key link", () => {
    expect(classifyToken("plant.feed")).toEqual({ kind: "key", key: "plant.feed" });
  });

  it("classifies review-state tokens (and synonyms) as state links", () => {
    expect(classifyToken("needs-review")).toEqual({ kind: "state", state: "needs-review" });
    expect(classifyToken("machine")).toEqual({ kind: "state", state: "machine" });
    expect(classifyToken("untranslated")).toEqual({ kind: "state", state: "missing" });
    expect(classifyToken("missing")).toEqual({ kind: "state", state: "missing" });
  });

  it("classifies a project target locale as a locale link, case-insensitively", () => {
    expect(classifyToken("de")).toEqual({ kind: "locale", locale: "de" });
    expect(classifyToken("pt-BR")).toEqual({ kind: "locale", locale: "pt-br" });
  });

  it("leaves a locale that isn't on the project inert", () => {
    expect(classifyToken("ja")).toBeNull();
  });

  it("leaves arbitrary code spans (source strings, unknown words) inert", () => {
    expect(classifyToken("Water your plant")).toBeNull();
    expect(classifyToken("{gardener}")).toBeNull();
    expect(classifyToken("")).toBeNull();
  });

  it("a real key wins over a same-spelled state/locale keyword", () => {
    knownKeys.value = new Set(["reviewed"]);
    expect(classifyToken("reviewed")).toEqual({ kind: "key", key: "reviewed" });
  });
});

describe("applyChatLink", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("opens a key via drillToKey", () => {
    const spy = vi.spyOn(drilldown, "drillToKey").mockImplementation(() => {});
    applyChatLink({ kind: "key", key: "plant.feed" });
    expect(spy).toHaveBeenCalledWith("plant.feed");
  });

  it("filters to a review state via drillTo", () => {
    const spy = vi.spyOn(drilldown, "drillTo").mockImplementation(() => {});
    applyChatLink({ kind: "state", state: "needs-review" });
    expect(spy).toHaveBeenCalledWith({ states: ["needs-review"] });
  });

  it("focuses a locale via drillTo", () => {
    const spy = vi.spyOn(drilldown, "drillTo").mockImplementation(() => {});
    applyChatLink({ kind: "locale", locale: "de" });
    expect(spy).toHaveBeenCalledWith({ locale: "de" });
  });
});
