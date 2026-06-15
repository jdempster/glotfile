# AI Log

The AI Log is a record of recent translation runs — what was sent to the provider and what came back. It's useful for understanding why a translation turned out the way it did, and for auditing what left your machine.

## What each entry records

For every run:

- **When** it ran and the **model** used.
- The **system prompt** that framed the request.
- Per string: the **key**, **source**, **target locale**, the **context** and relevant **glossary** hints sent, and whether the key had a **screenshot**.
- The **results** returned (translation or plural forms, or an error).

## What it deliberately does *not* record

> **⚠ The log is egress-only and credential-free**
> - **No API keys** are ever written to the log (or to `glotfile.json`).
> - **No screenshot bytes** — only the fact that a key had one.

In other words: the AI Log shows exactly what crossed the network boundary, and nothing more.

## Related

- How Translation Works · AI Providers
