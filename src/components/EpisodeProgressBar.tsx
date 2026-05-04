import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { BG_HERO, TEXT_TERTIARY } from '@/theme/tokens';

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function EpisodeProgressBar({
  currentTime,
  duration,
  aPointTime,
  bPointTime,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  aPointTime?: number | null;
  bPointTime?: number | null;
  onSeek: (time: number) => void;
}) {
  const { theme } = useAppTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const progress =
    duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const thumbSize = 7;
  const thumbLeft =
    trackWidth > 0
      ? Math.max(
          0,
          Math.min(trackWidth - thumbSize, trackWidth * progress - thumbSize / 2)
        )
      : 0;

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const getMarkerLeft = (time: number) => {
    if (trackWidth <= 0 || duration <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, time / duration));
    return Math.max(0, Math.min(trackWidth - 12, trackWidth * ratio - 6));
  };

  const markerBaseStyle = {
    position: 'absolute' as const,
    top: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: BG_HERO,
  };
  const trackColor = theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(15, 23, 42, 0.10)';
  const progressColor = theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.72)' : BG_HERO;
  const thumbColor = theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.85)' : BG_HERO;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <AppText
        style={{
          minWidth: 34,
          fontSize: 10.5,
          fontWeight: '500',
          color: TEXT_TERTIARY,
        }}
      >
        {formatClock(currentTime)}
      </AppText>

      <Pressable
        onLayout={handleLayout}
        onPress={(event) => {
          if (trackWidth <= 0 || duration <= 0) return;
          const ratio = Math.max(
            0,
            Math.min(1, event.nativeEvent.locationX / trackWidth)
          );
          onSeek(ratio * duration);
        }}
        style={{ flex: 1, height: 22, justifyContent: 'flex-end', paddingBottom: 3 }}
      >
        {aPointTime !== null && aPointTime !== undefined ? (
          <View pointerEvents="none" style={[markerBaseStyle, { left: getMarkerLeft(aPointTime) }]}>
            <AppText style={{ fontSize: 8, lineHeight: 9, fontWeight: '800', color: '#FFFFFF' }}>
              A
            </AppText>
          </View>
        ) : null}

        {bPointTime !== null && bPointTime !== undefined ? (
          <View pointerEvents="none" style={[markerBaseStyle, { left: getMarkerLeft(bPointTime) }]}>
            <AppText style={{ fontSize: 8, lineHeight: 9, fontWeight: '800', color: '#FFFFFF' }}>
              B
            </AppText>
          </View>
        ) : null}

        <View
          style={{
            height: 3,
            borderRadius: 999,
            backgroundColor: trackColor,
          }}
        >
          <View
            style={{
              width: `${progress * 100}%`,
              height: 3,
              borderRadius: 999,
              backgroundColor: progressColor,
            }}
          />
        </View>

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 1,
            left: thumbLeft,
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: thumbColor,
          }}
        />
      </Pressable>

      <View style={{ minWidth: 34, alignItems: 'flex-end' }}>
        <AppText style={{ fontSize: 10.5, color: TEXT_TERTIARY }}>
          {formatClock(duration)}
        </AppText>
      </View>
    </View>
  );
}
