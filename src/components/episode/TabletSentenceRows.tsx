import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { Sentence } from '@/types/echolingo';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function fmtTime(t: number) {
  const safe = Math.max(0, Math.floor(t));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ActionBtn({
  icon,
  active = false,
  activeColor,
  onPress,
  disabled = false,
}: {
  icon: IoniconName;
  active?: boolean;
  activeColor?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const idleColor = isDark ? 'rgba(235,235,245,0.78)' : 'rgba(60,60,67,0.78)';
  const pressedBg = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(60,60,67,0.08)';
  const tint = active
    ? (activeColor ?? (isDark ? 'rgba(212,166,106,0.92)' : 'rgba(2,132,199,0.92)'))
    : idleColor;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed && !disabled ? pressedBg : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Ionicons name={icon} size={17} color={tint} />
    </Pressable>
  );
}

interface CommonProps {
  sentence: Sentence;
  index: number;
  showEnglish: boolean;
  showChinese: boolean;
  showPhonetic: boolean;
  englishContent?: React.ReactNode;
  isLoggedIn: boolean;
  isFav: boolean;
  hasNote: boolean;
  isToggling: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onToggleFavorite: () => void;
  onOpenNote: () => void;
  onLayout: (event: LayoutChangeEvent) => void;

  // Recording (real, optional)
  recordingSupported: boolean;
  isRecording: boolean;
  hasRecording: boolean;
  isPlayingRecording: boolean;
  onToggleRecording: () => void;
  onPlayRecording: () => void;
}

export function TabletTranscriptRow(props: CommonProps) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const enColor = theme.textPrimary;
  const zhColor = isDark ? 'rgba(148,163,184,0.78)' : 'rgba(74,64,53,0.78)';
  const metaColor = isDark ? 'rgba(148,163,184,0.62)' : 'rgba(100,116,139,0.62)';

  return (
    <Pressable
      onPress={props.onSelect}
      onLayout={props.onLayout}
      style={({ pressed }) => ({
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(28,24,18,0.07)',
        backgroundColor: pressed ? (isDark ? 'rgba(255,255,255,0.018)' : 'rgba(15,23,42,0.018)') : 'transparent',
      })}
    >
      {props.showEnglish ? (
        props.englishContent ?? (
          <AppText style={{ fontSize: 16, lineHeight: 28, fontWeight: '500', color: enColor }}>
            {props.sentence.en}
          </AppText>
        )
      ) : null}

      {props.showPhonetic && props.sentence.phonetic ? (
        <AppText
          style={{
            marginTop: props.showEnglish ? 4 : 0,
            fontSize: 13,
            lineHeight: 18,
            color: metaColor,
            fontStyle: 'italic',
          }}
        >
          {props.sentence.phonetic}
        </AppText>
      ) : null}

      {props.showChinese ? (
        <AppText
          style={{
            marginTop: props.showEnglish || props.showPhonetic ? 7 : 0,
            fontSize: 14,
            lineHeight: 23,
            color: zhColor,
          }}
        >
          {props.sentence.zh}
        </AppText>
      ) : null}

      <View
        style={{
          marginTop: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <AppText style={{ fontSize: 11.5, color: metaColor, fontVariant: ['tabular-nums'] }}>
            {props.index + 1}
          </AppText>
          <AppText style={{ fontSize: 11.5, color: metaColor, fontVariant: ['tabular-nums'] }}>
            {fmtTime(props.sentence.start)} – {fmtTime(props.sentence.end)}
          </AppText>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <ActionBtn icon="refresh-outline" onPress={props.onSelect} />
          <ActionBtn icon="copy-outline" onPress={props.onCopy} />
          <ActionBtn
            icon={props.isFav ? 'heart' : 'heart-outline'}
            active={props.isFav}
            activeColor="rgba(251,113,133,0.92)"
            onPress={props.onToggleFavorite}
            disabled={props.isToggling}
          />
          <ActionBtn
            icon={props.hasNote ? 'create' : 'create-outline'}
            active={props.hasNote}
            onPress={props.onOpenNote}
          />
          {props.recordingSupported ? (
            <>
              <ActionBtn
                icon={props.isRecording ? 'stop-circle' : 'mic-outline'}
                active={props.isRecording || props.hasRecording}
                activeColor={props.isRecording ? 'rgba(239,68,68,0.95)' : undefined}
                onPress={props.onToggleRecording}
              />
              {props.hasRecording ? (
                <ActionBtn
                  icon={props.isPlayingRecording ? 'stop-circle-outline' : 'play-circle-outline'}
                  active={props.isPlayingRecording}
                  onPress={props.onPlayRecording}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

interface ActiveProps extends CommonProps {
  isPlaying: boolean;
}

export function TabletActiveSentenceCard(props: ActiveProps) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const cardBg = isDark ? '#252525' : '#FFFFFF';
  const cardBorder = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.06)';
  const enColor = isDark ? 'rgba(248,250,252,0.94)' : 'rgba(15,23,42,0.92)';
  const zhColor = isDark ? 'rgba(148,163,184,0.84)' : 'rgba(74,64,53,0.84)';
  const metaColor = isDark ? 'rgba(148,163,184,0.72)' : 'rgba(100,116,139,0.62)';
  const phoneticColor = isDark ? 'rgba(148,163,184,0.72)' : 'rgba(100,116,139,0.62)';
  const pillBg = isDark ? 'rgba(240,246,252,0.05)' : 'rgba(15,23,42,0.04)';
  const pillBorder = isDark ? 'rgba(240,246,252,0.10)' : 'rgba(15,23,42,0.08)';
  const pillColor = isDark ? 'rgba(230,237,243,0.82)' : 'rgba(74,64,53,0.74)';

  return (
    <Pressable
      onPress={props.onSelect}
      onLayout={props.onLayout}
      style={({ pressed }) => ({
        marginHorizontal: 12,
        marginTop: 8,
        marginBottom: 10,
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 12,
        borderRadius: 18,
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor: cardBorder,
        shadowColor: '#000',
        shadowOpacity: isDark ? 0.18 : 0.05,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      {props.showEnglish ? (
        props.englishContent ?? (
          <AppText style={{ fontSize: 16, lineHeight: 28, fontWeight: '600', color: enColor }}>
            {props.sentence.en}
          </AppText>
        )
      ) : null}

      {props.showPhonetic && props.sentence.phonetic ? (
        <AppText
          style={{
            marginTop: props.showEnglish ? 6 : 0,
            fontSize: 13,
            lineHeight: 18,
            color: phoneticColor,
            fontStyle: 'italic',
          }}
        >
          {props.sentence.phonetic}
        </AppText>
      ) : null}

      {props.showChinese ? (
        <AppText
          style={{
            marginTop: props.showEnglish || props.showPhonetic ? 7 : 0,
            fontSize: 14,
            lineHeight: 23,
            color: zhColor,
          }}
        >
          {props.sentence.zh}
        </AppText>
      ) : null}

      <View
        style={{
          marginTop: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <AppText style={{ fontSize: 11.5, color: metaColor, fontVariant: ['tabular-nums'] }}>
            {props.index + 1}
          </AppText>
          <AppText style={{ fontSize: 11.5, color: metaColor, fontVariant: ['tabular-nums'] }}>
            {fmtTime(props.sentence.start)} – {fmtTime(props.sentence.end)}
          </AppText>
          {props.isPlaying ? (
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 1,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: pillBorder,
                backgroundColor: pillBg,
              }}
            >
              <AppText style={{ fontSize: 10, lineHeight: 14, color: pillColor, letterSpacing: 0.2 }}>
                正在播放
              </AppText>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <ActionBtn icon="refresh-outline" onPress={props.onSelect} />
          <ActionBtn icon="copy-outline" onPress={props.onCopy} />
          <ActionBtn
            icon={props.isFav ? 'heart' : 'heart-outline'}
            active={props.isFav}
            activeColor="rgba(251,113,133,0.92)"
            onPress={props.onToggleFavorite}
            disabled={props.isToggling}
          />
          <ActionBtn
            icon={props.hasNote ? 'create' : 'create-outline'}
            active={props.hasNote}
            onPress={props.onOpenNote}
          />
          {props.recordingSupported ? (
            <>
              <ActionBtn
                icon={props.isRecording ? 'stop-circle' : 'mic-outline'}
                active={props.isRecording || props.hasRecording}
                activeColor={props.isRecording ? 'rgba(239,68,68,0.95)' : undefined}
                onPress={props.onToggleRecording}
              />
              {props.hasRecording ? (
                <ActionBtn
                  icon={props.isPlayingRecording ? 'stop-circle-outline' : 'play-circle-outline'}
                  active={props.isPlayingRecording}
                  onPress={props.onPlayRecording}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
