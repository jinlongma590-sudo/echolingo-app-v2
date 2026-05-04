import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

import type { StoredSession } from '@/types/auth';

export const AUTH_SESSION_SECURE_KEY = 'echolingo.auth.session.v1';

const LEGACY_SESSION_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}echolingo-auth-session.json`
  : null;

function log(event: string, payload: Record<string, unknown>) {
  if (typeof __DEV__ === 'boolean' && __DEV__) {
    console.log(event, payload);
  }
}

function warn(event: string, error: unknown) {
  console.warn(event, error instanceof Error ? error.message : String(error ?? 'unknown_error'));
}

function parseSession(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch (error) {
    warn('auth_session_secure_parse_failed', error);
    return null;
  }
}

async function readLegacyFileSession() {
  if (!LEGACY_SESSION_FILE) return null;

  try {
    const info = await FileSystem.getInfoAsync(LEGACY_SESSION_FILE);
    if (!info.exists) return null;

    const raw = await FileSystem.readAsStringAsync(LEGACY_SESSION_FILE);
    return parseSession(raw);
  } catch (error) {
    warn('auth_session_legacy_read_failed', error);
    return null;
  }
}

async function clearLegacyFileSession() {
  if (!LEGACY_SESSION_FILE) return;

  try {
    await FileSystem.deleteAsync(LEGACY_SESSION_FILE, { idempotent: true });
  } catch (error) {
    warn('auth_session_legacy_clear_failed', error);
  }
}

export async function saveAuthSession(session: StoredSession | null) {
  try {
    if (!session) {
      await SecureStore.deleteItemAsync(AUTH_SESSION_SECURE_KEY);
      return;
    }

    await SecureStore.setItemAsync(AUTH_SESSION_SECURE_KEY, JSON.stringify(session));
  } catch (error) {
    warn('auth_session_secure_save_failed', error);
  }
}

export async function loadAuthSession() {
  try {
    const raw = await SecureStore.getItemAsync(AUTH_SESSION_SECURE_KEY);
    const session = parseSession(raw);
    log('auth_session_secure_load', {
      found: Boolean(raw),
      parsed: Boolean(session),
      source: 'secure_store',
    });
    return session;
  } catch (error) {
    warn('auth_session_secure_load_failed', error);
    return null;
  }
}

export async function clearAuthSession() {
  await saveAuthSession(null);
  await clearLegacyFileSession();
  log('auth_session_secure_clear', {
    clearedSecureStore: true,
    clearedLegacyFile: true,
  });
}

export async function migrateLegacyFileSessionIfNeeded() {
  const secureSession = await loadAuthSession();
  if (secureSession) {
    return secureSession;
  }

  const legacySession = await readLegacyFileSession();
  if (!legacySession) return null;

  try {
    await SecureStore.setItemAsync(AUTH_SESSION_SECURE_KEY, JSON.stringify(legacySession));
    await clearLegacyFileSession();
    log('auth_session_legacy_migrated', {
      hadLegacyFile: true,
      migrated: true,
    });
    return legacySession;
  } catch (error) {
    warn('auth_session_legacy_migration_failed', error);
    log('auth_session_legacy_migration_failed', {
      hadLegacyFile: true,
      migrated: false,
    });
    return legacySession;
  }
}
