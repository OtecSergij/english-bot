import type { Direction } from '../../lib/lang';

export interface Example {
  /** Sentence in Russian (cards are always RU→EN, design-doc.md §4). */
  ru: string;
  /** Its English translation. */
  en: string;
}

export interface FallbackTranslation {
  translation: string;
  example: Example;
}

export interface LlmProvider {
  /** Generate one example sentence for a (word, chosen translation) pair. */
  generateExample(word: string, translation: string, direction: Direction): Promise<Example>;
  /** Rare-word fallback: translation + example in one call (source=fallback). */
  fallbackTranslate(word: string, direction: Direction): Promise<FallbackTranslation>;
}
