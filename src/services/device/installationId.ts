import * as SecureStore from 'expo-secure-store';

export const INSTALLATION_ID_SECURE_KEY = 'echolingo_installation_id';

let installationIdPromise: Promise<string> | null = null;

function randomHex(length: number) {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += Math.floor(Math.random() * 16).toString(16);
  }
  return output;
}

function createUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${randomHex(3)}-${randomHex(12)}`;
}

export async function getOrCreateInstallationId(): Promise<string> {
  if (installationIdPromise) {
    return installationIdPromise;
  }

  installationIdPromise = (async () => {
    const existing = await SecureStore.getItemAsync(INSTALLATION_ID_SECURE_KEY);
    if (existing?.trim()) {
      return existing.trim();
    }

    const next = createUuid();
    await SecureStore.setItemAsync(INSTALLATION_ID_SECURE_KEY, next);
    return next;
  })();

  try {
    return await installationIdPromise;
  } finally {
    installationIdPromise = null;
  }
}
