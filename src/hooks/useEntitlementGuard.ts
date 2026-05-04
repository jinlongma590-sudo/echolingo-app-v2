import { useRouter, type Href } from 'expo-router';
import { useCallback, useRef } from 'react';

import { useMobileMe } from '@/hooks/useMobileMe';
import { type AppEntryKind, getEntryRequirement } from '@/services/entitlements/entryGuardActions';
import {
  checkAiPracticeAccess,
  checkPremiumAccess,
} from '@/services/entitlements/entitlementRules';
import { useAppSession } from '@/services/auth/AppSessionProvider';

type GuardOptions = {
  onBlocked?: () => void;
};

export function useEntitlementGuard() {
  const router = useRouter();
  const session = useAppSession();
  const { status, data, refresh, error } = useMobileMe();
  const lastRedirectRef = useRef<string | null>(null);

  const navigateToBlockedTarget = useCallback(
    (target?: string) => {
      if (!target) return;
      if (lastRedirectRef.current === target) return;
      lastRedirectRef.current = target;
      router.push(target as Href);
      setTimeout(() => {
        if (lastRedirectRef.current === target) {
          lastRedirectRef.current = null;
        }
      }, 250);
    },
    [router],
  );

  const guardPremiumAccess = useCallback(
    async (options?: GuardOptions) => {
      let snapshot = data;
      if (session.status === 'authenticated' && !snapshot) {
        snapshot = await refresh();
      }

      const result = checkPremiumAccess({
        isSignedIn: session.status === 'authenticated',
        isActivated: Boolean(snapshot?.entitlements.isActivated),
      });

      if (result.allowed) return true;

      options?.onBlocked?.();
      navigateToBlockedTarget(result.redirectTo);
      return false;
    },
    [data, navigateToBlockedTarget, refresh, session.status, status],
  );

  const guardAiPracticeAccess = useCallback(
    async (options?: GuardOptions) => {
      let snapshot = data;
      if (session.status === 'authenticated' && (!snapshot || status === 'loading' || status === 'sync_failed')) {
        snapshot = await refresh();
      }

      const result = checkAiPracticeAccess({
        isSignedIn: session.status === 'authenticated',
        isActivated: Boolean(snapshot?.entitlements.isActivated),
        speakingCredits: snapshot?.entitlements.speakingCredits ?? 0,
      });

      if (result.allowed) return true;

      options?.onBlocked?.();
      navigateToBlockedTarget(result.redirectTo);
      return false;
    },
    [data, navigateToBlockedTarget, refresh, session.status, status],
  );

  const guardEntry = useCallback(
    async (kind: AppEntryKind, options?: GuardOptions) => {
      const requirement = getEntryRequirement(kind);

      if (!requirement.requiresLogin && !requirement.requiresActivation && !requirement.requiresCredits) {
        return true;
      }

      if (
        session.status === 'authenticated' &&
        ((status === 'loading' && !data) || (status === 'sync_failed' && !data) || (!data && !error))
      ) {
        await refresh();
      }

      if (kind === 'premium_library') {
        return guardPremiumAccess(options);
      }

      if (kind === 'ai_practice' || kind === 'speaking_v1' || kind === 'speaking_v2') {
        return guardAiPracticeAccess(options);
      }

      return true;
    },
    [data, error, guardAiPracticeAccess, guardPremiumAccess, refresh, session.status, status],
  );

  return {
    status,
    mobileMe: data,
    error,
    refresh,
    guardEntry,
    guardPremiumAccess,
    guardAiPracticeAccess,
  };
}
