# Troubleshooting and FAQ

## Setup

**`glotfile: command not found`**
Run it with `npx glotfile` (no global install needed), or install globally with `npm i -g glotfile`. From a checkout, build first: `npm install && npm run build && node bin/glotfile.js`. See Installation.

**Wrong Node version**
Glotfile needs Node `^20.19.0 || >=22.12.0`. Check with `node -v`.

## Translation

**"Install the SDK for this provider"**
OpenAI, OpenRouter, and Bedrock need an optional SDK. Install the one for your provider — `npm i openai` (OpenAI or OpenRouter) or `npm i @aws-sdk/client-bedrock-runtime` (Bedrock). See AI Providers.

**No API key / auth errors**
Set the provider's credentials in your environment or a local `.env`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, or the AWS chain. See AI Providers.

**A translation was skipped**
The result failed validation — a dropped placeholder, broken ICU, or an over-length value. Glotfile prints the reason and leaves the value untranslated. See Placeholders and ICU and How Translation Works.

**My reviewed translation didn't change after `translate`**
That's intentional — `reviewed` values are protected from being overwritten. Unmark it first to re-translate.

**Screenshots seem ignored**
The selected model may not support vision (e.g. Bedrock Meta Llama text models). The run proceeds text-only and warns how many screenshots were skipped. See Screenshots.

## Validation and CI

**`check` fails with `output-stale`**
Your exported files don't match the catalog. Run `glotfile export` and commit the result. See Continuous Integration.

**Spelling flags real words**
Add them to the custom dictionary in Settings (`config.spelling.customWords`). The same list silences both the editor's live spell check and the `spelling` lint rule. Glossary terms are accepted automatically. See Checks and Validation.

**A rule is too noisy**
Override its severity (or turn it off) in `config.lint.rules`, or `ignore` certain key globs. See Configuration Reference.

## Files and git

**Can I edit `glotfile.json` by hand?**
You can, but you rarely need to — the UI writes it for you, deterministically. If you do edit it, keep it valid: it's validated on load. See The State File.

**Big diffs on every save**
Check `config.format` (`indent`, `sortKeys`, `finalNewline`). Deterministic formatting keeps diffs minimal. See The State File.

## General

**Do I already have translations I can import?**
Import existing locale files with `glotfile import` — see import. You can also add keys via the Editor.

**Does anything leave my machine?**
Only the AI calls you trigger. The UI is local-only; no credentials or screenshot bytes are ever logged. See AI Log.

## Related

- Home · Installation · AI Providers · Continuous Integration
