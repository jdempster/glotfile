import { describe, it, expect } from "vitest";
import { laravelToCanonical, railsToCanonical } from "./placeholders.js";

describe("laravelToCanonical", () => {
  it("converts :name to {name}", () => {
    expect(laravelToCanonical("Hello :name")).toBe("Hello {name}");
  });

  it("leaves URLs intact", () => {
    expect(laravelToCanonical("See https://example.com")).toBe("See https://example.com");
  });

  it("leaves time strings intact", () => {
    expect(laravelToCanonical("At 12:30")).toBe("At 12:30");
  });

  it("converts multiple placeholders", () => {
    expect(laravelToCanonical(":first and :last")).toBe("{first} and {last}");
  });

  it("treats a bare {name} as a literal — Laravel interpolates :name, not braces", () => {
    expect(laravelToCanonical("Visit {site}")).toBe("Visit '{site}'");
    expect(laravelToCanonical("Hi :name, visit {site}")).toBe("Hi {name}, visit '{site}'");
  });
});

describe("railsToCanonical", () => {
  it("converts %{name} to {name}", () => {
    expect(railsToCanonical("Welcome %{name}")).toBe("Welcome {name}");
  });
  it("treats a bare {name} as a literal — Rails interpolates %{name}, not braces", () => {
    expect(railsToCanonical("Visit {site}")).toBe("Visit '{site}'");
    expect(railsToCanonical("%{count} of {total}")).toBe("{count} of '{total}'");
  });
});
