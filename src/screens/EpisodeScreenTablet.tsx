import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { VideoView, type VideoPlayer } from 'expo-video';
import React, { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ActivityIndicator, InteractionManager, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { EpisodeProgressBar } from '@/components/EpisodeProgressBar';
import { TabletLearningControlBar } from '@/components/episode/TabletLearningControlBar';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { Episode } from '@/types/echolingo';
import {
  BG_OVERLAY,
  BG_CARD_SOFT,
  BORDER_SOFT,
  COLOR_RED,
  FONT_BODY,
  FONT_CAPTION,
  RADIUS_CARD,
  TEXT_ON_DARK,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';

type TranscriptMode = 'bilingual' | 'english' | 'chinese' | 'dictation' | 'cloze' | 'cards';

interface NoteSheetProps {
  visible: boolean;
  input: string;
  submitting: boolean;
  error: string | null;
  hasExistingNote: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

interface EpisodeScreenTabletProps {
  episode: Episode | null | undefined;
  snapshotReady: boolean;
  loading: boolean;
  error: string | null;
  hasError: boolean;
  mode: TranscriptMode;
  cover: string | null | undefined;
  playerView: VideoPlayer | null;
  toastMessage: string | null;
  totalSentences: number;
  studyPanelContent: ReactNode;
  transcriptRowsContent: ReactNode;
  transcriptScrollRef: RefObject<ScrollView | null>;
  onTranscriptViewportLayout: (event: LayoutChangeEvent) => void;
  onTranscriptScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onTranscriptScrollBegin: () => void;
  onTranscriptScrollEnd: () => void;
  onTranscriptMomentumBegin: () => void;
  onTranscriptMomentumEnd: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
  onChangeMode: (mode: TranscriptMode) => void;
  noteSheet: NoteSheetProps;
  controlProps: {
    currentRate: string;
    currentRateValue: number;
    currentTime: number;
    duration: number;
    aPointTime: number | null;
    bPointTime: number | null;
    abLoopActive: boolean;
    isPlaying: boolean;
    showVideo: boolean;
    phoneticsOn: boolean;
    isLoopActive: boolean;
    singlePause: boolean;
    intervalDelay: number;
    onSeek: (time: number) => void;
    onSelectRate: (rate: number) => void;
    onToggleVideo: () => void;
    onTogglePhonetics: () => void;
    onPrev: () => void;
    onPlayPause: () => void;
    onNext: () => void;
    onABPoint: () => void;
    onToggleLoop: () => void;
    onToggleSinglePause: () => void;
    onSetIntervalDelay: (value: number) => void;
  };
}

const TABLET_MODE_ITEMS: Array<{ key: TranscriptMode; label: string }> = [
  { key: 'bilingual', label: '双语' },
  { key: 'english', label: '英语' },
  { key: 'chinese', label: '中文' },
  { key: 'dictation', label: '听写' },
  { key: 'cloze', label: '挖空' },
  { key: 'cards', label: '词卡' },
];

function HeaderIconButton({
  icon,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: BG_CARD_SOFT,
        borderWidth: 0.5,
        borderColor: BORDER_SOFT,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={TEXT_PRIMARY} />
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
        backgroundColor: active
          ? theme.primaryBlue
          : theme.colorScheme === 'dark'
            ? 'rgba(120,120,128,0.32)'
            : 'rgba(60,60,67,0.18)',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor:
            theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.92)' : '#FFFFFF',
        }}
      />
    </Pressable>
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
      <AppText style={{ fontSize: 18, lineHeight: 20, fontWeight: '600', color: TEXT_PRIMARY }}>
        {label}
      </AppText>
    </Pressable>
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
      <AppText style={{ flex: 1, fontSize: 15, lineHeight: 20, color: TEXT_PRIMARY }}>
        {label}
      </AppText>
      {right}
    </View>
  );
}

function TabletModeTabs({
  value,
  onChange,
}: {
  value: TranscriptMode;
  onChange: (mode: TranscriptMode) => void;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <View
      style={{
        width: '100%',
        borderBottomWidth: 1,
        borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(28,24,18,0.08)',
      }}
    >
      <View
        style={{
          width: '100%',
          paddingTop: 4,
          paddingBottom: 3,
          paddingHorizontal: 8,
          flexDirection: 'row',
          alignItems: 'stretch',
        }}
      >
        {TABLET_MODE_ITEMS.map((item) => {
          const selected = value === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(item.key)}
              style={({ pressed }) => ({
                flex: 1,
                height: 31,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <AppText
                style={{
                  fontSize: 13,
                  lineHeight: 18,
                  fontWeight: selected ? '700' : '500',
                  color: selected ? theme.textPrimary : theme.textSecondary,
                }}
              >
                {item.label}
              </AppText>
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  width: 28,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: selected ? theme.primaryBlue : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function VideoHiddenPlaceholder({ episode }: { episode: Episode | null | undefined }) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: isDark ? '#1A1A1C' : '#F1F2F6',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 28,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
        }}
      >
        <Ionicons name="videocam-off-outline" size={22} color={theme.textSecondary} />
      </View>
      {episode?.title ? (
        <AppText
          numberOfLines={2}
          style={{
            textAlign: 'center',
            fontSize: 15,
            lineHeight: 20,
            fontWeight: '700',
            color: theme.textPrimary,
            marginTop: 4,
          }}
        >
          {episode.title}
        </AppText>
      ) : null}
      <AppText style={{ fontSize: 12, lineHeight: 16, color: theme.textSecondary, textAlign: 'center' }}>
        视频已隐藏
      </AppText>
      <AppText style={{ fontSize: 11, lineHeight: 15, color: theme.textTertiary, textAlign: 'center' }}>
        可继续听音频和逐句精听
      </AppText>
    </View>
  );
}

export function EpisodeScreenTablet({
  episode,
  snapshotReady,
  loading,
  error,
  hasError,
  mode,
  cover,
  playerView,
  toastMessage,
  totalSentences,
  studyPanelContent,
  transcriptRowsContent,
  transcriptScrollRef,
  onTranscriptViewportLayout,
  onTranscriptScroll,
  onTranscriptScrollBegin,
  onTranscriptScrollEnd,
  onTranscriptMomentumBegin,
  onTranscriptMomentumEnd,
  onBack,
  onOpenSettings,
  onChangeMode,
  noteSheet,
  controlProps,
}: EpisodeScreenTabletProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [showRateSheet, setShowRateSheet] = useState(false);
  const [showPlaybackSheet, setShowPlaybackSheet] = useState(false);
  const rateOptions = useMemo(() => [0.75, 1, 1.25, 1.5, 2], []);

  const videoViewRef = useRef<VideoView>(null);
  const handleFullscreen = useCallback(() => {
    void videoViewRef.current?.enterFullscreen();
  }, []);

  // First-paint splash gate — covers the screen with a clean
  // theme-coloured layer until the navigation transition has finished AND
  // we've passed at least one frame, so any half-laid-out video card / system
  // VideoView native presentation cannot leak through. Once dropped, never
  // re-shown for this mount.
  const [splashReady, setSplashReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      // Give RN one extra frame after the transition to ensure flex/aspectRatio
      // measurements have committed before we lift the splash.
      requestAnimationFrame(() => {
        if (!cancelled) setSplashReady(true);
      });
    });
    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, []);

  const abLabel =
    controlProps.bPointTime != null
      ? '关闭'
      : controlProps.aPointTime != null
        ? 'B点'
        : 'A点';
  // Active only when a point/loop is genuinely set; both-null cancel must clear visual.
  const abActive =
    controlProps.aPointTime != null ||
    controlProps.bPointTime != null ||
    controlProps.abLoopActive;
  const intervalLabel =
    controlProps.intervalDelay > 0 ? `间隔${controlProps.intervalDelay}s` : '间隔';

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: theme.pageBackground }}>
      <View
        style={{
          flex: 1,
          paddingTop: Math.max(insets.top, 10),
          paddingHorizontal: 10,
          paddingBottom: 10,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 1360,
            alignSelf: 'center',
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Header — full-width, title spans the middle */}
          <View
            style={{
              height: 46,
              paddingHorizontal: 4,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              marginBottom: 8,
            }}
          >
            <HeaderIconButton icon="chevron-back" onPress={onBack} />
            <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
              <AppText
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  fontSize: 21,
                  lineHeight: 26,
                  fontWeight: '800',
                  color: theme.textPrimary,
                  textAlign: 'center',
                }}
              >
                {episode?.title ?? '正在加载单集...'}
              </AppText>
            </View>
            <HeaderIconButton icon="settings-outline" onPress={onOpenSettings} />
          </View>

          {/* Main row — left/right split with truly enforced ratio */}
          <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: 10 }}>
            {/* Left column — flex:54 (real ratio, no flex:1 override) */}
            <View
              style={{
                flexGrow: 54,
                flexShrink: 1,
                flexBasis: 0,
                minWidth: 0,
                height: '100%',
                minHeight: 0,
              }}
            >
              {/* Video card */}
              <View
                style={{
                  borderRadius: 18,
                  overflow: 'hidden',
                  backgroundColor: theme.cardBackground,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: BG_CARD_SOFT }}>
                  {/* Always keep VideoView mounted to avoid resetting playback;
                      hide it visually when showVideo is false. */}
                  {snapshotReady && playerView ? (
                    <View
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        opacity: controlProps.showVideo ? 1 : 0,
                      }}
                      pointerEvents={controlProps.showVideo ? 'auto' : 'none'}
                    >
                      {cover ? (
                        <Image
                          source={cover}
                          style={{ position: 'absolute', width: '100%', height: '100%' }}
                          contentFit="cover"
                        />
                      ) : null}
                      <VideoView
                        ref={videoViewRef}
                        player={playerView}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        nativeControls={false}
                      />
                    </View>
                  ) : null}

                  {!controlProps.showVideo ? (
                    <View style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <VideoHiddenPlaceholder episode={episode} />
                    </View>
                  ) : null}

                  {(!snapshotReady || !playerView) && controlProps.showVideo && loading ? (
                    <View
                      style={{
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                      }}
                    >
                      <ActivityIndicator color={theme.textSecondary} />
                      <AppText style={{ fontSize: 12, lineHeight: 16, color: theme.textSecondary }}>
                        正在准备视频...
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Progress + control bar */}
              <View style={{ marginTop: 6 }}>
                <View style={{ height: 22, justifyContent: 'center', marginBottom: 2 }}>
                  <EpisodeProgressBar
                    currentTime={controlProps.currentTime}
                    duration={controlProps.duration}
                    aPointTime={controlProps.aPointTime}
                    bPointTime={controlProps.bPointTime}
                    onSeek={controlProps.onSeek}
                  />
                </View>

                <TabletLearningControlBar
                  rateLabel={controlProps.currentRate}
                  isRateActive={Math.abs(controlProps.currentRateValue - 1) > 0.01}
                  onOpenRateSheet={() => setShowRateSheet(true)}
                  showVideo={controlProps.showVideo}
                  onToggleVideo={controlProps.onToggleVideo}
                  fullscreenAvailable
                  onFullscreen={handleFullscreen}
                  phoneticsOn={controlProps.phoneticsOn}
                  onTogglePhonetics={controlProps.onTogglePhonetics}
                  onPrev={controlProps.onPrev}
                  isPlaying={controlProps.isPlaying}
                  onPlayPause={controlProps.onPlayPause}
                  onNext={controlProps.onNext}
                  abLabel={abLabel}
                  abActive={abActive}
                  onABPoint={controlProps.onABPoint}
                  loopActive={controlProps.isLoopActive}
                  onToggleLoop={controlProps.onToggleLoop}
                  intervalLabel={intervalLabel}
                  intervalActive={controlProps.intervalDelay > 0}
                  onOpenIntervalSheet={() => setShowPlaybackSheet(true)}
                  singlePause={controlProps.singlePause}
                  onToggleSinglePause={controlProps.onToggleSinglePause}
                />
              </View>

              {/* Study card (left bottom) — single layered surface */}
              <View
                style={{
                  flex: 1,
                  minHeight: 240,
                  marginTop: 10,
                  borderRadius: 20,
                  overflow: 'hidden',
                  backgroundColor: theme.cardBackground,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <View style={{ flex: 1, minHeight: 0 }}>{studyPanelContent}</View>
              </View>
            </View>

            {/* Right column — flex:46, no SurfaceCard padding */}
            <View
              style={{
                flexGrow: 46,
                flexShrink: 1,
                flexBasis: 0,
                minWidth: 0,
                height: '100%',
                minHeight: 0,
                borderRadius: 20,
                overflow: 'hidden',
                backgroundColor: theme.cardBackground,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <TabletModeTabs value={mode} onChange={onChangeMode} />

              <ScrollView
                ref={transcriptScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingTop: 0, paddingBottom: 20 }}
                onLayout={onTranscriptViewportLayout}
                onScroll={onTranscriptScroll}
                onScrollBeginDrag={onTranscriptScrollBegin}
                onScrollEndDrag={onTranscriptScrollEnd}
                onMomentumScrollBegin={onTranscriptMomentumBegin}
                onMomentumScrollEnd={onTranscriptMomentumEnd}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
              >
                {hasError ? (
                  <View style={{ marginHorizontal: 18, marginTop: 14 }}>
                    <AppText style={{ fontSize: FONT_CAPTION, color: '#dc2626' }}>
                      {error ?? '单集数据不可用'}
                    </AppText>
                  </View>
                ) : null}
                {!hasError && loading && totalSentences === 0 ? (
                  <View
                    style={{
                      marginHorizontal: 18,
                      marginTop: 14,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <ActivityIndicator color={theme.textSecondary} />
                    <AppText style={{ fontSize: 13, lineHeight: 18, color: theme.textSecondary }}>
                      正在加载字幕...
                    </AppText>
                  </View>
                ) : null}
                {transcriptRowsContent}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>

      {/* Rate sheet */}
      <Modal
        visible={showRateSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRateSheet(false)}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
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
              width: '100%',
              maxWidth: 420,
              borderRadius: 28,
              backgroundColor: theme.elevatedCardBackground,
              paddingTop: 14,
              paddingBottom: 14,
              paddingHorizontal: 14,
              shadowColor: theme.shadowColor,
              shadowOpacity: 0.12,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            <AppText
              style={{
                fontSize: 15,
                lineHeight: 20,
                fontWeight: '800',
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
                const selected = Math.abs(controlProps.currentRateValue - rate) < 0.01;
                return (
                  <Pressable
                    key={rate}
                    onPress={() => {
                      controlProps.onSelectRate(rate);
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
          </View>
        </View>
      </Modal>

      {/* Interval / loop settings sheet */}
      <Modal
        visible={showPlaybackSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPlaybackSheet(false)}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable
            onPress={() => setShowPlaybackSheet(false)}
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
              width: '100%',
              maxWidth: 460,
              borderRadius: 28,
              overflow: 'hidden',
              backgroundColor: theme.elevatedCardBackground,
              borderWidth: 0.5,
              borderColor: theme.border,
              shadowColor: theme.shadowColor,
              shadowOpacity: 0.12,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            <View
              style={{
                minHeight: 58,
                paddingHorizontal: 20,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <AppText style={{ fontSize: 16, lineHeight: 20, fontWeight: '800', color: theme.textPrimary }}>
                播放设置
              </AppText>
              <Pressable
                onPress={() => setShowPlaybackSheet(false)}
                style={({ pressed }) => ({
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.secondaryCardBackground,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons name="close" size={15} color={TEXT_TERTIARY} />
              </Pressable>
            </View>
            <LoopSheetRow
              label="循环完当前句后暂停"
              right={<SheetSwitch active={controlProps.singlePause} onPress={controlProps.onToggleSinglePause} />}
            />
            <LoopSheetRow
              label="循环间隔（秒）"
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <SheetStepperButton
                    label="−"
                    onPress={() => controlProps.onSetIntervalDelay(Math.max(0, controlProps.intervalDelay - 1))}
                  />
                  <AppText
                    style={{
                      minWidth: 24,
                      textAlign: 'center',
                      fontSize: 16,
                      lineHeight: 20,
                      fontWeight: '700',
                      color: TEXT_PRIMARY,
                    }}
                  >
                    {controlProps.intervalDelay}
                  </AppText>
                  <SheetStepperButton
                    label="+"
                    onPress={() => controlProps.onSetIntervalDelay(Math.min(10, controlProps.intervalDelay + 1))}
                  />
                </View>
              }
            />
            <LoopSheetRow
              label="句子循环"
              last
              right={<SheetSwitch active={controlProps.isLoopActive} onPress={controlProps.onToggleLoop} />}
            />
          </View>
        </View>
      </Modal>

      {/* Note edit sheet (replaces inline TextInput on tablet) */}
      <Modal
        visible={noteSheet.visible}
        transparent
        animationType="fade"
        onRequestClose={noteSheet.onCancel}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable
            onPress={noteSheet.onCancel}
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
              width: '100%',
              maxWidth: 520,
              borderRadius: 24,
              backgroundColor: theme.elevatedCardBackground,
              padding: 18,
              gap: 12,
              shadowColor: theme.shadowColor,
              shadowOpacity: 0.14,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            <AppText style={{ fontSize: 16, lineHeight: 20, fontWeight: '800', color: theme.textPrimary }}>
              {noteSheet.hasExistingNote ? '编辑笔记' : '记录笔记'}
            </AppText>
            <TextInput
              value={noteSheet.input}
              onChangeText={noteSheet.onChange}
              placeholder="写下你的笔记..."
              placeholderTextColor={TEXT_SECONDARY}
              multiline
              autoFocus
              style={{
                minHeight: 120,
                borderRadius: RADIUS_CARD,
                backgroundColor: theme.cardBackground,
                borderWidth: 0.5,
                borderColor: theme.border,
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: TEXT_PRIMARY,
                fontSize: FONT_BODY,
                lineHeight: 22,
                textAlignVertical: 'top',
              }}
            />
            {noteSheet.error ? (
              <AppText style={{ fontSize: FONT_CAPTION, color: COLOR_RED }}>{noteSheet.error}</AppText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <Pressable
                onPress={noteSheet.onCancel}
                style={({ pressed }) => ({
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: theme.secondaryCardBackground,
                  borderWidth: 0.5,
                  borderColor: theme.border,
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <AppText style={{ fontSize: 14, fontWeight: '600', color: theme.textPrimary }}>取消</AppText>
              </Pressable>
              <Pressable
                onPress={noteSheet.onSubmit}
                disabled={noteSheet.submitting || !noteSheet.input.trim()}
                style={({ pressed }) => ({
                  paddingHorizontal: 18,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: theme.primaryBlue,
                  opacity: noteSheet.submitting || !noteSheet.input.trim() ? 0.5 : pressed ? 0.78 : 1,
                })}
              >
                <AppText style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>
                  {noteSheet.submitting ? '保存中…' : '保存'}
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {toastMessage ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 48,
            right: '50%',
            bottom: 32,
            paddingRight: 18,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              maxWidth: '100%',
              borderRadius: 18,
              backgroundColor: 'rgba(23,24,28,0.92)',
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <AppText
              style={{
                fontSize: 12.5,
                lineHeight: 17,
                fontWeight: '600',
                color: TEXT_ON_DARK,
                textAlign: 'center',
              }}
            >
              {toastMessage}
            </AppText>
          </View>
        </View>
      ) : null}

      {/* First-paint splash. Covers everything with the page background until
          layout has fully measured. Prevents the user from seeing any
          transient state (un-clamped video card, native fullscreen blink,
          un-laid-out flex children) during the navigation transition. */}
      {!splashReady ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: theme.pageBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
