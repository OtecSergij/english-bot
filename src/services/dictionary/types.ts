import type { Direction } from '../../domain';

/** One MEANING of a word (a Yandex `tr`), not a part-of-speech group. */
export interface DictionarySense {
  /** Part of speech, for context. */
  pos?: string;
  /** Russian disambiguation gloss (Yandex `tr.mean`) — used in the chooser label. */
  gloss?: string;
  /** The single accepted translation for this meaning (design-doc.md §4). */
  translation: string;
}

export interface DictionaryResult {
  word: string;
  direction: Direction;
  /** One entry per meaning. Empty => not found; caller falls back to the LLM. */
  senses: DictionarySense[];
}

export interface DictionaryProvider {
  lookup(word: string, direction: Direction): Promise<DictionaryResult>;
}
