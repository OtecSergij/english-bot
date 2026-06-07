import type { Direction, Lang } from '../domain';

const CYRILLIC = /[Ѐ-ӿ]/;

/** Detect input language by alphabet (design-doc.md §4). */
export function detectLang(text: string): Lang {
  return CYRILLIC.test(text) ? 'ru' : 'en';
}

export function lookupDirection(lang: Lang): Direction {
  return lang === 'ru' ? 'ru-en' : 'en-ru';
}
