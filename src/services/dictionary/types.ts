import type { Direction } from '../../lib/lang';

export interface DictionarySense {
  pos?: string;
  /** Russian gloss to label the sense in a chooser (from Yandex `tr.mean`). */
  gloss?: string;
  /** Accepted translations for this sense (top-N). */
  translations: string[];
}

export interface DictionaryResult {
  word: string;
  direction: Direction;
  /** Empty array => not found; caller falls back to the LLM. */
  senses: DictionarySense[];
}

export interface DictionaryProvider {
  lookup(word: string, direction: Direction): Promise<DictionaryResult>;
}
