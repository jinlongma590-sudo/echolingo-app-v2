import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { EpisodeScreen } from '@/screens/EpisodeScreen';
import { useEpisodeDetailData } from '@/hooks/useEpisodeDetailData';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  SPACING_PAGE_H,
} from '@/theme/tokens';

/**
 * Two-phase episode screen mount.
 *
 * Phase 1 (instant): a skeleton screen that mirrors the real layout — back
 * button + video frame + mode tabs + transcript-row skeletons + bottom bar.
 * Renders within one paint frame, so the navigation feels instant.
 *
 * Phase 2 (post-animation): real EpisodeScreen replaces the skeleton. We
 * yield two animation frames before mounting it, giving the slide-in
 * animation room to finish without competing for JS-thread time.
 */
export default function EpisodeRoute() {
  const params = useLocalSearchParams<{ id?: string }>();
  const episodeId = typeof params.id === 'string' ? params.id : null;

  // Read cached snapshot synchronously so the cover image can paint at
  // route entry — no waiting for an effect, no flash of blank video frame.
  const { snapshot } = useEpisodeDetailData(episodeId);
  const cover = snapshot?.episode?.cover ?? null;

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let raf2Handle: number | null = null;
    const raf1Handle = requestAnimationFrame(() => {
      if (cancelled) return;
      raf2Handle = requestAnimationFrame(() => {
        if (!cancelled) setHydrated(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1Handle);
      if (raf2Handle != null) cancelAnimationFrame(raf2Handle);
    };
  }, []);

  if (hydrated) return <EpisodeScreen />;
  return <EpisodeSkeleton cover={cover} />;
}

// ─── Skeleton screen ────────────────────────────────────────────────────────
//
// Animated grey-block placeholders that breathe in/out (opacity 0.4 → 1.0)
// to signal "loading" without a noisy spinner. Layout matches EpisodeScreen's
// real geometry so swap-in feels like content filling, not a layout jump.

function EpisodeSkeleton({ cover }: { cover: string | null }) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const skeletonColor = theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.13)' : 'rgba(15,23,42,0.08)';
  const videoSkeletonColor = theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.10)' : 'rgba(15,23,42,0.06)';

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Opacity oscillates 0.45 ↔ 1.0 — subtle breathing for ALL skeleton blocks.
  const breathe = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });

  const Block = ({
    width,
    height,
    radius = 6,
    style,
  }: {
    width: number | `${number}%`;
    height: number;
    radius?: number;
    style?: object;
  }) => (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius: radius,
          backgroundColor: skeletonColor,
          opacity: breathe,
        },
        style,
      ]}
    />
  );

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: theme.pageBackground }}>
      {/* Top bar — back + settings */}
      <View style={{ paddingTop: insets.top + 10 }}>
        <View
          style={{
            marginHorizontal: SPACING_PAGE_H,
            marginBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 999,
              backgroundColor: theme.secondaryCardBackground,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 0.5,
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="chevron-back" size={18} color={theme.textPrimary} />
          </Pressable>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              backgroundColor: theme.secondaryCardBackground,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 0.5,
              borderColor: theme.border,
            }}
          >
            <Ionicons name="settings-outline" size={16} color={theme.textSecondary} />
          </View>
        </View>

        {/* Video frame — cover if cached, else grey block */}
        <View
          style={{
            marginHorizontal: SPACING_PAGE_H,
            borderRadius: 28,
            overflow: 'hidden',
            backgroundColor: theme.cardBackground,
            borderWidth: 0.5,
            borderColor: theme.border,
          }}
        >
          <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.secondaryCardBackground }}>
            {cover ? (
              <Image source={cover} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <Animated.View
                style={{ flex: 1, backgroundColor: videoSkeletonColor, opacity: breathe }}
              />
            )}
          </View>
        </View>

        {/* Mode tab strip skeleton */}
        <View
          style={{
            marginHorizontal: SPACING_PAGE_H,
            marginTop: 22,
            marginBottom: 10,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 0.5,
            borderBottomColor: theme.separator,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Block key={i} width={32} height={14} radius={4} />
          ))}
        </View>
      </View>

      {/* Transcript-row skeletons — three rows, each two text lines */}
      <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: 8, gap: 26 }}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Block width={'62%' as `${number}%`} height={18} radius={5} />
              <Block width={48} height={18} radius={5} />
            </View>
            <Block width={'46%' as `${number}%`} height={14} radius={4} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Block width={28} height={11} radius={3} />
              <Block width={64} height={11} radius={3} />
            </View>
          </View>
        ))}
      </View>

      {/* Bottom bar skeleton */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + 8,
          paddingTop: 14,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {[
          { w: 24, h: 24, radius: 6 },
          { w: 24, h: 24, radius: 6 },
          { w: 24, h: 24, radius: 6 },
          { w: 40, h: 40, radius: 999 },
          { w: 24, h: 24, radius: 6 },
          { w: 24, h: 24, radius: 6 },
          { w: 24, h: 24, radius: 6 },
        ].map((b, i) => (
          <Block key={i} width={b.w} height={b.h} radius={b.radius} />
        ))}
      </View>
    </SafeAreaView>
  );
}
