import { createGroq } from '@ai-sdk/groq';
import type { LanguageModel } from 'ai';
import { config } from '../../config';

/**
 * Default model per provider (override via `LLM_MODEL`). For Groq we need a model
 * that supports `json_schema` structured output — the `openai/gpt-oss-*` family
 * does (verified against the live Groq docs); Llama/Qwen would instead require
 * `providerOptions.groq.structuredOutputs = false`.
 */
const DEFAULT_MODEL: Record<string, string> = {
  groq: 'openai/gpt-oss-120b',
};

/**
 * Build the active LLM model from config (design-doc.md §2). To add a provider:
 * install its `@ai-sdk/*` adapter, add a branch here, and a branch in
 * `config.resolveLlm`.
 */
export function createLlmModel(): LanguageModel {
  const { provider, model, apiKey } = config.llm;
  const modelId = model ?? DEFAULT_MODEL[provider] ?? '';
  switch (provider) {
    case 'groq':
      return createGroq({ apiKey })(modelId);
    default:
      throw new Error(`Unsupported LLM provider: ${String(provider)}`);
  }
}
