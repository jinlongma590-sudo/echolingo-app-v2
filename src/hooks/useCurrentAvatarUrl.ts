import { useEffect, useMemo, useRef } from 'react';

import { useMobileMe } from '@/hooks/useMobileMe';
import { useAppSession } from '@/services/auth/AppSessionProvider';

type AvatarSource = 'mobile_me' | 'prop' | 'session' | 'none';

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null;
}

export function useCurrentAvatarUrl(
  providedAvatarUrl?: string | null,
  options: { consumer?: string } = {},
) {
  const session = useAppSession();
  const mobileMe = useMobileMe();
  const previousAvatarUrlRef = useRef<string | null>(null);
  const consumer = options.consumer ?? 'avatar';

  const result = useMemo((): { avatarUrl: string | null; source: AvatarSource } => {
    const mobileMeAvatarUrl = firstNonEmpty([
      mobileMe.data?.user.avatarUrl,
      mobileMe.data?.user.avatar_url,
      mobileMe.data?.user.avatar,
      mobileMe.data?.user.imageUrl,
      mobileMe.data?.user.photoURL,
    ]);

    if (mobileMeAvatarUrl) {
      return { avatarUrl: mobileMeAvatarUrl, source: 'mobile_me' };
    }

    if (providedAvatarUrl?.trim()) {
      return { avatarUrl: providedAvatarUrl.trim(), source: 'prop' };
    }

    if (session.user?.avatarUrl?.trim()) {
      return { avatarUrl: session.user.avatarUrl.trim(), source: 'session' };
    }

    return { avatarUrl: null, source: 'none' };
  }, [
    mobileMe.data?.user.avatar,
    mobileMe.data?.user.avatarUrl,
    mobileMe.data?.user.avatar_url,
    mobileMe.data?.user.imageUrl,
    mobileMe.data?.user.photoURL,
    providedAvatarUrl,
    session.user?.avatarUrl,
  ]);

  useEffect(() => {
    if (__DEV__) {
      console.debug('home_avatar_source_selected', {
        consumer,
        source: result.source,
        hasAvatarUrl: Boolean(result.avatarUrl),
        avatarUrlChanged: previousAvatarUrlRef.current !== result.avatarUrl,
        sessionUserId: session.user?.id ?? null,
        mobileMeUserId: mobileMe.data?.user.id ?? null,
        profileUserId: mobileMe.data?.user.id ?? null,
      });
    }
    previousAvatarUrlRef.current = result.avatarUrl;
  }, [consumer, mobileMe.data?.user.id, result.avatarUrl, result.source, session.user?.id]);

  return result;
}
