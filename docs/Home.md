# Glotfile

> A **local-first, git-native translation manager**. All of your app's copy lives in one JSON file you commit to your repo. You edit and AI-translate it through a local web UI, then export to whatever locale formats your apps consume — no SaaS, no hosted database, nothing leaves your machine except the AI calls you choose to make.

This is the home page of the user guide. Everything is linked from here.

## Start here

- Installation — requirements and how to run Glotfile
- Quick Start — from zero to translated strings in five minutes
- Translation Workflow — the day-to-day loop, end to end

## Frameworks

How to wire Glotfile into your stack — config, import, and the export the framework consumes:

- Flutter (ARB) · Laravel · Vue I18n · Angular · Rails · Apple (iOS & macOS)

## Core concepts

- The State File — `glotfile.json`, the single source of truth
- Keys and Locales — how strings and languages are organised
- Review States — `source` → `machine` → `reviewed` / `needs-review`
- Plurals — CLDR plural forms
- Glossary — do-not-translate and forced terms
- Key Context and Metadata — context, notes, tags, length limits, screenshots

## The web UI

- Web UI Overview — the panels and how they fit together
- Editor · Analytics · Screenshots · Settings · AI Log

## The command line

- CLI Overview — every command at a glance
- serve · translate · export · lint and check · import

## AI translation

- How Translation Works — what the translator does for you
- AI Providers — Anthropic, OpenAI, AWS Bedrock, and OpenRouter setup

## Reference

- Output Formats — the six export adapters
- Checks and Validation — every rule and what it catches
- Configuration Reference — every field in `config`
- Placeholders and ICU — what's preserved across formats

## Guides

- Translation Workflow — author → translate → review → export
- Continuous Integration — gate merges on translation health
- Keeping Translations Fresh — handling source changes

## Help

- Troubleshooting and FAQ
