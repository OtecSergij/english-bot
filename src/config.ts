import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function requiredInt(name: string): number {
  const n = Number(required(name));
  if (!Number.isInteger(n)) {
    throw new Error(`Env var ${name} must be an integer, got: ${process.env[name]}`);
  }
  return n;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  yandexDictKey: required('YANDEX_DICT_KEY'),
  geminiApiKey: required('GEMINI_API_KEY'),
  databaseUrl: required('DATABASE_URL'),
  // The only security boundary — must be a real integer, not NaN (design-doc.md §2).
  ownerChatId: requiredInt('OWNER_CHAT_ID'),
} as const;
