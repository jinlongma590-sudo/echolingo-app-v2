import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabletControlButtonProps {
  icon: IoniconName;
  label: string;
  active?: boolean;
  highlight?: boolean;
  onPress: () => void;
}

/**
 * Toolbar item — instant pressed feedback (no async state dependency).
 * - default: transparent
 * - pressed: light gray
 * - active:  blue tint + primaryBlue color
 * - highlight (used by paused play button): subtle elevated tone
 */
export function TabletControlButton({
  icon,
  label,
  active = false,
  highlight = false,
  onPress,
}: TabletControlButtonProps) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  const idleColor = isDark ? 'rgba(235,235,245,0.78)' : 'rgba(60,60,67,0.78)';
  const labelIdle = isDark ? 'rgba(235,235,245,0.62)' : 'rgba(60,60,67,0.62)';
  const activeColor = theme.primaryBlue;
  const activeBg = isDark ? 'rgba(10,132,255,0.18)' : 'rgba(0,122,255,0.10)';
  const pressedBg = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(60,60,67,0.08)';
  const highlightBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.06)';

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      android_disableSound
      unstable_pressDelay={0}
      delayLongPress={150}
      style={({ pressed }) => {
        const bg = pressed
          ? pressedBg
          : active
            ? activeBg
            : highlight
              ? highlightBg
              : 'transparent';
        return {
          flex: 1,
          height: 52,
          paddingHorizontal: 2,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          backgroundColor: bg,
          opacity: pressed ? 0.92 : 1,
        };
      }}
    >
      {({ pressed }) => {
        const iconColor = active ? activeColor : pressed ? activeColor : idleColor;
        const labelColor = active ? activeColor : pressed ? activeColor : labelIdle;
        return (
          <>
            <Ionicons name={icon} size={18} color={iconColor} />
            <AppText
              numberOfLines={1}
              style={{
                fontSize: 10,
                lineHeight: 12,
                fontWeight: active ? '700' : '500',
                letterSpacing: 0.1,
                color: labelColor,
              }}
            >
              {label}
            </AppText>
          </>
        );
      }}
    </Pressable>
  );
}

export function TabletControlDivider() {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  return (
    <View
      style={{
        width: 1,
        alignSelf: 'stretch',
        marginVertical: 10,
        marginHorizontal: 3,
        backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.10)',
      }}
    />
  );
}

interface TabletLearningControlBarProps {
  rateLabel: string;
  isRateActive: boolean;
  onOpenRateSheet: () => void;

  showVideo: boolean;
  onToggleVideo: () => void;

  fullscreenAvailable: boolean;
  onFullscreen: () => void;

  phoneticsOn: boolean;
  onTogglePhonetics: () => void;

  onPrev: () => void;

  isPlaying: boolean;
  onPlayPause: () => void;

  onNext: () => void;

  abLabel: string;
  abActive: boolean;
  onABPoint: () => void;

  loopActive: boolean;
  onToggleLoop: () => void;

  intervalLabel: string;
  intervalActive: boolean;
  onOpenIntervalSheet: () => void;

  singlePause: boolean;
  onToggleSinglePause: () => void;
}

export function TabletLearningControlBar(props: TabletLearningControlBarProps) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const topBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.10)';

  const leftCount = props.fullscreenAvailable ? 4 : 3;

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: topBorder,
        paddingHorizontal: 8,
        paddingTop: 4,
        paddingBottom: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {/* Left group */}
        <View style={{ flex: leftCount, flexDirection: 'row', gap: 2 }}>
          <TabletControlButton
            icon="speedometer-outline"
            label={props.rateLabel}
            active={props.isRateActive}
            onPress={props.onOpenRateSheet}
          />
          <TabletControlButton
            icon={props.showVideo ? 'videocam-outline' : 'videocam-off-outline'}
            label="隐藏视频"
            active={!props.showVideo}
            onPress={props.onToggleVideo}
          />
          {props.fullscreenAvailable ? (
            <TabletControlButton
              icon="expand-outline"
              label="全屏"
              onPress={props.onFullscreen}
            />
          ) : null}
          <TabletControlButton
            icon="text-outline"
            label="音标"
            active={props.phoneticsOn}
            onPress={props.onTogglePhonetics}
          />
        </View>

        <TabletControlDivider />

        {/* Middle group */}
        <View style={{ flex: 3, flexDirection: 'row', gap: 2 }}>
          <TabletControlButton icon="play-skip-back" label="上一句" onPress={props.onPrev} />
          <TabletControlButton
            icon={props.isPlaying ? 'pause' : 'play'}
            label={props.isPlaying ? '暂停' : '继续'}
            highlight={!props.isPlaying}
            onPress={props.onPlayPause}
          />
          <TabletControlButton icon="play-skip-forward" label="下一句" onPress={props.onNext} />
        </View>

        <TabletControlDivider />

        {/* Right group */}
        <View style={{ flex: 4, flexDirection: 'row', gap: 2 }}>
          <TabletControlButton
            icon="flag-outline"
            label={props.abLabel}
            active={props.abActive}
            onPress={props.onABPoint}
          />
          <TabletControlButton
            icon="repeat-outline"
            label="单句循环"
            active={props.loopActive}
            onPress={props.onToggleLoop}
          />
          <TabletControlButton
            icon="timer-outline"
            label={props.intervalLabel}
            active={props.intervalActive}
            onPress={props.onOpenIntervalSheet}
          />
          <TabletControlButton
            icon="pause-circle-outline"
            label="单句暂停"
            active={props.singlePause}
            onPress={props.onToggleSinglePause}
          />
        </View>
      </View>
    </View>
  );
}
