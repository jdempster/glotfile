import type { AiConfig } from "../schema.js";
import type { TranslationProvider } from "./provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { BedrockProvider } from "./bedrock.js";
import { OpenRouterProvider } from "./openrouter.js";
import { OllamaProvider } from "./ollama.js";
import { ClaudeCodeProvider } from "./claudecode.js";

// Takes the resolved AiConfig (from the project's local settings, not committed config).
export function makeProvider(ai: AiConfig): TranslationProvider {
  switch (ai.provider) {
    case "anthropic": return new AnthropicProvider(ai);
    case "openai": return new OpenAIProvider(ai);
    case "bedrock": return new BedrockProvider(ai);
    case "openrouter": return new OpenRouterProvider(ai);
    case "ollama": return new OllamaProvider(ai);
    case "claude-code": return new ClaudeCodeProvider(ai);
    default:
      throw new Error(`Unknown AI provider "${String(ai.provider)}". Supported: anthropic, openai, bedrock, openrouter, ollama, claude-code.`);
  }
}
