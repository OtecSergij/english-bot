import type { Direction } from '../../lib/lang';
import type { Example, FallbackTranslation, LlmProvider } from './types';

/**
 * Gemini LLM provider — STUB.
 * TODO: call Gemini 2.5 Flash / Flash-Lite for example generation and rare-word
 * fallback translation (design-doc.md §2, §4).
 */
export class GeminiLlm implements LlmProvider {
  constructor(private readonly apiKey: string) {}

  generateExample(_word: string, _translation: string, _direction: Direction): Promise<Example> {
    throw new Error('GeminiLlm.generateExample not implemented');
  }

  fallbackTranslate(_word: string, _direction: Direction): Promise<FallbackTranslation> {
    throw new Error('GeminiLlm.fallbackTranslate not implemented');
  }
}
