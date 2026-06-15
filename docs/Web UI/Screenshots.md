# Screenshots

A screenshot attached to a key shows *where* a string appears in your UI. Vision-capable AI models use it as context, which markedly improves ambiguous strings.

## Attaching a screenshot

Attach an image to a key from its detail panel in the Editor, or manage images across keys in the **Screenshots** panel.

## How the AI uses them

During translation, a key's screenshot is sent **only to vision-capable models**:

- **Supported:** Anthropic, OpenAI (gpt-4o-class), AWS Bedrock (Nova, Claude).
- **Not supported:** AWS Bedrock Meta Llama text models — those runs proceed text-only and print a warning noting how many screenshots were skipped.

So screenshots are always safe to attach: models that can't see them simply ignore them. See AI Providers for the full support matrix.

> **Info:** Screenshots never appear in the AI log — the AI Log records what was sent to a provider, but **not** the image bytes themselves — only that a key had a screenshot.

## Related

- Key Context and Metadata · How Translation Works · AI Providers
