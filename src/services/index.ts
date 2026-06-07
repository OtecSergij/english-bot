import { config } from '../config';
import type { DictionaryProvider } from './dictionary/types';
import { YandexDictionary } from './dictionary/yandex';
import type { LlmProvider } from './llm/types';
import { AiSdkLlm } from './llm/aisdk';
import { createLlmModel } from './llm/model';

export interface Services {
  dictionary: DictionaryProvider;
  llm: LlmProvider;
}

/** DI seam — providers are constructed here and injected into flows. */
export function createServices(): Services {
  return {
    dictionary: new YandexDictionary(config.yandexDictKey),
    llm: new AiSdkLlm(createLlmModel()),
  };
}
