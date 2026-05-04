import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { EpisodeProgressBar } from '@/components/EpisodeProgressBar';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  BG_OVERLAY,
  TEXT_ON_DARK,
} from '@/theme/tokens';

type RailRole = 'secondary' | 'primary';

function PlayGlyph() {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: 8,
        borderBottomWidth: 8,
        borderLeftWidth: 13,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: '#FFFFFF',
        transform: [{ translateX: 1 }],
      }}
    />
  );
}

function PauseGlyph() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
      }}
    >
      <View
        style={{
          width: 4.5,
          height: 16,
          borderRadius: 2.25,
          backgroundColor: '#FFFFFF',
        }}
      />
      <View
        style={{
          width: 4.5,
          height: 16,
          borderRadius: 2.25,
          backgroundColor: '#FFFFFF',
        }}
      />
    </View>
  );
}

function RailItem({
  icon,
  symbol,
  label,
  onPress,
  active = false,
  role = 'secondary',
  disabled = false,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  symbol?: string;
  label: string;
  onPress?: () => void;
  active?: boolean;
  role?: RailRole;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  const isPrimary = role === 'primary';
  const isAndroid = Platform.OS === 'android';

  const iconColor = disabled
    ? theme.textTertiary
    : active
      ? theme.primaryBlue
      : isPrimary
        ? theme.textPrimary
        : theme.textSecondary;

  const labelColor = disabled
    ? theme.textTertiary
    : active
      ? theme.primaryBlue
      : isPrimary
        ? theme.textSecondary
        : theme.textSecondary;

  const iconSize = isPrimary ? 20 : 18;
  const cellWidth = 44;

  const body = ({ pressed }: { pressed: boolean }) => (
    <View
      style={{
        width: cellWidth,
        minWidth: cellWidth,
        height: isAndroid ? 54 : 50,
        alignItems: 'center',
        justifyContent: 'flex-start',
        opacity: disabled ? 0.34 : pressed ? 0.62 : 1,
      }}
    >
      <View
        style={{
          height: isAndroid ? 34 : 28,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
        }}
      >
        {symbol ? (
          <AppText
            style={{
              fontSize: symbol.length > 1 ? 16 : 20,
              lineHeight: symbol.length > 1 ? 18 : 20,
              fontWeight: '800',
              letterSpacing: symbol.length > 1 ? -0.4 : -0.2,
              color: iconColor,
            }}
          >
            {symbol}
          </AppText>
        ) : icon ? (
          <Ionicons name={icon} size={iconSize} color={iconColor} />
        ) : null}
      </View>

      <AppText
        numberOfLines={1}
        style={{
          fontSize: 9.5,
          lineHeight: 11,
          fontWeight: active ? '700' : '600',
          color: labelColor,
          textAlign: 'center',
        }}
      >
        {label}
      </AppText>
    </View>
  );

  if (!onPress) {
    return body({ pressed: false });
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      // unstable_pressDelay=0 removes Pressable's 130ms delay before showing
      // the pressed state — fixes the "lag / not following finger" feel
      // especially noticeable on 120Hz ProMotion devices.
      unstable_pressDelay={0}
      android_disableSound
      style={{
        width: cellWidth,
        minWidth: cellWidth,
        alignItems: 'center',
      }}
    >
      {body}
    </Pressable>
  );
}

function PlayPauseControl({
  isPlaying,
  onPress,
}: {
  isPlaying: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  // Reanimated press feedback: scale 1 → 0.92 + opacity 1 → 0.78 with snappy
  // springs on press in/out. Uses UI thread, so it stays glued to the finger
  // even under heavy JS load (which is exactly when the pressed-state opacity
  // toggle felt sluggish before).
  const pressed = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(pressed.value, [0, 1], [1, 0.92], Extrapolation.CLAMP),
      },
    ],
    opacity: interpolate(pressed.value, [0, 1], [1, 0.82], Extrapolation.CLAMP),
  }));
  const pressInSpring  = { damping: 22, stiffness: 480, mass: 0.6 } as const;
  const pressOutSpring = { damping: 18, stiffness: 380, mass: 0.6 } as const;

  return (
    <View
      style={{
        width: 60,
        minWidth: 60,
        height: 54,
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <Pressable
        onPress={() => onPress()}
        onPressIn={() => {
          pressed.value = withSpring(1, pressInSpring);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, pressOutSpring);
        }}
        hitSlop={14}
        unstable_pressDelay={0}
        android_disableSound
        style={{
          width: 60,
          minWidth: 60,
          height: 54,
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        <Animated.View
          style={[
            {
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#17181C',
              marginBottom: 3,
              alignSelf: 'center',
            },
            animStyle,
          ]}
        >
          {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
        </Animated.View>
        <AppText
          style={{
            fontSize: 9,
            lineHeight: 10,
            fontWeight: '700',
            color: theme.textSecondary,
            textAlign: 'center',
          }}
        >
          {isPlaying ? '暂停' : '播放'}
        </AppText>
      </Pressable>
    </View>
  );
}

export function EpisodeBottomBar({
  currentRate,
  currentRateValue,
  currentTime,
  duration,
  aPointTime,
  bPointTime,
  isPlaying,
  isSubtitlesHidden,
  abPointStage,
  isLoopActive,
  singlePause,
  intervalDelay,
  onSeek,
  onSelectRate,
  onToggleSubtitles,
  onPrev,
  onPlayPause,
  onNext,
  onABPoint,
  onToggleLoop,
  onToggleSinglePause,
  onSetIntervalDelay,
}: {
  currentRate: string;
  currentRateValue: number;
  currentTime: number;
  duration: number;
  aPointTime: number | null;
  bPointTime: number | null;
  isPlaying: boolean;
  isSubtitlesHidden: boolean;
  abPointStage: 'a' | 'b' | 'ab';
  isLoopActive: boolean;
  singlePause: boolean;
  intervalDelay: number;
  onSeek: (time: number) => void;
  onSelectRate: (rate: number) => void;
  onToggleSubtitles: () => void;
  onPrev: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onABPoint: () => void;
  onToggleLoop: () => void;
  onToggleSinglePause: () => void;
  onSetIntervalDelay: (value: number) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [showRateSheet, setShowRateSheet] = useState(false);
  const [showLoopSheet, setShowLoopSheet] = useState(false);
  const rateOptions = [0.75, 1, 1.25, 1.5, 2];
  const abPointLabel = abPointStage === 'b' ? 'B点' : abPointStage === 'ab' ? 'AB点' : 'A点';
  const abPointSymbol = abPointStage === 'b' ? 'B' : abPointStage === 'ab' ? 'AB' : 'A';
  const abPointActive = abPointStage !== 'a';
  // Hug the bottom edge tightly. iOS uses translateY 22 to overlap the
  // home-indicator zone; Android uses translateY 12 + a reduced inset
  // padding so the rail sits close to the gesture bar without colliding.
  const contentTranslateY = Platform.OS === 'android' ? 12 : 22;
  const resolvedBottomPadding =
    Platform.OS === 'android'
      ? Math.max(insets.bottom - 12, 0)
      : Math.max(insets.bottom - 20, 0);

  return (
    <>
      <View
        style={{
          borderTopWidth: 0.5,
          borderTopColor: theme.separator,
          backgroundColor: theme.pageBackground,
          paddingTop: 0,
          paddingBottom: resolvedBottomPadding,
        }}
      >
        <View style={{ paddingHorizontal: 10, paddingTop: 0 }}>
          <View
            style={{
              transform: [{ translateY: contentTranslateY }],
            }}
          >
            <View style={{ paddingHorizontal: 2, marginBottom: 1 }}>
              <EpisodeProgressBar
                currentTime={currentTime}
                duration={duration}
                aPointTime={aPointTime}
                bPointTime={bPointTime}
                onSeek={onSeek}
              />
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                minHeight: 72,
                paddingBottom: 0,
                marginTop: 0,
              }}
            >
              <RailItem
                icon="speedometer-outline"
                label={currentRate}
                onPress={() => setShowRateSheet(true)}
              />
              <RailItem
                icon={isSubtitlesHidden ? 'eye-off-outline' : 'eye-outline'}
                label="隐藏"
                onPress={onToggleSubtitles}
                active={isSubtitlesHidden}
              />
              <RailItem
                icon="play-skip-back"
                label="上一句"
                onPress={onPrev}
                role="primary"
              />

              <PlayPauseControl
                isPlaying={isPlaying}
                onPress={onPlayPause}
              />

              <RailItem
                icon="play-skip-forward"
                label="下一句"
                onPress={onNext}
                role="primary"
              />
              <RailItem
                symbol={abPointSymbol}
                label={abPointLabel}
                onPress={onABPoint}
                active={abPointActive}
              />
              <RailItem
                icon="repeat-outline"
                label="精听"
                onPress={() => setShowLoopSheet(true)}
                active={isLoopActive}
              />
            </View>
          </View>
        </View>
      </View>

      <Modal
        visible={showRateSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRateSheet(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setShowRateSheet(false)}
          style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: BG_OVERLAY,
            }}
          />
          <View
            style={{
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              backgroundColor: theme.elevatedCardBackground,
              paddingTop: 10,
              paddingBottom: Math.max(insets.bottom, 14),
              paddingHorizontal: 14,
              shadowColor: theme.shadowColor,
              shadowOpacity: 0.08,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: -6 },
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 36,
                height: 5,
                borderRadius: 999,
                backgroundColor: theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.25)' : 'rgba(60,60,67,0.18)',
                marginBottom: 14,
              }}
            />
            <AppText
              style={{
                fontSize: 13,
                lineHeight: 16,
                fontWeight: '700',
                color: theme.textPrimary,
                textAlign: 'center',
                marginBottom: 12,
              }}
            >
              播放倍速
            </AppText>

            <View
              style={{
                borderRadius: 22,
                overflow: 'hidden',
                backgroundColor: theme.cardBackground,
                borderWidth: 0.5,
                borderColor: theme.border,
              }}
            >
              {rateOptions.map((rate, index) => {
                const selected = Math.abs(currentRateValue - rate) < 0.01;
                return (
                  <Pressable
                    key={rate}
                    onPress={() => {
                      onSelectRate(rate);
                      setShowRateSheet(false);
                    }}
                    style={({ pressed }) => ({
                      minHeight: 54,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 18,
                      backgroundColor: pressed ? theme.fillSecondary : theme.cardBackground,
                      borderBottomWidth: index === rateOptions.length - 1 ? 0 : 0.5,
                      borderBottomColor: theme.separator,
                    })}
                  >
                    <AppText
                      style={{
                        fontSize: 17,
                        lineHeight: 22,
                        fontWeight: selected ? '700' : '500',
                        color: selected ? theme.primaryBlue : theme.textPrimary,
                      }}
                    >
                      {rate}x
                    </AppText>
                    {selected ? (
                      <Ionicons name="checkmark" size={20} color={theme.primaryBlue} />
                    ) : (
                      <View style={{ width: 20, height: 20 }} />
                    )}
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => setShowRateSheet(false)}
              style={({ pressed }) => ({
                minHeight: 54,
                marginTop: 10,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? theme.secondaryCardBackground : theme.cardBackground,
                borderWidth: 0.5,
                borderColor: theme.border,
              })}
            >
              <AppText
                style={{
                  fontSize: 17,
                  lineHeight: 22,
                  fontWeight: '600',
                  color: theme.textPrimary,
                }}
              >
                取消
              </AppText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showLoopSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLoopSheet(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setShowLoopSheet(false)}
          style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: BG_OVERLAY,
            }}
          />
          <View
            style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: theme.elevatedCardBackground,
              paddingBottom: Math.max(insets.bottom, 16),
              borderTopWidth: 0.5,
              borderTopColor: theme.separator,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.25)' : 'rgba(60,60,67,0.18)',
                marginTop: 12,
                marginBottom: 0,
              }}
            />

            <View
              style={{
                minHeight: 52,
                paddingHorizontal: 20,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <AppText style={{ fontSize: 16, lineHeight: 20, fontWeight: '700', color: theme.textPrimary }}>
                播放设置
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable
                  onPress={() => {
                    if (isLoopActive) onToggleLoop();
                    if (singlePause) onToggleSinglePause();
                    onSetIntervalDelay(0);
                  }}
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
                >
                  <AppText style={{ fontSize: 12, lineHeight: 16, fontWeight: '600', color: theme.textTertiary }}>
                    恢复默认值
                  </AppText>
                </Pressable>
                <Pressable
                  onPress={() => setShowLoopSheet(false)}
                  style={({ pressed }) => ({
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.secondaryCardBackground,
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <Ionicons name="close" size={15} color={theme.textTertiary} />
                </Pressable>
              </View>
            </View>

            <LoopSheetRow
              label="循环完当前句后暂停"
              right={<SheetSwitch active={singlePause} onPress={onToggleSinglePause} />}
            />
            <LoopSheetRow
              label="循环间隔（秒）"
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <SheetStepperButton label="−" onPress={() => onSetIntervalDelay(Math.max(0, intervalDelay - 1))} />
                  <AppText style={{ minWidth: 24, textAlign: 'center', fontSize: 16, lineHeight: 20, fontWeight: '700', color: theme.textPrimary }}>
                    {intervalDelay}
                  </AppText>
                  <SheetStepperButton label="+" onPress={() => onSetIntervalDelay(Math.min(10, intervalDelay + 1))} />
                </View>
              }
            />
            <LoopSheetRow
              label="句子循环"
              last
              right={<SheetSwitch active={isLoopActive} onPress={onToggleLoop} />}
            />
            <View style={{ height: 16 }} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function LoopSheetRow({
  label,
  right,
  last = false,
}: {
  label: string;
  right: React.ReactNode;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: theme.separator,
      }}
    >
      <AppText style={{ flex: 1, fontSize: 15, lineHeight: 20, color: theme.textPrimary }}>
        {label}
      </AppText>
      {right}
    </View>
  );
}

function SheetStepperButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.secondaryCardBackground,
        borderWidth: 0.5,
        borderColor: theme.border,
        opacity: pressed ? 0.62 : 1,
      })}
    >
      <AppText style={{ fontSize: 18, lineHeight: 20, fontWeight: '600', color: theme.textPrimary }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function SheetSwitch({ active, onPress }: { active: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 28,
        borderRadius: 14,
        padding: 2,
        alignItems: active ? 'flex-end' : 'flex-start',
        justifyContent: 'center',
        backgroundColor: active ? theme.primaryBlue : theme.colorScheme === 'dark' ? 'rgba(120,120,128,0.32)' : 'rgba(60,60,67,0.18)',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.92)' : '#FFFFFF',
        }}
      />
    </Pressable>
  );
}
