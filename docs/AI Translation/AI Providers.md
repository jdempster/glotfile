# AI Providers

Glotfile translates via **one provider at a time**, chosen by the `ai.provider` setting. These AI settings are **per-machine** — they live in `.glotfile/settings.json` (gitignored), not in the committed `glotfile.json`, so each developer can use their own provider and model. Edit them in Settings and re-run translate. Credentials are read from the environment, including a local `.env` file in the project directory.

## Supported providers

| Provider | `provider` | Credentials | Region / endpoint | SDK |
|---|---|---|---|---|
| **Anthropic** (default) | `anthropic` | `ANTHROPIC_API_KEY` | `endpoint` (base URL) | bundled (`@anthropic-ai/sdk`) |
| **OpenAI** | `openai` | `OPENAI_API_KEY` | `endpoint` (base URL; also reaches any OpenAI-compatible gateway) | optional — `npm i openai` |
| **AWS Bedrock** | `bedrock` | standard AWS chain: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (/ `AWS_SESSION_TOKEN`), or `AWS_PROFILE`, or an SSO / instance role | `region` (falls back to `AWS_REGION`) | optional — `npm i @aws-sdk/client-bedrock-runtime` |
| **OpenRouter** | `openrouter` | `OPENROUTER_API_KEY` | `endpoint` (base URL; defaults to `https://openrouter.ai/api/v1`) | optional — `npm i openai` (OpenAI-compatible) |
| **Ollama** (local) | `ollama` | none for local; `OLLAMA_API_KEY` only for a secured / remote server | `endpoint` (base URL; defaults to `http://localhost:11434/v1`) | optional — `npm i openai` (OpenAI-compatible) |
| **Claude Code** (local) | `claude-code` | none — uses your local Claude Code session | n/a | none — spawns the `claude` CLI |

> **Info:** Optional SDKs load on demand — the OpenAI SDK (also used by OpenRouter) and the AWS SDK are optional dependencies, loaded only when their provider is selected — so a default install stays small. If the SDK is missing when you translate, Glotfile tells you exactly what to install.

## The `ai` settings

Stored per-machine in `.glotfile/settings.json` (gitignored). The default:

```json
"ai": { "provider": "anthropic", "model": "claude-sonnet-4-6", "endpoint": null, "region": null, "batchSize": 25 }
```

| Field | Meaning |
|---|---|
| `provider` | `anthropic`, `openai`, `bedrock`, `openrouter`, `ollama`, or `claude-code`. |
| `model` | The model id for the chosen provider. |
| `endpoint` | Base URL override (Anthropic / OpenAI / OpenRouter / Ollama). `null` for the provider default — OpenRouter defaults to `https://openrouter.ai/api/v1`, Ollama to `http://localhost:11434/v1`. An overridden Ollama endpoint must include the `/v1` suffix. |
| `region` | AWS region (Bedrock). Falls back to `AWS_REGION`. |
| `batchSize` | Strings per request (default `25`). |

## Examples

**OpenAI:**
```json
"ai": { "provider": "openai", "model": "gpt-4o-mini", "endpoint": null, "batchSize": 25 }
```

**OpenRouter** (OpenAI-compatible; uses namespaced model ids):
```json
"ai": { "provider": "openrouter", "model": "anthropic/claude-3.5-haiku", "endpoint": null, "batchSize": 25 }
```

**Ollama** (local, OpenAI-compatible; no key needed — start Ollama and `ollama pull` the model first):
```json
"ai": { "provider": "ollama", "model": "llama3.2", "endpoint": null, "batchSize": 25 }
```

**Claude Code** (uses your local Claude Code session; no API key needed):
```json
"ai": { "provider": "claude-code", "model": "claude-sonnet-4-6", "endpoint": null, "batchSize": 25 }
```

**AWS Bedrock — Amazon Nova:**
```json
"ai": { "provider": "bedrock", "model": "amazon.nova-pro-v1:0", "endpoint": null, "region": "eu-west-1", "batchSize": 25 }
```

**AWS Bedrock — Claude or Meta Llama** (same provider, different model id):
```json
"ai": { "provider": "bedrock", "model": "anthropic.claude-3-5-sonnet-20241022-v2:0", "region": "us-east-1", "endpoint": null, "batchSize": 25 }
"ai": { "provider": "bedrock", "model": "meta.llama3-1-70b-instruct-v1:0",        "region": "us-east-1", "endpoint": null, "batchSize": 25 }
```

## Vision (screenshots)

Keys with a screenshot are sent to vision-capable models for context:

| Model family | Vision |
|---|---|
| Anthropic | ✅ |
| OpenAI (gpt-4o-class) | ✅ |
| Bedrock — Amazon Nova / Claude | ✅ |
| Bedrock — Meta Llama (text) | ❌ — runs text-only, warns how many screenshots were skipped |
| OpenRouter | ✅ for vision-capable models (e.g. `anthropic/*`, `openai/gpt-4o*`, `google/gemini*`); a text-only model ignores the image |
| Ollama | ❌ — runs text-only (most local models can't see images); screenshots are skipped |
| Claude Code | ❌ — runs text-only via the `claude` CLI subprocess; screenshots are skipped |

## Data residency

AI translation is the only path by which source strings leave your boundary. To keep strings in-region, **pin AWS Bedrock to a region**, or point the Anthropic / OpenAI `endpoint` at an in-region or self-hosted gateway. For the strongest guarantee, **run Ollama locally** — strings never leave the machine. Note that **OpenRouter routes your strings through its service** to the upstream model provider you select — avoid it where data residency is a hard requirement. **No credentials are ever written to `glotfile.json` or logged.**

## Related

- How Translation Works · translate · Settings · AI Log
