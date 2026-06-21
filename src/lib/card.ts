import type { Lang } from '../domain';
import type { DictionarySense } from '../services/dictionary/types';
import type { Example } from '../services/llm/types';

export type WordSource = 'dictionary' | 'fallback';

/** A word card ready to persist (design-doc.md §4, §11). Always RU→EN. */
export interface WordCard {
  /** Prompt shown during the review session — always a single Russian word. */
  russian: string;
  /** The single accepted English answer. */
  english: string;
  exampleRu: string | null;
  exampleEn: string | null;
  /**
   * Flow-only provenance (design-doc.md §4): drives the pre-save «проверь» nudge for
   * LLM fallback cards. NOT persisted — after save the user has confirmed the card and
   * nothing reads it back, so the DB column was dropped (design-doc.md §11).
   */
  source: WordSource;
}

function exampleFields(example: Example): Pick<WordCard, 'exampleRu' | 'exampleEn'> {
  const ru = example.ru.trim();
  const en = example.en.trim();
  // Keep both or neither — a half example is worse than none.
  return ru && en ? { exampleRu: ru, exampleEn: en } : { exampleRu: null, exampleEn: null };
}

/** Replace a card's example (both-or-neither rule) — used when regenerating it. */
export function withExample(card: WordCard, example: Example): WordCard {
  return { ...card, ...exampleFields(example) };
}

/**
 * Build a card from a chosen dictionary sense (design-doc.md §4). Learning is
 * always RU→EN regardless of which language was typed:
 * - RU input: prompt = the input word; answer = the sense's translation.
 * - EN input: answer = the input word; prompt = the sense's Russian translation.
 */
export function buildCardFromSense(
  input: string,
  lang: Lang,
  sense: DictionarySense,
  example: Example,
): WordCard {
  const base = { source: 'dictionary' as const, ...exampleFields(example) };
  if (lang === 'ru') {
    return { russian: input, english: sense.translation, ...base };
  }
  return { russian: sense.translation, english: input, ...base };
}

/**
 * Build a card from the rare-word LLM fallback (design-doc.md §4; the unverifiable
 * accepted risk is known_issues.md §5). Single translation, marked source=fallback.
 */
export function buildCardFromFallback(
  input: string,
  lang: Lang,
  translation: string,
  example: Example,
): WordCard {
  const base = { source: 'fallback' as const, ...exampleFields(example) };
  if (lang === 'ru') {
    return { russian: input, english: translation, ...base };
  }
  return { russian: translation, english: input, ...base };
}

/**
 * Override a card's translation with the user's own (design-doc.md §4). Sets the side
 * the user typed, by direction (RU input → english; EN input → the russian prompt),
 * marks the card non-fallback so the «проверь» nudge drops, and clears the example —
 * the old one was made for the previous translation, so the caller regenerates it.
 */
export function withManualTranslation(card: WordCard, text: string, lang: Lang): WordCard {
  const base: WordCard = { ...card, source: 'dictionary', exampleRu: null, exampleEn: null };
  return lang === 'ru' ? { ...base, english: text } : { ...base, russian: text };
}
