export type AuthStatus = 'guest' | 'authenticated';

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SessionState {
  status: AuthStatus;
  isHydrating: boolean;
  user: SessionUser | null;
  authStateReason: 'expired' | null;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  tokenType: string;
  user: SessionUser | null;
}
