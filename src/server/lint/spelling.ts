import { getSpeller, spellTokens } from "../spell.js";
import type { Rule, RawFinding, Speller } from "./types.js";

export const spellingRule: Rule = {
  id: "spelling",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      for (const locale of ctx.targetLocales) {
        const speller = ctx.spellers.get(locale);
        if (!speller) continue;
        const value = entry.values[locale]?.value;
        if (!value) continue;
        for (const word of spellTokens(value)) {
          if (ctx.allowWords.has(word.toLowerCase())) continue;
          if (!speller.correct(word)) {
            out.push({ ruleId: "spelling", key, locale, message: `possible misspelling: "${word}"` });
          }
        }
      }
    }
    return out;
  },
};

export type DictionaryLoader = (dictId: string) => Promise<Speller | null>;

export const defaultLoader: DictionaryLoader = (dictId) => getSpeller(dictId);
