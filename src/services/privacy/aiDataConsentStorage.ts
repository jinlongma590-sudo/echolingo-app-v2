import * as SecureStore from 'expo-secure-store';

const AI_DATA_CONSENT_KEY = 'echolingo.ai_data_consent.v1';

type StoredAiDataConsent = {
  consentedAt: string;
  version: 1;
};

function warn(event: string, error: unknown) {
  console.warn(event, error instanceof Error ? error.message : String(error ?? 'unknown_error'));
}

function parseStoredConsent(raw: string | null): StoredAiDataConsent | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAiDataConsent>;
    if (parsed?.version === 1 && typeof parsed.consentedAt === 'string' && parsed.consentedAt.trim()) {
      return {
        consentedAt: parsed.consentedAt,
        version: 1,
      };
    }
  } catch (error) {
    warn('ai_data_consent_parse_failed', error);
  }

  return null;
}

export async function loadAiDataConsent() {
  try {
    const raw = await SecureStore.getItemAsync(AI_DATA_CONSENT_KEY);
    return parseStoredConsent(raw);
  } catch (error) {
    warn('ai_data_consent_load_failed', error);
    return null;
  }
}

export async function saveAiDataConsent() {
  const payload: StoredAiDataConsent = {
    consentedAt: new Date().toISOString(),
    version: 1,
  };

  try {
    await SecureStore.setItemAsync(AI_DATA_CONSENT_KEY, JSON.stringify(payload));
    return payload;
  } catch (error) {
    warn('ai_data_consent_save_failed', error);
    throw error;
  }
}

export async function clearAiDataConsent() {
  try {
    await SecureStore.deleteItemAsync(AI_DATA_CONSENT_KEY);
  } catch (error) {
    warn('ai_data_consent_clear_failed', error);
  }
}
