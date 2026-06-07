import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Direction } from '../../domain';
import type { Example, FallbackTranslation, LlmProvider } from './types';

/** Per-call timeout for LLM requests (AI SDK auto-retries 429/5xx within this). */
const TIMEOUT_MS = 20_000;

const exampleSchema = z.object({
  ru: z.string().describe('The example sentence in Russian.'),
  en: z.string().describe('Its English translation.'),
});

const fallbackSchema = z.object({
  translation: z.string().describe('The translation — a single word or short phrase.'),
  example: z.object({
    ru: z.string().describe('A short Russian sentence.'),
    en: z.string().describe('Its English translation.'),
  }),
});

/**
 * LLM provider via the Vercel AI SDK (design-doc.md §2, §3). Provider-agnostic:
 * the concrete model is injected (see services/llm/model.ts), so swapping
 * providers is a config change. Used ONLY where an LLM error is cheap and
 * user-visible — example generation and rare-word fallback.
 *
 * `generateObject` returns a schema-validated `.object` (or throws). It is
 * `@deprecated` in AI SDK v6 (migration path: `generateText` + `Output.object`,
 * read via the experimental `result.output`), but remains the simplest stable
 * surface that returns a clean, validated object.
 */
export class AiSdkLlm implements LlmProvider {
  constructor(private readonly model: LanguageModel) {}

  async generateExample(russian: string, english: string): Promise<Example> {
    const { object } = await generateObject({
      model: this.model,
      schema: exampleSchema,
      schemaName: 'example',
      system:
        'You are a vocabulary tutor for a Russian speaker learning English. ' +
        'Write simple, natural, everyday sentences.',
      prompt:
        `Russian word: "${russian}". Its English translation: "${english}".\n` +
        'Write ONE short, natural example sentence. Respond with:\n' +
        `- "ru": the sentence in Russian, using the word "${russian}";\n` +
        `- "en": its accurate English translation, using the word "${english}".`,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return object;
  }

  async fallbackTranslate(word: string, direction: Direction): Promise<FallbackTranslation> {
    const fromLang = direction === 'ru-en' ? 'Russian' : 'English';
    const toLang = direction === 'ru-en' ? 'English' : 'Russian';
    const { object } = await generateObject({
      model: this.model,
      schema: fallbackSchema,
      schemaName: 'translation',
      system: 'You are a bilingual Russian–English dictionary and tutor.',
      prompt:
        `Translate the ${fromLang} word "${word}" into ${toLang}.\n` +
        'Respond with:\n' +
        `- "translation": the ${toLang} translation (a single word or short phrase);\n` +
        '- "example": a sentence pair where "ru" is Russian text and "en" is its English ' +
        'translation, using the word and its translation naturally.',
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return object;
  }
}
