import type { Direction } from '../../domain';

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
  /**
   * Generate one RU→EN example pair for a (russian, english) word pair: `ru` is a
   * natural Russian sentence containing the Russian word, `en` is its English
   * translation containing the English word (design-doc.md §4).
   */
  generateExample(russian: string, english: string): Promise<Example>;
  /** Rare-word fallback: translation + example in one call (source=fallback). */
  fallbackTranslate(word: string, direction: Direction): Promise<FallbackTranslation>;
}
