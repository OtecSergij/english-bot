import { config } from '../config';
import type { DictionaryProvider } from './dictionary/types';
import { YandexDictionary } from './dictionary/yandex';
import type { LlmProvider } from './llm/types';
import { GeminiLlm } from './llm/gemini';

export interface Services {
  dictionary: DictionaryProvider;
  llm: LlmProvider;
}

/** DI seam — providers are constructed here and injected into flows when implemented. */
export function createServices(): Services {
  return {
    dictionary: new YandexDictionary(config.yandexDictKey),
    llm: new GeminiLlm(config.geminiApiKey),
  };
}
