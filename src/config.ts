import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  yandexDictKey: required('YANDEX_DICT_KEY'),
  geminiApiKey: required('GEMINI_API_KEY'),
  databaseUrl: required('DATABASE_URL'),
  ownerChatId: Number(required('OWNER_CHAT_ID')),
} as const;
