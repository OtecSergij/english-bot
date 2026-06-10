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

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`Env var ${name} must be an integer, got: ${value}`);
  }
  return n;
}

function optionalTz(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    // Throws RangeError for an unknown IANA timezone.
    Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new Error(`Env var ${name} is not a valid IANA timezone: ${value}`);
  }
  return value;
}

/** LLM providers we can construct. Add more as @ai-sdk/* adapters are installed. */
const SUPPORTED_LLM_PROVIDERS = ['groq'] as const;

/**
 * Resolve the active LLM provider (design-doc.md §2). The provider is swappable
 * via `LLM_PROVIDER`; only the SELECTED provider's API key is required, so you
 * don't need keys for providers you aren't using. Model is overridable via
 * `LLM_MODEL` (otherwise a per-provider default applies in services/llm/model.ts).
 */
function resolveLlm(): { provider: 'groq'; model: string | undefined; apiKey: string } {
  const provider = process.env.LLM_PROVIDER?.trim() || 'groq';
  const model = process.env.LLM_MODEL?.trim() || undefined;
  switch (provider) {
    case 'groq':
      return { provider, model, apiKey: required('GROQ_API_KEY') };
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER: ${provider} (supported: ${SUPPORTED_LLM_PROVIDERS.join(', ')})`,
      );
  }
}

export const config = {
  botToken: required('BOT_TOKEN'),
  yandexDictKey: required('YANDEX_DICT_KEY'),
  llm: resolveLlm(),
  databaseUrl: required('DATABASE_URL'),
  // The only security boundary — must be a real integer, not NaN (design-doc.md §2).
  ownerChatId: requiredInt('OWNER_CHAT_ID'),
  // Owner timezone for SRS dates; temporary single-user solution (known_issues.md §6).
  ownerTz: optionalTz('OWNER_TZ', 'UTC'),
  // Localhost liveness endpoint for the container healthcheck (src/health.ts).
  healthPort: optionalInt('HEALTH_PORT', 8080),
} as const;
