import type { Direction } from '../../domain';
import type { DictionaryProvider, DictionaryResult } from './types';

/**
 * Yandex Dictionary provider — STUB.
 * TODO: call https://dictionary.yandex.net/api/v1/dicservice.json/lookup, then map
 * `def[]` -> senses, `def.tr[]` -> translations (top-3), `tr.mean` -> gloss (design-doc.md §4).
 */
export class YandexDictionary implements DictionaryProvider {
  constructor(private readonly apiKey: string) {}

  lookup(_word: string, _direction: Direction): Promise<DictionaryResult> {
    throw new Error('YandexDictionary.lookup not implemented');
  }
}
