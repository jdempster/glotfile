import { describe, it, expect } from "vitest";
import { nextIntlJson } from "./next-intl-json.js";
import { defaultState } from "../schema.js";
import { createKey, setPluralForms } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "index.heading", "Your package");
  s.keys["index.heading"]!.values.fr = { value: "Votre forfait", state: "reviewed" };
  createKey(s, "form.labels.email", "Email {name}");
  return s;
}

describe("next-intl-json", () => {
  it("writes one nested JSON file per locale by default", () => {
    const r = nextIntlJson.export(fixture(), { adapter: "next-intl-json", path: "messages/{locale}.json" });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "messages/en.json",
      "messages/fr.json",
    ]);
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en).toEqual({ index: { heading: "Your package" }, form: { labels: { email: "Email {name}" } } });
  });

  it("emits flat keys when style is 'flat'", () => {
    const r = nextIntlJson.export(fixture(), { adapter: "next-intl-json", path: "messages/{locale}.json", style: "flat" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en).toEqual({ "index.heading": "Your package", "form.labels.email": "Email {name}" });
  });

  it("keeps single-brace {name} placeholders verbatim", () => {
    const r = nextIntlJson.export(fixture(), { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.form.labels.email).toBe("Email {name}");
  });

  it("emits a structured plural as native ICU (not pipe-delimited)", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.cart.items).toBe("{count, plural, one {# item} other {# items}}");
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("fr.json"))!.contents);
    expect(fr.cart.items).toBe("{count, plural, one {# article} other {# articles}}");
  });

  // ICU formats `#` with the locale's number rules but substitutes a bare
  // {count} raw, so emitting the token would print "1234 items" where next-intl
  // users expect "1,234 items".
  it("emits the plural arg as ICU '#', not as a {arg} token", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { other: "{count} items left" };
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.cart.items).toBe("{count, plural, other {# items left}}");
  });

  it("omits a category the locale does not use rather than emitting an empty body", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: undefined, other: "{count} items" };
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.cart.items).toBe("{count, plural, other {# items}}");
  });

  it("leaves non-arg placeholders in a plural body alone", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { other: "{gardener} has {count} of {total}" };
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.cart.items).toBe("{count, plural, other {{gardener} has # of {total}}}");
  });

  it("keeps a quoted-literal '{count}' in a plural body verbatim", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { other: "{count} items, literally '{count}'" };
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.cart.items).toBe("{count, plural, other {# items, literally '{count}'}}");
  });

  // A nested plural rebinds `#` to its own argument, so the outer arg must stay
  // a {token} inside one or it would silently print the inner number.
  it("does not rewrite the outer arg inside a nested plural block", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = {
      other: "{count} of {bags, plural, other {{count} bagged}}",
    };
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.cart.items).toBe("{count, plural, other {# of {bags, plural, other {{count} bagged}}}}");
  });

  it("does not warn lossy on a structured plural key", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    expect(r.warnings.some((w) => w.key === "cart.items")).toBe(false);
  });

  it("passes an ICU select string through natively with no warning", () => {
    const s = fixture();
    createKey(s, "greeting", "{gender, select, male {He} female {She} other {They}}");
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.greeting).toBe("{gender, select, male {He} female {She} other {They}}");
    expect(r.warnings.some((w) => w.key === "greeting")).toBe(false);
  });

  it("passes rich-text <tag> markup through verbatim", () => {
    const s = fixture();
    createKey(s, "form.terms", "Accept <terms>Terms</terms> and <privacy>Privacy</privacy>");
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.form.terms).toBe("Accept <terms>Terms</terms> and <privacy>Privacy</privacy>");
  });

  it("keeps an ICU apostrophe-quoted literal span verbatim (next-intl honours ICU quoting)", () => {
    const s = fixture();
    createKey(s, "tour.line", "Dear {gardener}, see '{site}'");
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.tour.line).toBe("Dear {gardener}, see '{site}'");
  });

  it("omits keys missing in a target locale by default", () => {
    const r = nextIntlJson.export(fixture(), { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("fr.json"))!.contents);
    expect(fr).toEqual({ index: { heading: "Votre forfait" } });
  });

  it("defaults locale codes to lower-hyphen", () => {
    const s = defaultState();
    s.config.locales = ["en-gb", "de-de"];
    s.config.sourceLocale = "en-gb";
    createKey(s, "a", "A");
    const r = nextIntlJson.export(s, { adapter: "next-intl-json", path: "messages/{locale}.json" });
    expect(r.files.map((f) => f.path).sort()).toEqual(["messages/de-de.json", "messages/en-gb.json"]);
  });

  it("re-export is byte-identical", () => {
    const a = nextIntlJson.export(fixture(), { adapter: "next-intl-json", path: "messages/{locale}.json" });
    const b = nextIntlJson.export(fixture(), { adapter: "next-intl-json", path: "messages/{locale}.json" });
    expect(b.files).toEqual(a.files);
  });
});
