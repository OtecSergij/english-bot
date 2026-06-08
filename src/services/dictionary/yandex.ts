import type { Direction } from '../../domain';
import type { DictionaryProvider, DictionaryResult, DictionarySense } from './types';

const LOOKUP_URL = 'https://dictionary.yandex.net/api/v1/dicservice.json/lookup';
const TIMEOUT_MS = 8_000;
/** Yandex `flags` bit for morphological search (match inflected forms via the lemma). */
const MORPHO_FLAG = 4;
/** Cap on the number of meaning-choices we show. */
const MAX_SENSES = 6;
/** Minimum Yandex relevance (`fr`) to keep a meaning; below this is long-tail noise. */
const FR_MIN = 2;

interface YandexText {
  text?: string;
}
interface YandexTr {
  text?: string;
  pos?: string;
  fr?: number;
  mean?: YandexText[];
  // `syn` (synonyms) is deliberately ignored — we keep only the primary translation.
  syn?: YandexText[];
}
interface YandexDef {
  text?: string;
  pos?: string;
  ts?: string;
  tr?: YandexTr[];
}
interface YandexLookupResponse {
  def?: YandexDef[];
  // Present only on errors; the HTTP status can lie, so this is authoritative.
  code?: number;
  message?: string;
}

function cleanList(items: YandexText[] | undefined): string[] {
  return (items ?? [])
    .map((i) => i.text?.trim())
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/**
 * Map a raw Yandex response to senses (design-doc.md §4). A SENSE is one MEANING,
 * which in Yandex is a single `tr` — NOT a `def` (those group by part of speech).
 * We flatten all `tr` across all `def`, drop the low-relevance long tail by `fr`
 * (дом → house/home fr=10, but door/premise fr=1 are noise; a safety net keeps
 * everything if every meaning is low-fr, so a rare word isn't lost to fallback).
 * Each sense keeps ONE translation (`tr.text`); its `mean` is the Russian
 * disambiguation gloss. Synonyms (`tr.syn`) are intentionally dropped — a card
 * has a single accepted answer. So «замок» → castle / lock, «крыло» → wing /
 * fender, each a separate choice (resolves known_issues.md §2). Pure → tested.
 */
export function mapYandexResponse(
  raw: YandexLookupResponse,
  word: string,
  direction: Direction,
): DictionaryResult {
  const all: { fr?: number; sense: DictionarySense }[] = [];
  for (const def of raw.def ?? []) {
    for (const tr of def.tr ?? []) {
      const translation = tr.text?.trim();
      if (!translation) continue;
      // All Russian `mean` hints — shown in the chooser MESSAGE TEXT (which wraps),
      // not on a button, so length is fine.
      const gloss = cleanList(tr.mean).join(', ') || undefined;
      all.push({ fr: tr.fr, sense: { pos: tr.pos ?? def.pos, gloss, translation } });
    }
  }
  const relevant = all.filter((s) => s.fr === undefined || s.fr >= FR_MIN);
  const chosen = (relevant.length > 0 ? relevant : all).slice(0, MAX_SENSES);
  return { word, direction, senses: chosen.map((s) => s.sense) };
}

/**
 * Yandex Dictionary provider (design-doc.md §2, §4). Plain GET, key in the query
 * string. An empty `def[]` (no error) means "not found".
 *
 * Two-stage lookup. First the EXACT form the user typed (no flags) — dictionary
 * forms (дом, крыло) get clean sense lists. Only if that's empty do we retry with
 * MORPHO (morphological search), which rescues inflected forms (продолжаем →
 * продолжать → continue, идём → идти → go) before the caller gives up to the LLM.
 * MORPHO is the fallback, not the default, because it pollutes exact matches with
 * spurious cross-lemma senses (крыло → «крыть»=cover, дом → adverb «дома»=at home);
 * trying the exact form first avoids that for words that are already lemmas.
 */
export class YandexDictionary implements DictionaryProvider {
  constructor(private readonly apiKey: string) {}

  async lookup(word: string, direction: Direction): Promise<DictionaryResult> {
    const exact = await this.request(word, direction, 0);
    if (exact.senses.length > 0) return exact;
    // Not found as typed — retry by lemma (e.g. an inflected verb/noun form).
    return this.request(word, direction, MORPHO_FLAG);
  }

  private async request(word: string, direction: Direction, flags: number): Promise<DictionaryResult> {
    const url = new URL(LOOKUP_URL);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('lang', direction);
    url.searchParams.set('text', word);
    if (flags) url.searchParams.set('flags', String(flags));

    let raw: YandexLookupResponse;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      raw = (await res.json()) as YandexLookupResponse;
    } catch (err) {
      throw new Error(`Yandex Dictionary request failed: ${String(err)}`);
    }

    // The HTTP status is unreliable (e.g. 403 carrying body code 401), so the
    // authoritative error signal is the body `code` (Yandex spec).
    if (typeof raw.code === 'number' && raw.code !== 200) {
      throw new Error(`Yandex Dictionary error ${raw.code}: ${raw.message ?? 'unknown'}`);
    }
    return mapYandexResponse(raw, word, direction);
  }
}
