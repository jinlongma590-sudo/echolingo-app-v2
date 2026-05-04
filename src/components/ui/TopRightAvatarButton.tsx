import React from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';

import { AppText } from '@/components/AppText';
import { useCurrentAvatarUrl } from '@/hooks/useCurrentAvatarUrl';
import { useAppSession } from '@/services/auth/AppSessionProvider';

type TopRightAvatarButtonProps = {
  onPress?: () => void;
  displayName?: string;
  avatarUrl?: string | null;
  consumer?: string;
};

function getInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '我';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return trimmed.slice(0, 1).toUpperCase();
}

export function TopRightAvatarButton({
  onPress,
  displayName,
  avatarUrl,
  consumer,
}: TopRightAvatarButtonProps) {
  const session = useAppSession();
  const resolvedDisplayName = session.user?.displayName ?? displayName ?? session.user?.email ?? '我';
  const { avatarUrl: resolvedAvatarUrl } = useCurrentAvatarUrl(avatarUrl, { consumer: consumer ?? 'top_right_avatar' });
  const initials = getInitials(resolvedDisplayName);

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#D1D1D6',
        }}
      >
        {resolvedAvatarUrl ? (
          <Image
            key={resolvedAvatarUrl}
            source={{ uri: resolvedAvatarUrl }}
            contentFit="cover"
            style={{
              width: '100%',
              height: '100%',
            }}
          />
        ) : (
          <AppText
            style={{
              fontSize: 17,
              lineHeight: 19,
              fontWeight: '700',
              color: '#FFFFFF',
            }}
          >
            {initials}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}
