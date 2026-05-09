import React, { PropsWithChildren, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { SessionState, SessionUser, StoredSession } from '@/types/auth';
import {
  clearPersistedSession,
  hydrateStoredSession,
  persistStoredSession,
  signInWithAppleIdentityToken,
  signInWithPassword,
  signUpWithPassword,
  signOut,
} from '@/services/auth/client';

interface AppSessionContextValue extends SessionState {
  session: StoredSession | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithApple: (identityToken: string, nonce?: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<StoredSession | null>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<StoredSession | null>;
  invalidateSession: () => Promise<void>;
  updateSessionUser: (patch: Partial<SessionUser>) => Promise<void>;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [authStateReason, setAuthStateReason] = useState<'expired' | null>(null);
  const refreshInFlightRef = useRef<Promise<StoredSession | null> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const authGenerationRef = useRef(0);

  const bumpAuthGeneration = () => {
    authGenerationRef.current += 1;
  };

  const refreshSession = async () => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const generationAtStart = authGenerationRef.current;
    setIsHydrating(true);
    const task = (async () => {
      try {
        const next = await hydrateStoredSession();
        if (authGenerationRef.current !== generationAtStart) {
          return null;
        }
        bumpAuthGeneration();
        setSession(next);
        if (next) {
          setAuthStateReason(null);
        }
        bumpAuthGeneration();
        return next;
      } finally {
        setIsHydrating(false);
      }
    })();

    refreshInFlightRef.current = task;

    try {
      return await task;
    } finally {
      refreshInFlightRef.current = null;
    }
  };

  const invalidateSession = async () => {
    bumpAuthGeneration();
    await clearPersistedSession();
    setSession(null);
    setAuthStateReason('expired');
    setIsHydrating(false);
    bumpAuthGeneration();
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    appStateRef.current = AppState.currentState;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground =
        appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;

      if (nextState === 'active' && wasBackground) {
        void refreshSession();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const value = useMemo<AppSessionContextValue>(
    () => ({
      status: session ? 'authenticated' : 'guest',
      isHydrating,
      user: session?.user ?? null,
      authStateReason,
      session,
      signIn: async (email, password) => {
        const next = await signInWithPassword(email, password);
        bumpAuthGeneration();
        setSession(next);
        setAuthStateReason(null);
        bumpAuthGeneration();
      },
      signInWithApple: async (identityToken, nonce) => {
        const next = await signInWithAppleIdentityToken(identityToken, nonce);
        bumpAuthGeneration();
        setSession(next);
        setAuthStateReason(null);
        bumpAuthGeneration();
      },
      signUp: async (email, password) => {
        const next = await signUpWithPassword(email, password);
        if (next) {
          bumpAuthGeneration();
          setSession(next);
          setAuthStateReason(null);
          bumpAuthGeneration();
        }
        return next;
      },
      signOut: async () => {
        bumpAuthGeneration();
        await signOut(session);
        setSession(null);
        setAuthStateReason(null);
        bumpAuthGeneration();
      },
      refreshSession,
      invalidateSession,
      updateSessionUser: async (patch) => {
        if (!session?.user) return;
        const nextSession: StoredSession = {
          ...session,
          user: {
            ...session.user,
            ...patch,
          },
        };
        bumpAuthGeneration();
        setSession(nextSession);
        await persistStoredSession(nextSession);
        bumpAuthGeneration();
      },
    }),
    [authStateReason, isHydrating, session],
  );

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const context = useContext(AppSessionContext);
  if (!context) {
    throw new Error('useAppSession must be used within AppSessionProvider');
  }
  return context;
}
