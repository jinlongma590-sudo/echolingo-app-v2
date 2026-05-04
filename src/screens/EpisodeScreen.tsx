import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView } from 'expo-video';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Clipboard, Easing, InteractionManager, LayoutAnimation, LayoutChangeEvent, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, TextInput, UIManager, View } from 'react-native';
import ReAnimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing as REasing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Dimensions } from 'react-native';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { EpisodeBottomBar } from '@/components/EpisodeBottomBar';
import { BackLink } from '@/components/ui/BackLink';
import { ActionButton, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { useDeviceClass, TABLET_LAYOUT_BREAKPOINT } from '@/hooks/useDeviceClass';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { useEpisodeDetailData } from '@/hooks/useEpisodeDetailData';
import { useEntitlementGuard } from '@/hooks/useEntitlementGuard';
import { useEpisodePlayerController } from '@/hooks/useEpisodePlayerController';
import { addFavorite, fetchUserFavorites, removeFavoriteByTarget } from '@/services/api/favorites';
import { upsertLearningProgress } from '@/services/api/learning';
import { addNote, fetchNotesForSentence, updateNote } from '@/services/api/sentenceNotes';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { EpisodeScreenTablet } from '@/screens/EpisodeScreenTablet';
import {
  TabletActiveSentenceCard as TabletActiveSentenceCardV2,
  TabletTranscriptRow as TabletTranscriptRowV2,
} from '@/components/episode/TabletSentenceRows';
import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioPlayer,
} from 'expo-audio';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { PhraseCard, Sentence } from '@/types/echolingo';
import {
  BG_CARD,
  BG_CARD_SOFT,
  BG_HERO,
  BG_OVERLAY,
  COLOR_BLUE,
  COLOR_BLUE_BG,
  COLOR_RED,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  RADIUS_CARD,
  SPACING_PAGE_H,
  TEXT_ON_DARK,
  TEXT_ON_DARK_DIM,
} from '@/theme/tokens';

type TranscriptMode = 'bilingual' | 'english' | 'chinese' | 'dictation' | 'cloze' | 'cards';
type RowLayout = { y: number; height: number };
type SentenceRenderRow = { sentence: Sentence; index: number };

const MODE_FIRST_PAINT_WINDOW_RADIUS = 30;
const MODE_FIRST_PAINT_WINDOW_THRESHOLD = 90;

function logEpisodeModePerf(event: string, payload: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info(`[${event}]`, payload);
  }
}

function buildSentenceRenderRows(
  sentences: Sentence[],
  anchorIndex: number,
  windowed: boolean,
): {
  rows: SentenceRenderRow[];
  windowed: boolean;
} {
  if (!windowed || sentences.length <= MODE_FIRST_PAINT_WINDOW_THRESHOLD) {
    return {
      rows: sentences.map((sentence, index) => ({ sentence, index })),
      windowed: false,
    };
  }

  const safeAnchor = anchorIndex >= 0 ? anchorIndex : 0;
  const start = Math.max(0, safeAnchor - MODE_FIRST_PAINT_WINDOW_RADIUS);
  const end = Math.min(sentences.length, safeAnchor + MODE_FIRST_PAINT_WINDOW_RADIUS + 1);
  return {
    rows: sentences.slice(start, end).map((sentence, offset) => ({
      sentence,
      index: start + offset,
    })),
    windowed: true,
  };
}

// Module-level cache for tablet-layout determination. Set the first time we
// ever observe a tablet-wide window; subsequent EpisodeScreen mounts read it
// synchronously to avoid a one-frame phone-layout flash during navigation.
let __episodeTabletWidthSeen = false;
// Bootstrap the cache from the synchronous Dimensions read at module-load time
// so the very first EpisodeScreen mount also benefits.
if (
  (Platform.OS === 'ios' && (Platform as unknown as { isPad?: boolean }).isPad === true) ||
  Dimensions.get('window').width >= 900
) {
  __episodeTabletWidthSeen = true;
}
const EXAM_FILTER_OPTIONS = ['全部', '四级', '六级', '考研', '雅思', '托福', '专四', '专八', '高频'] as const;
type ExamFilter = (typeof EXAM_FILTER_OPTIONS)[number];
// Each overlay card tracks the sentence it shows and its Y position within the
// transcriptRows View (used for absolute positioning so it scrolls with the list).
interface FocusOverlayCard {
  sentence: Sentence;
  sentenceIndex: number;
  top: number;
}

function formatSeconds(value: number) {
  const safe = Math.max(0, Math.floor(value));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function normalizeExerciseText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMPTY_REVEALED_SET: Set<number> = new Set();
const CLOZE_SEGMENT_CACHE_LIMIT = 800;

// ── Highlight palette: identical to english-player web (src/lib/text.ts) ─────
// 极浅底色(100) + 极深文字(800) — matches web's HIGHLIGHT_COLORS verbatim.
const CLOZE_HIGHLIGHT_COLORS = [
  { bg: '#dcfce7', color: '#166534' }, // green
  { bg: '#ffedd5', color: '#9a3412' }, // orange
  { bg: '#ffe4e6', color: '#9f1239' }, // rose
  { bg: '#f3e8ff', color: '#6b21a8' }, // purple
  { bg: '#e0e7ff', color: '#3730a3' }, // indigo
];

// Identical hash function to web's hashColor() — same word always gets same color.
function hashHighlightColor(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % CLOZE_HIGHLIGHT_COLORS.length;
}

type HighlightSegment =
  | { type: 'text'; text: string }
  | {
      type: 'cloze';
      text: string;
      index: number;       // index in sentence.highlight[]
      occurrence: number;  // which occurrence of this highlight (0-based)
      bg: string;
      color: string;
      revealed: boolean;
    };

const clozeSegmentCache = new Map<string, HighlightSegment[]>();

/**
 * Tokenize sentence.en into plain-text + highlighted spans, mirroring the web
 * project's decorateHighlights / maskHighlights (uses /gi global match so EVERY
 * occurrence of each highlight phrase is colored, like the web).
 *
 * mode='display' → all highlights revealed (bilingual / english view)
 * mode='cloze'   → only revealed indices show their text; others are masked
 */
function buildClozeSegments(
  sentence: Sentence,
  revealAll: boolean,
  revealedIndices: Set<number>,
): HighlightSegment[] {
  const source = sentence.en;
  const highlights = sentence.highlight ?? [];
  if (highlights.length === 0) {
    return [{ type: 'text', text: source }];
  }

  type Match = {
    start: number;
    end: number;
    text: string;
    index: number;
    occurrence: number;
    bg: string;
    color: string;
  };
  const matches: Match[] = [];

  highlights.forEach((highlight, index) => {
    // Trim defensively — some database entries have leading/trailing whitespace
    // which would render as empty colored blocks at line wraps. Web parity is
    // preserved because the trimmed phrase still hashes to the same color
    // (web's decorateHighlights also uses trim() for hashing).
    const phrase = highlight?.trim();
    if (!phrase) return;
    const safe = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 'gi' (global + case-insensitive) — matches web's regex flags exactly so
    // every occurrence of the phrase gets colored, not just the first.
    const regex = new RegExp(safe, 'gi');
    const palette = CLOZE_HIGHLIGHT_COLORS[hashHighlightColor(phrase.toLowerCase())];
    let m: RegExpExecArray | null;
    let occ = 0;
    while ((m = regex.exec(source)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Avoid zero-length matches infinite loop
      if (end === start) {
        regex.lastIndex = start + 1;
        continue;
      }
      matches.push({
        start,
        end,
        text: m[0],
        index,
        occurrence: occ++,
        bg: palette.bg,
        color: palette.color,
      });
    }
  });

  if (matches.length === 0) {
    return [{ type: 'text', text: source }];
  }

  // Sort by start, drop overlaps (later match wins keep earliest start).
  matches.sort((a, b) => a.start - b.start);
  const filtered: Match[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  filtered.forEach((match) => {
    if (match.start > cursor) {
      segments.push({ type: 'text', text: source.slice(cursor, match.start) });
    }
    segments.push({
      type: 'cloze',
      text: match.text,
      index: match.index,
      occurrence: match.occurrence,
      bg: match.bg,
      color: match.color,
      revealed: revealAll || revealedIndices.has(match.index),
    });
    cursor = match.end;
  });
  if (cursor < source.length) {
    segments.push({ type: 'text', text: source.slice(cursor) });
  }
  return segments;
}

function getClozeSegmentCacheKey(sentence: Sentence, revealAll: boolean, revealedIndicesKey: string) {
  const highlightsKey = (sentence.highlight ?? []).join('\u0001');
  return `${sentence.id}\u0002${sentence.en}\u0002${highlightsKey}\u0002${revealAll ? 'all' : revealedIndicesKey}`;
}

function getCachedClozeSegments(
  sentence: Sentence,
  revealAll: boolean,
  revealedIndices: Set<number>,
  revealedIndicesKey = '',
) {
  const key = getClozeSegmentCacheKey(sentence, revealAll, revealedIndicesKey);
  const cached = clozeSegmentCache.get(key);
  if (cached) return cached;

  const next = buildClozeSegments(sentence, revealAll, revealedIndices);
  if (clozeSegmentCache.size >= CLOZE_SEGMENT_CACHE_LIMIT) {
    const oldest = clozeSegmentCache.keys().next().value;
    if (oldest) clozeSegmentCache.delete(oldest);
  }
  clozeSegmentCache.set(key, next);
  return next;
}

function getRevealedIndicesForSentence(sentenceId: number, keys: Set<string>) {
  if (keys.size === 0) {
    return { indices: EMPTY_REVEALED_SET, key: '' };
  }

  const indices: number[] = [];
  keys.forEach((value) => {
    if (!value.startsWith(`${sentenceId}-`)) return;
    const parsed = Number(value.split('-')[1]);
    if (!Number.isNaN(parsed)) indices.push(parsed);
  });
  if (indices.length === 0) {
    return { indices: EMPTY_REVEALED_SET, key: '' };
  }

  indices.sort((a, b) => a - b);
  return { indices: new Set(indices), key: indices.join(',') };
}

// Convenience wrapper for display modes (bilingual / english) — all revealed.
function buildHighlightSegments(sentence: Sentence): HighlightSegment[] {
  return getCachedClozeSegments(sentence, true, EMPTY_REVEALED_SET, 'all');
}

// ─── Highlighted English text ───────────────────────────────────────────────
//
// PRIOR APPROACH (abandoned): nested <Text> with inline backgroundColor.
// Problem: on iOS, the bg of an inline <Text> fills the ENTIRE line-height
// box of its line. When a sentence has highlights on two adjacent wrapped
// lines (e.g. "make it all up" line 1 + "meaningful" line 2), the colored
// bgs touch at the line boundary with zero visible gap — looks ugly, no
// breathing room. There's no inline-text styling to fix this.
//
// CURRENT APPROACH: render the sentence as a row of per-word <View> units
// inside a `flexDirection: row, flexWrap: wrap` container. Each unit has
// its own bounded bg + paddingHorizontal + borderRadius (chip-like), and
// `marginVertical` on every unit creates a visible gap between adjacent
// wrapped lines' bgs.
//
// Trade-offs:
// - Multi-word highlight phrases ("keep yourself in captivity") render as
//   ONE View, so they never break mid-phrase — matches web's
//   `display: inline-block; white-space: nowrap`.
// - Plain-text segments are split into word-units (word + trailing space)
//   so flexWrap can break at word boundaries, mimicking natural text wrap.
function HighlightedEnglish({
  sentence,
  fontSize,
  lineHeight,
  fontWeight = '500',
  color,
  onWordPress,
  centered = false,
}: {
  sentence: Sentence;
  fontSize: number;
  lineHeight: number;
  fontWeight?: '400' | '500' | '600' | '700';
  color: string;
  onWordPress?: (word: string, sentence: Sentence) => void;
  centered?: boolean;
}) {
  const segments = useMemo(() => buildHighlightSegments(sentence), [sentence]);

  // Fast path: no highlights → plain Text (preserves native text selection).
  if (segments.length === 1 && segments[0].type === 'text') {
    return (
      <AppText style={{ fontSize, lineHeight, fontWeight, color }}>
        {sentence.en}
      </AppText>
    );
  }

  // Vertical breathing room between wrapped lines. Each unit's own bg is
  // bounded by its View height (text + paddingVertical), so wrapped rows
  // get (marginBottom of row N) + (marginTop of row N+1) of visible gap
  // between their colored bgs.
  const UNIT_MARGIN_V = 4;

  const baseTextStyle = { fontSize, lineHeight, fontWeight, color } as const;
  const units: React.ReactNode[] = [];

  segments.forEach((seg, segIdx) => {
    if (seg.type === 'text') {
      // Split into word + trailing whitespace units so flexWrap can break
      // at word boundaries.
      const parts = seg.text.match(/\S+\s*|\s+/g) ?? [seg.text];
      parts.forEach((part, i) => {
        if (part.length === 0) return;
        units.push(
          <View
            key={`t-${segIdx}-${i}`}
            style={{ marginVertical: UNIT_MARGIN_V, justifyContent: 'center' }}
          >
            <AppText style={baseTextStyle}>{part}</AppText>
          </View>,
        );
      });
    } else {
      const press = onWordPress ? () => onWordPress(seg.text, sentence) : undefined;
      units.push(
        <Pressable
          key={`h-${segIdx}-${seg.occurrence}`}
          onPress={press}
          hitSlop={4}
          unstable_pressDelay={0}
          style={({ pressed }) => ({
            marginVertical: UNIT_MARGIN_V,
            marginHorizontal: 1,
            borderRadius: 5,
            backgroundColor: seg.bg,
            paddingHorizontal: 4,
            paddingVertical: 1,
            opacity: pressed ? 0.78 : 1,
          })}
        >
          <AppText
            style={{
              fontSize,
              lineHeight,
              fontWeight: '600',
              color: seg.color,
            }}
          >
            {seg.text}
          </AppText>
        </Pressable>,
      );
    }
  });

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: centered ? 'center' : 'flex-start',
        // Negate per-unit marginVertical at edges so the block height
        // matches its visual extent (no extra space at top/bottom).
        marginVertical: -UNIT_MARGIN_V,
      }}
    >
      {units}
    </View>
  );
}

// ─── Word dictionary popup (iOS-style bottom sheet) ─────────────────────────
//
// Mirrors english-player web's WordDictPopup. Shows: word title + speaker,
// phonetic, current example sentence, matched phrase-card entries, and other
// occurrences of the same phrase elsewhere in this episode.
// iOS spring profiles tuned for sheet motion.
// OPEN_SPRING: a touch bouncy on open (UIKit modalPresentationStyle.pageSheet feel).
// CLOSE_SPRING: snappier, no bounce, so dismiss feels decisive.
const SHEET_OPEN_SPRING  = { damping: 22, stiffness: 260, mass: 0.95, overshootClamping: false } as const;
const SHEET_CLOSE_SPRING = { damping: 26, stiffness: 320, mass: 0.85, overshootClamping: true } as const;

function WordDictPopup({
  visible,
  word,
  phraseCards,
  currentSentence,
  insetsBottom,
  variant = 'phone',
  onClose,
  onJumpToSentence,
}: {
  visible: boolean;
  word: string | null;
  phraseCards: PhraseCard[];
  currentSentence: Sentence | null;
  insetsBottom: number;
  variant?: 'phone' | 'tablet';
  onClose: () => void;
  onJumpToSentence: (sentenceId: number) => void;
}) {
  const { theme } = useAppTheme();
  const isTabletVariant = variant === 'tablet';
  const screenH = Dimensions.get('window').height;
  // Initial offscreen offset = full sheet area height (max 82% of screen).
  const SHEET_MAX_H = screenH * 0.82;

  // Translate-Y of the sheet from its docked-open position. 0 = fully open;
  // SHEET_MAX_H = fully off-screen below.
  const sheetY = useSharedValue(SHEET_MAX_H);
  // Tracks pan-gesture start position so onUpdate is relative.
  const panStartY = useSharedValue(0);

  // We keep the Modal mounted during exit so the slide-down animation can
  // play out — `mounted` lags behind `visible` on close.
  const [mounted, setMounted] = useState(false);

  // Imperative dismiss: animate down THEN unmount + notify parent. Centralizes
  // close logic so X tap, backdrop tap and pan-flick all share the same
  // animation curve. Without this, the worklet spring (pan-flick) would race
  // against a separate withTiming triggered by visible→false.
  const animateClose = useCallback((velocity: number = 0) => {
    sheetY.value = withSpring(
      SHEET_MAX_H,
      { ...SHEET_CLOSE_SPRING, velocity },
      (finished) => {
        'worklet';
        if (finished) {
          runOnJS(setMounted)(false);
          runOnJS(onClose)();
        }
      },
    );
  }, [SHEET_MAX_H, onClose, sheetY]);

  // Drive the OPEN animation when the visible prop flips true. CLOSE is driven
  // by user interaction (animateClose), not by visible→false alone — but if
  // the parent force-closes (e.g. unmount), we still animate down gracefully.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      sheetY.value = SHEET_MAX_H;
      sheetY.value = withSpring(0, SHEET_OPEN_SPRING);
    } else if (mounted) {
      // Parent set visible=false externally — animate down (without re-calling
      // onClose since visible is already false on the parent side).
      sheetY.value = withSpring(SHEET_MAX_H, SHEET_CLOSE_SPRING, (finished) => {
        'worklet';
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Pan-to-dismiss on the handle. Drag down → translate; release past
  // threshold OR with downward velocity → close with that velocity for
  // organic momentum-aware spring.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          'worklet';
          panStartY.value = sheetY.value;
        })
        .onUpdate((event) => {
          'worklet';
          // Downward drag follows finger; upward gets rubber-band damping.
          const next = panStartY.value + event.translationY;
          sheetY.value = next < 0 ? next * 0.18 : next;
        })
        .onEnd((event) => {
          'worklet';
          const dismiss =
            sheetY.value > SHEET_MAX_H * 0.22 ||
            event.velocityY > 600;
          if (dismiss) {
            runOnJS(animateClose)(event.velocityY);
          } else {
            sheetY.value = withSpring(0, {
              ...SHEET_OPEN_SPRING,
              velocity: event.velocityY,
            });
          }
        }),
    [SHEET_MAX_H, animateClose, panStartY, sheetY],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      sheetY.value,
      [0, SHEET_MAX_H],
      [0.32, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const matchedCards = useMemo(() => {
    if (!word) return [];
    const target = word.toLowerCase().trim();
    return phraseCards.filter((c) => c.phrase.toLowerCase().trim() === target);
  }, [phraseCards, word]);

  const occurrences = useMemo(() => {
    if (!word || !currentSentence) return [];
    return matchedCards.filter((c) => c.sentenceId !== currentSentence.id);
  }, [matchedCards, currentSentence, word]);

  const primary = matchedCards[0];

  const renderHighlightedExample = (text: string, target: string) => {
    if (!text) return null;
    const idx = text.toLowerCase().indexOf(target.toLowerCase());
    if (idx === -1) return <AppText>{text}</AppText>;
    return (
      <AppText>
        {text.slice(0, idx)}
        <AppText style={{ backgroundColor: '#fde68a', color: '#92400e', fontWeight: '700' }}>
          {text.slice(idx, idx + target.length)}
        </AppText>
        {text.slice(idx + target.length)}
      </AppText>
    );
  };

  // The inner body (header → phonetic → scroll content). Shared across phone
  // bottom-sheet and tablet centered modal — only the shell differs.
  const bodyContent = (
    <>
      {/* Header */}
      <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 12,
              borderBottomWidth: 0.5,
              borderBottomColor: theme.separator,
            }}
          >
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <AppText style={{ fontSize: 22, fontWeight: '700', letterSpacing: -0.4, color: theme.textPrimary }}>
                {word ?? ''}
              </AppText>
              {primary?.type ? (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 6,
                    backgroundColor: theme.secondaryCardBackground,
                    borderWidth: 0.5,
                    borderColor: theme.border,
                  }}
                >
                  <AppText style={{ fontSize: 11, fontWeight: '600', color: theme.textSecondary }}>{primary.type}</AppText>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={() => animateClose(0)}
              hitSlop={12}
              unstable_pressDelay={0}
              style={({ pressed }) => ({
                width: 30,
                height: 30,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.secondaryCardBackground,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="close" size={16} color={theme.textSecondary} />
            </Pressable>
          </View>

          {/* Phonetic */}
          {primary?.phonetic ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 20,
                paddingVertical: 10,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.separator,
              }}
            >
              <Ionicons name="volume-medium-outline" size={14} color={theme.textSecondary} />
              <AppText style={{ fontSize: 12, color: theme.textSecondary }}>音标</AppText>
              <AppText style={{ fontSize: 13, color: theme.textPrimary }}>{primary.phonetic}</AppText>
            </View>
          ) : null}

          <ScrollView
            style={{ maxHeight: 520 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Current example */}
            {currentSentence && word ? (
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 14,
                  paddingBottom: 14,
                  borderBottomWidth: 0.5,
                  borderBottomColor: theme.separator,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Ionicons name="locate-outline" size={12} color={theme.textSecondary} />
                  <AppText style={{ fontSize: 12, color: theme.textSecondary }}>当前例句</AppText>
                  <AppText style={{ fontSize: 11, color: theme.textTertiary }}>
                    {formatSeconds(currentSentence.start)} – {formatSeconds(currentSentence.end)}
                  </AppText>
                </View>
                <AppText style={{ fontSize: 14, lineHeight: 22, color: theme.textPrimary }}>
                  {renderHighlightedExample(currentSentence.en, word)}
                </AppText>
                {currentSentence.zh ? (
                  <AppText style={{ marginTop: 4, fontSize: 12, lineHeight: 19, color: theme.textSecondary }}>
                    {currentSentence.zh}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            {/* Entries */}
            <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
              {matchedCards.length > 0 ? (
                matchedCards.map((card, i) => (
                  <View
                    key={`${card.id}-${i}`}
                    style={{
                      borderRadius: 14,
                      borderWidth: 0.5,
                      borderColor: theme.border,
                      backgroundColor: theme.secondaryCardBackground,
                      padding: 14,
                      gap: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <View
                        style={{
                          paddingHorizontal: 7,
                          paddingVertical: 2,
                          borderRadius: 5,
                          backgroundColor: theme.fillSecondary,
                          borderWidth: 0.5,
                          borderColor: theme.border,
                        }}
                      >
                        <AppText style={{ fontSize: 11, fontWeight: '600', color: theme.textSecondary }}>
                          {card.type ?? 'phrase'}
                        </AppText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText style={{ fontSize: 15, fontWeight: '700', color: theme.textPrimary, lineHeight: 21 }}>
                          {card.zh || '暂无释义'}
                        </AppText>
                        {card.definition ? (
                          <AppText style={{ marginTop: 2, fontSize: 12, lineHeight: 18, color: theme.textSecondary }}>
                            {card.definition}
                          </AppText>
                        ) : null}
                      </View>
                    </View>

                    {(card.example || card.exampleZh || card.contextEn || card.contextZh) ? (
                      <View
                        style={{
                          marginTop: 4,
                          padding: 10,
                          borderRadius: 10,
                          backgroundColor: theme.cardBackground,
                          borderWidth: 0.5,
                          borderColor: theme.border,
                        }}
                      >
                        {(card.example || card.contextEn) ? (
                          <AppText style={{ fontSize: 13, lineHeight: 20, color: theme.textPrimary }}>
                            {card.example || card.contextEn}
                          </AppText>
                        ) : null}
                        {(card.exampleZh || card.contextZh) ? (
                          <AppText style={{ marginTop: 2, fontSize: 12, lineHeight: 18, color: theme.textSecondary }}>
                            {card.exampleZh || card.contextZh}
                          </AppText>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))
              ) : (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <AppText style={{ fontSize: 22, marginBottom: 6 }}>📖</AppText>
                  <AppText style={{ fontSize: 13, color: theme.textSecondary }}>暂无词典释义</AppText>
                  <AppText style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
                    该词在本期内容中无详细释义数据
                  </AppText>
                </View>
              )}
            </View>

            {/* Occurrences */}
            {matchedCards.length > 0 ? (
              <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Ionicons name="library-outline" size={12} color={theme.textSecondary} />
                  <AppText style={{ fontSize: 12, color: theme.textSecondary }}>出现记录</AppText>
                  <AppText style={{ fontSize: 11, color: theme.textTertiary }}>({occurrences.length} 处)</AppText>
                </View>
                {occurrences.length === 0 ? (
                  <AppText style={{ fontSize: 12, color: theme.textTertiary, paddingVertical: 8 }}>
                    该词在本期其他句子中暂无出现记录
                  </AppText>
                ) : (
                  occurrences.map((occ, idx) => (
                    <Pressable
                      key={`${occ.id}-${idx}`}
                      onPress={() => {
                        onJumpToSentence(occ.sentenceId);
                        onClose();
                      }}
                      style={({ pressed }) => ({
                        marginBottom: 8,
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 0.5,
                        borderColor: theme.border,
                        backgroundColor: theme.secondaryCardBackground,
                        opacity: pressed ? 0.78 : 1,
                      })}
                    >
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <AppText style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>#{idx + 1}</AppText>
                        <View style={{ flex: 1 }}>
                          <AppText style={{ fontSize: 13, lineHeight: 19, color: theme.textPrimary }}>
                            {occ.contextEn && word ? renderHighlightedExample(occ.contextEn, word) : `句子 #${occ.sentenceId}`}
                          </AppText>
                          {occ.contextZh ? (
                            <AppText style={{ marginTop: 2, fontSize: 12, lineHeight: 18, color: theme.textSecondary }}>
                              {occ.contextZh}
                            </AppText>
                          ) : null}
                          {occ.start !== undefined && occ.end !== undefined ? (
                            <AppText style={{ marginTop: 4, fontSize: 11, color: theme.textTertiary }}>
                              {formatSeconds(occ.start)} – {formatSeconds(occ.end)}
                            </AppText>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
      </ScrollView>
    </>
  );

  if (isTabletVariant) {
    return (
      <Modal
        visible={mounted}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable
            onPress={onClose}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: 'rgba(0,0,0,0.32)',
            }}
          />
          <View
            style={{
              width: '100%',
              maxWidth: 600,
              maxHeight: Math.min(screenH * 0.82, 760),
              borderRadius: 22,
              overflow: 'hidden',
              backgroundColor: theme.elevatedCardBackground,
              shadowColor: '#000',
              shadowOpacity: 0.22,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 18 },
              elevation: 10,
            }}
          >
            {bodyContent}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={() => animateClose(0)}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <ReAnimated.View
          pointerEvents={visible ? 'auto' : 'none'}
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG_OVERLAY },
            backdropStyle,
          ]}
        >
          <Pressable style={{ flex: 1 }} onPress={() => animateClose(0)} />
        </ReAnimated.View>

        <ReAnimated.View
          style={[
            {
              backgroundColor: theme.elevatedCardBackground,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              maxHeight: SHEET_MAX_H,
              paddingBottom: insetsBottom,
              shadowColor: '#000',
              shadowOpacity: 0.22,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -8 },
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={panGesture}>
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 8 }}>
              <View style={{ width: 42, height: 5, borderRadius: 999, backgroundColor: 'rgba(122,110,96,0.28)' }} />
            </View>
          </GestureDetector>

          {bodyContent}
        </ReAnimated.View>
      </View>
    </Modal>
  );
}

function ModeTabs({ value, onChange }: { value: TranscriptMode; onChange: (next: TranscriptMode) => void }) {
  const { theme } = useAppTheme();
  const items: { key: TranscriptMode; label: string }[] = [
    { key: 'bilingual', label: '双语' },
    { key: 'english', label: '英语' },
    { key: 'chinese', label: '中文' },
    { key: 'dictation', label: '听写' },
    { key: 'cloze', label: '挖空' },
    { key: 'cards', label: '词卡' },
  ];

  return (
    <View
      style={{
        marginHorizontal: SPACING_PAGE_H,
        marginTop: 10,
        marginBottom: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.separator,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {items.map((item) => (
          <View key={item.key} style={{ flex: 1 }}>
            <Pressable
              onPress={() => onChange(item.key)}
              style={({ pressed }) => ({
                minHeight: 36,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
                paddingTop: 2,
                paddingBottom: 10,
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <AppText
                style={{
                  fontSize: 11.5,
                  fontWeight: value === item.key ? '700' : '600',
                  letterSpacing: value === item.key ? -0.1 : 0,
                  color: value === item.key ? theme.textPrimary : theme.textSecondary,
                }}
              >
                {item.label}
              </AppText>
              <View
                style={{
                  position: 'absolute',
                  left: 16,
                  right: 16,
                  bottom: 0,
                  height: 2,
                  borderRadius: 999,
                  backgroundColor: value === item.key ? theme.textPrimary : 'transparent',
                }}
              />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

function TopToolbarButton({
  icon,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const dark = theme.colorScheme === 'dark';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.secondaryCardBackground,
        borderWidth: 0.5,
        borderColor: theme.border,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={dark ? theme.textPrimary : '#111827'} />
    </Pressable>
  );
}

function PhraseCardItem({ card }: { card: PhraseCard }) {
  const { theme } = useAppTheme();
  return (
    <SurfaceCard>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AppText style={{ fontSize: 17, fontWeight: '700', color: theme.textPrimary }}>{card.phrase}</AppText>
          <StatusPill label={card.tag} tone="amber" />
        </View>
        <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 21, color: theme.textSecondary }}>{card.zh}</AppText>
      </View>
    </SurfaceCard>
  );
}

function getPhraseCardTypeLabel(type?: string) {
  switch (type) {
    case 'phrase':
      return '短语';
    case 'verb_phrase':
      return '短语动词';
    case 'collocation':
      return '搭配';
    case 'proper_noun':
      return '专有名词';
    case 'idiom':
      return '习语';
    case 'word':
    default:
      return '单词';
  }
}

function PhraseTypeBadge({ type }: { type?: string }) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        borderRadius: 5,
        backgroundColor: theme.fillSecondary,
        borderWidth: 0.5,
        borderColor: theme.border,
        paddingHorizontal: 6,
        paddingVertical: 3,
      }}
    >
      <AppText style={{ fontSize: 10, lineHeight: 12, fontWeight: '600', color: theme.textTertiary }}>
        {getPhraseCardTypeLabel(type)}
      </AppText>
    </View>
  );
}

function PhraseCardPanelNative({
  cards,
  onJump,
}: {
  cards: PhraseCard[];
  onJump: (sentenceId: number) => void;
}) {
  const { theme } = useAppTheme();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeExamFilter, setActiveExamFilter] = useState<ExamFilter>('全部');
  const [listReady, setListReady] = useState(() => cards.length <= MODE_FIRST_PAINT_WINDOW_THRESHOLD);

  const examFilterCounts = useMemo(() => {
    const counts = Object.fromEntries(EXAM_FILTER_OPTIONS.map((tag) => [tag, 0])) as Record<ExamFilter, number>;
    counts.全部 = cards.length;
    for (const tag of EXAM_FILTER_OPTIONS) {
      if (tag === '全部') continue;
      counts[tag] = cards.filter((card) => Array.isArray(card.exam_tags) && card.exam_tags.includes(tag)).length;
    }
    return counts;
  }, [cards]);

  const filteredCards = useMemo(() => {
    if (activeExamFilter === '全部') return cards;
    return cards.filter((card) => Array.isArray(card.exam_tags) && card.exam_tags.includes(activeExamFilter));
  }, [activeExamFilter, cards]);

  useEffect(() => {
    setSelectedIndex(null);
  }, [activeExamFilter]);

  useEffect(() => {
    if (filteredCards.length <= MODE_FIRST_PAINT_WINDOW_THRESHOLD) {
      setListReady(true);
      return undefined;
    }

    setListReady(false);
    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setListReady(true);
      });
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, [activeExamFilter, filteredCards.length]);

  useEffect(() => {
    if (selectedIndex === null) return;
    if (filteredCards.length === 0) {
      setSelectedIndex(null);
      return;
    }
    if (selectedIndex > filteredCards.length - 1) {
      setSelectedIndex(filteredCards.length - 1);
    }
  }, [filteredCards, selectedIndex]);

  if (selectedIndex !== null) {
    const selectedCard = filteredCards[selectedIndex];
    if (!selectedCard) return null;
    return (
      <View style={{ flex: 1, backgroundColor: theme.pageBackground }}>
        <View
          style={{
            minHeight: 48,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderBottomWidth: 0.5,
            borderBottomColor: theme.separator,
            backgroundColor: theme.cardBackground,
          }}
        >
          <Pressable onPress={() => setSelectedIndex(null)} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={theme.textTertiary} />
          </Pressable>
          <AppText numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 19, fontWeight: '700', color: theme.textPrimary }}>
            {selectedCard.phrase}
          </AppText>
          <Pressable
            disabled={selectedIndex === 0}
            onPress={() => setSelectedIndex((value) => Math.max(0, (value ?? 1) - 1))}
            style={{ opacity: selectedIndex === 0 ? 0.3 : 1 }}
          >
            <Ionicons name="chevron-back" size={16} color={theme.textTertiary} />
          </Pressable>
          <Pressable
            disabled={selectedIndex === filteredCards.length - 1}
            onPress={() => setSelectedIndex((value) => Math.min(filteredCards.length - 1, (value ?? 0) + 1))}
            style={{ opacity: selectedIndex === filteredCards.length - 1 ? 0.3 : 1 }}
          >
            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <View
            style={{
              borderRadius: 22,
              backgroundColor: theme.cardBackground,
              borderWidth: 0.5,
              borderColor: theme.border,
              padding: 18,
              gap: 14,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <PhraseTypeBadge type={selectedCard.type} />
              <StatusPill label={`${selectedIndex + 1} / ${filteredCards.length}`} tone="neutral" />
            </View>
            <AppText style={{ fontSize: 24, lineHeight: 30, fontWeight: '800', color: theme.textPrimary }}>
              {selectedCard.phrase}
            </AppText>
            {selectedCard.phonetic ? (
              <AppText style={{ fontSize: 14, lineHeight: 20, color: theme.textTertiary }}>
                {selectedCard.phonetic}
              </AppText>
            ) : null}
            <AppText style={{ fontSize: 16, lineHeight: 25, color: theme.textSecondary }}>
              {selectedCard.zh}
            </AppText>
            {selectedCard.definition ? (
              <AppText style={{ fontSize: 14.5, lineHeight: 24, color: theme.textSecondary }}>
                {selectedCard.definition}
              </AppText>
            ) : null}
            {selectedCard.example ? (
              <View style={{ borderRadius: 16, backgroundColor: theme.secondaryCardBackground, padding: 14, gap: 8 }}>
                <AppText style={{ fontSize: 14.5, lineHeight: 23, color: theme.textPrimary }}>
                  {selectedCard.example}
                </AppText>
                {selectedCard.exampleZh ? (
                  <AppText style={{ fontSize: 13.5, lineHeight: 21, color: theme.textSecondary }}>
                    {selectedCard.exampleZh}
                  </AppText>
                ) : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <ActionButton label="跳到原句" variant="dark" onPress={() => onJump(selectedCard.sentenceId)} />
              <ActionButton label="返回列表" variant="primary" onPress={() => setSelectedIndex(null)} />
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.pageBackground }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={{ borderBottomWidth: 0.5, borderBottomColor: theme.separator, backgroundColor: theme.pageBackground }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <AppText style={{ marginBottom: 4, fontSize: 10, lineHeight: 12, fontWeight: '800', letterSpacing: 1.6, color: theme.textTertiary }}>
                  考试助力
                </AppText>
                <AppText style={{ fontSize: 15, lineHeight: 20, fontWeight: '800', color: theme.textPrimary }}>
                  重点词句一览无遗
                </AppText>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText style={{ fontSize: 10, lineHeight: 12, color: theme.textTertiary }}>共收录</AppText>
                <AppText style={{ fontSize: 22, lineHeight: 25, fontWeight: '800', color: theme.textPrimary }}>
                  {cards.length}
                </AppText>
                <AppText style={{ fontSize: 10, lineHeight: 12, color: theme.textTertiary }}>条词句</AppText>
              </View>
            </View>
          </View>
        </View>

        <View style={{ borderBottomWidth: 0.5, borderBottomColor: theme.separator, paddingHorizontal: 12, paddingVertical: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {EXAM_FILTER_OPTIONS.map((tag) => {
              const count = examFilterCounts[tag] ?? 0;
              const active = activeExamFilter === tag;
              const zero = count === 0 && tag !== '全部';
              return (
                <Pressable
                  key={tag}
                  onPress={() => setActiveExamFilter(tag)}
                  style={({ pressed }) => ({
                    width: '31.8%',
                    minHeight: 46,
                    borderRadius: 10,
                    borderWidth: 0.5,
                    borderColor: active ? 'rgba(0,122,255,0.30)' : theme.border,
                    backgroundColor: active ? (theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.18)' : COLOR_BLUE_BG) : theme.secondaryCardBackground,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    opacity: zero ? 0.62 : pressed ? 0.74 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: active ? theme.primaryBlue : theme.textTertiary,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <AppText
                      numberOfLines={1}
                      style={{
                        fontSize: 12,
                        lineHeight: 14,
                        fontWeight: '700',
                        color: active ? theme.primaryBlue : theme.textPrimary,
                      }}
                    >
                      {tag}
                    </AppText>
                    <AppText
                      style={{
                        marginTop: 3,
                        fontSize: 11,
                        lineHeight: 12,
                        fontWeight: '800',
                        color: active ? theme.primaryBlue : theme.textSecondary,
                      }}
                    >
                      {count}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={{
            minHeight: 38,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 0.5,
            borderBottomColor: theme.separator,
          }}
        >
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <AppText style={{ fontSize: 12, lineHeight: 15, fontWeight: '800', color: theme.textPrimary }}>重点词句</AppText>
            <AppText numberOfLines={1} style={{ flex: 1, fontSize: 11, lineHeight: 14, color: theme.textTertiary }}>
              {activeExamFilter === '全部' ? '按考试标签与高频标签整理' : `当前筛选：${activeExamFilter}`}
            </AppText>
          </View>
          <AppText style={{ marginLeft: 8, fontSize: 11, lineHeight: 14, fontWeight: '700', color: theme.textTertiary }}>
            {activeExamFilter === '全部' ? `${filteredCards.length} 条` : `${activeExamFilter} · ${filteredCards.length} 条`}
          </AppText>
        </View>

        {filteredCards.length === 0 ? (
          <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingVertical: 56 }}>
            <View style={{ marginBottom: 12, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.secondaryCardBackground, borderWidth: 0.5, borderColor: theme.border }}>
              <Ionicons name="search-outline" size={18} color={theme.textTertiary} />
            </View>
            <AppText style={{ marginBottom: 4, fontSize: 13, lineHeight: 17, fontWeight: '700', color: theme.textSecondary }}>
              当前标签下暂无词卡
            </AppText>
            <AppText style={{ maxWidth: 220, textAlign: 'center', fontSize: 11, lineHeight: 17, color: theme.textTertiary }}>
              可切换其他考试标签，或返回「全部」查看完整内容
            </AppText>
            <Pressable onPress={() => setActiveExamFilter('全部')} style={{ marginTop: 14, borderRadius: 999, borderWidth: 0.5, borderColor: theme.border, backgroundColor: theme.cardBackground, paddingHorizontal: 16, paddingVertical: 8 }}>
              <AppText style={{ fontSize: 11, fontWeight: '700', color: theme.textSecondary }}>返回全部</AppText>
            </Pressable>
          </View>
        ) : (
          <View>
            {(listReady ? filteredCards : filteredCards.slice(0, MODE_FIRST_PAINT_WINDOW_RADIUS + 10)).map((card, index) => (
              <Pressable
                key={card.key ?? card.id ?? `${card.phrase}-${index}`}
                onPress={() => setSelectedIndex(index)}
                style={({ pressed }) => ({
                  minHeight: 54,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  borderBottomWidth: 0.5,
                  borderBottomColor: theme.separator,
                  backgroundColor: pressed ? theme.fillSecondary : 'transparent',
                })}
              >
                <AppText style={{ width: 24, textAlign: 'right', fontSize: 11, color: theme.textTertiary }}>
                  {index + 1}
                </AppText>
                <AppText numberOfLines={1} style={{ flex: 1, fontSize: 14, lineHeight: 18, fontWeight: '600', color: theme.textPrimary }}>
                  {card.phrase}
                </AppText>
                <PhraseTypeBadge type={card.type} />
                <Ionicons name="chevron-forward" size={13} color={theme.textTertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function DictationPanel({
  sentence,
  sentenceIndex,
  sentenceTotal,
  input,
  submitted,
  showAnswer,
  isFavorite,
  canFavorite,
  onInput,
  onSubmit,
  onRetry,
  onNext,
  onToggleAnswer,
  onToggleFavorite,
  onEditNote,
}: {
  sentence: Sentence | null;
  sentenceIndex: number;
  sentenceTotal: number;
  input: string;
  submitted: boolean;
  showAnswer: boolean;
  isFavorite: boolean;
  canFavorite: boolean;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onNext: () => void;
  onToggleAnswer: () => void;
  onToggleFavorite: () => void;
  onEditNote: () => void;
}) {
  const { theme } = useAppTheme();
  if (!sentence) {
    return (
      <SurfaceCard>
        <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>当前暂无可听写句子。</AppText>
      </SurfaceCard>
    );
  }

  const correct = normalizeExerciseText(input) === normalizeExerciseText(sentence.en);
  const revealButtonStyle =
    theme.colorScheme === 'dark'
      ? {
          backgroundColor: 'rgba(10,132,255,0.18)',
          borderColor: 'rgba(10,132,255,0.32)',
        }
      : null;
  const revealButtonLabelStyle = theme.colorScheme === 'dark' ? { color: theme.primaryBlue } : null;

  return (
    <SurfaceCard>
      <View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 10,
            borderBottomWidth: 0.5,
            borderBottomColor: theme.separator,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <AppText style={{ fontSize: 13, color: theme.textSecondary }}>
              {sentenceIndex + 1} / {sentenceTotal}
            </AppText>
            <Pressable
              onPress={onToggleFavorite}
              disabled={!canFavorite}
              style={({ pressed }) => ({ opacity: canFavorite ? (pressed ? 0.64 : 1) : 0.36 })}
            >
              <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={16} color={isFavorite ? COLOR_RED : theme.textTertiary} />
            </Pressable>
            <Pressable onPress={onEditNote} style={({ pressed }) => ({ opacity: pressed ? 0.64 : 1 })}>
              <Ionicons name="create-outline" size={15} color={theme.textTertiary} />
            </Pressable>
          </View>
          <AppText style={{ fontSize: 12, color: theme.textTertiary }}>
            {formatSeconds(sentence.start)} - {formatSeconds(sentence.end)}
          </AppText>
        </View>

        <View style={{ paddingTop: 14 }}>
          {!submitted ? (
            <>
              {/* Input + (optional) original-text reveal joined as a single
                  visually-unified box with an internal divider. The reveal
                  used to live BELOW the action buttons, forcing the user to
                  scroll on iPad to compare. Now it sits directly under the
                  input so the user can read both side-by-side without
                  scrolling. */}
              <View
                style={{
                  borderRadius: 14,
                  backgroundColor: theme.secondaryCardBackground,
                  borderWidth: 0.5,
                  borderColor: theme.border,
                  overflow: 'hidden',
                }}
              >
                <TextInput
                  value={input}
                  onChangeText={onInput}
                  placeholder="开始听写吧..."
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  style={{
                    minHeight: 128,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: theme.textPrimary,
                    fontSize: 16,
                    lineHeight: 24,
                    textAlignVertical: 'top',
                  }}
                />

                {showAnswer ? (
                  <>
                    <View
                      style={{
                        height: 1,
                        marginHorizontal: 12,
                        backgroundColor: theme.separator,
                      }}
                    />
                    <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
                      <AppText style={{ fontSize: 11, lineHeight: 14, color: theme.textTertiary, marginBottom: 4 }}>
                        原文：
                      </AppText>
                      <AppText style={{ fontSize: 15, lineHeight: 24, color: theme.textPrimary }}>
                        {sentence.en}
                      </AppText>
                    </View>
                  </>
                ) : null}
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <ActionButton
                  label={showAnswer ? '隐藏原文' : '查看原文'}
                  variant={theme.colorScheme === 'dark' ? 'secondary' : 'primary'}
                  onPress={onToggleAnswer}
                  style={revealButtonStyle}
                  labelStyle={revealButtonLabelStyle}
                />
                {input.trim() ? <ActionButton label="提交" variant="dark" onPress={onSubmit} /> : null}
              </View>
            </>
          ) : (
            <>
              <View
                style={{
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  marginBottom: 12,
                  backgroundColor: correct ? 'rgba(52,199,89,0.10)' : 'rgba(255,59,48,0.08)',
                  borderWidth: 0.5,
                  borderColor: correct ? 'rgba(52,199,89,0.22)' : 'rgba(255,59,48,0.18)',
                }}
              >
                <AppText style={{ fontSize: 14, fontWeight: '600', color: correct ? '#16a34a' : '#dc2626' }}>
                  {correct ? '✓ 完全正确！' : '✗ 有误，请再试'}
                </AppText>
              </View>

              {!correct ? (
                <View
                  style={{
                    marginBottom: 12,
                    borderRadius: 12,
                    backgroundColor: theme.secondaryCardBackground,
                    borderWidth: 0.5,
                    borderColor: theme.border,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <AppText style={{ fontSize: 11, lineHeight: 14, color: theme.textTertiary, marginBottom: 4 }}>
                    原文：
                  </AppText>
                  <AppText style={{ fontSize: 15, lineHeight: 24, color: theme.textPrimary }}>
                    {sentence.en}
                  </AppText>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                {!correct ? <ActionButton label="重试" variant="primary" onPress={onRetry} /> : null}
                <ActionButton label="下一句" variant="dark" onPress={onNext} />
              </View>
            </>
          )}
        </View>
      </View>
    </SurfaceCard>
  );
}

function ClozeCard({
  sentence,
  index,
  total,
  active,
  revealedIndices,
  revealedIndicesKey,
  showAnswer,
  onRevealWord,
  onToggleAnswer,
  onSelect,
  onLayout,
}: {
  sentence: Sentence;
  index: number;
  total: number;
  active: boolean;
  revealedIndices: Set<number>;
  revealedIndicesKey?: string;
  showAnswer: boolean;
  onRevealWord: (index: number) => void;
  onToggleAnswer: () => void;
  onSelect: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { theme } = useAppTheme();
  const segments = getCachedClozeSegments(sentence, showAnswer, revealedIndices, revealedIndicesKey);
  const activeAnim = useRef(new Animated.Value(active ? 1 : 0)).current;
  const revealButtonStyle =
    theme.colorScheme === 'dark'
      ? {
          backgroundColor: 'rgba(10,132,255,0.18)',
          borderColor: 'rgba(10,132,255,0.32)',
        }
      : null;
  const revealButtonLabelStyle = theme.colorScheme === 'dark' ? { color: theme.primaryBlue } : null;

  useEffect(() => {
    Animated.timing(activeAnim, {
      toValue: active ? 1 : 0,
      duration: active ? 320 : 240,
      easing: active ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [active, activeAnim]);

  return (
    <Animated.View
      style={{
        transform: [
          {
            scale: activeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.012],
            }),
          },
          {
            translateY: activeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -2],
            }),
          },
        ],
      }}
    >
      <Pressable
        onLayout={onLayout}
        onPress={onSelect}
        style={{
          marginHorizontal: 12,
          marginBottom: 10,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingTop: 14,
          paddingBottom: 12,
          backgroundColor: active ? theme.secondaryCardBackground : theme.cardBackground,
          borderWidth: 0.5,
          borderColor: theme.border,
          shadowColor: '#000',
          shadowOpacity: active ? 0.08 : 0.02,
          shadowRadius: active ? 18 : 10,
          shadowOffset: active ? { width: 0, height: 10 } : { width: 0, height: 4 },
          elevation: active ? 4 : 1,
        }}
      >
        <View style={{ paddingTop: 14, gap: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 10,
              borderBottomWidth: 0.5,
              borderBottomColor: theme.separator,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <StatusPill label="挖空练习" tone="amber" />
              <AppText style={{ fontSize: 13, color: theme.textSecondary }}>
                {index + 1} / {total}
              </AppText>
              {active ? <StatusPill label="当前句" tone="neutral" /> : null}
            </View>
            <AppText style={{ fontSize: 12, color: theme.textTertiary }}>
              {formatSeconds(sentence.start)} - {formatSeconds(sentence.end)}
            </AppText>
          </View>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            {segments.map((segment, idx) => {
              if (segment.type === 'text') {
                return (
                  <AppText key={`text-${idx}`} style={{ fontSize: 16.5, lineHeight: 28, fontWeight: '700', color: theme.textPrimary }}>
                    {segment.text}
                  </AppText>
                );
              }
              return (
                <Pressable
                  key={`cloze-${idx}`}
                  onPress={() => onRevealWord(segment.index)}
                  style={({ pressed }) => ({
                    marginHorizontal: 2,
                    marginVertical: 2,
                    borderRadius: 4,
                    backgroundColor: segment.bg,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  <AppText
                    style={{
                      fontSize: 16.5,
                      lineHeight: 28,
                      fontWeight: '500',
                      paddingHorizontal: 4,
                      color: segment.revealed ? segment.color : segment.bg,
                    }}
                  >
                    {segment.text}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText style={{ fontSize: 13.5, lineHeight: 22, color: theme.textSecondary }}>
            {sentence.zh}
          </AppText>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <ActionButton
              label={showAnswer ? '隐藏原文' : '查看原文'}
              variant={theme.colorScheme === 'dark' ? 'secondary' : 'primary'}
              onPress={onToggleAnswer}
              style={revealButtonStyle}
              labelStyle={revealButtonLabelStyle}
            />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const MemoClozeCard = React.memo(ClozeCard, (prev, next) => (
  prev.sentence === next.sentence &&
  prev.index === next.index &&
  prev.total === next.total &&
  prev.active === next.active &&
  prev.showAnswer === next.showAnswer &&
  prev.revealedIndicesKey === next.revealedIndicesKey
));

function SentenceActionIcon({
  icon,
  color,
  backgroundColor,
  borderColor,
  onPress,
  disabled = false,
  size = 34,
  iconSize = 17,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  backgroundColor: string;
  borderColor?: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  iconSize?: number;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor,
        borderWidth: borderColor ? 0.5 : 0,
        borderColor,
        opacity: disabled ? 0.4 : pressed ? 0.74 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize} color={color} />
    </Pressable>
  );
}

function FocusSentenceCard({
  sentence,
  index,
  showEnglish,
  showChinese,
  isPlaying,
  loopActive,
  subtitleFontSize,
  isLoggedIn,
  isFav,
  isToggling,
  existingNote,
  noteVisible,
  noteInput,
  noteSubmitting,
  noteError,
  onSelect,
  onToggleLoop,
  onToggleFavorite,
  onOpenNote,
  onChangeNote,
  onSubmitNote,
  onCancelNote,
  onLayout,
  onWordPress,
  interactive = true,
}: {
  sentence: Sentence;
  index: number;
  showEnglish: boolean;
  showChinese: boolean;
  isPlaying: boolean;
  loopActive: boolean;
  subtitleFontSize: number;
  isLoggedIn: boolean;
  isFav: boolean;
  isToggling: boolean;
  existingNote: string | null;
  noteVisible: boolean;
  noteInput: string;
  noteSubmitting: boolean;
  noteError: string | null;
  onSelect: () => void;
  onToggleLoop: () => void;
  onToggleFavorite: () => void;
  onOpenNote: () => void;
  onChangeNote: (value: string) => void;
  onSubmitNote: () => void;
  onCancelNote: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onWordPress?: (word: string, sentence: Sentence) => void;
  interactive?: boolean;
}) {
  const { theme } = useAppTheme();
  const chineseIsPrimary = !showEnglish && showChinese;

  return (
    <View
      onLayout={onLayout}
      style={{
        marginHorizontal: 12,
        // More vertical breathing room around the focus card so the highlight
        // bg inside it doesn't look glued to the highlight bg of the row above.
        marginTop: 16,
        marginBottom: 18,
        borderRadius: 20,
        paddingHorizontal: 18,
        paddingTop: 22,
        paddingBottom: 16,
        backgroundColor: theme.cardBackground,
        borderWidth: 0.5,
        borderColor: theme.border,
        shadowColor: '#000',
        shadowOpacity: theme.colorScheme === 'dark' ? 0.18 : 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }}
    >
      {showEnglish ? (
        <HighlightedEnglish
          sentence={sentence}
          fontSize={subtitleFontSize + 1}
          lineHeight={subtitleFontSize + 12}
          fontWeight="700"
          color={theme.textPrimary}
          onWordPress={interactive ? onWordPress : undefined}
        />
      ) : null}
      {showChinese ? (
        <AppText
          style={{
            // Bumped from 10 to 14 to offset the new HighlightedEnglish
            // block's edge-trimming (which makes it visually flush with the
            // last line's text — and therefore closer to the Chinese line).
            marginTop: showEnglish ? 14 : 0,
            fontSize: subtitleFontSize - 2,
            lineHeight: subtitleFontSize + 6,
            fontWeight: chineseIsPrimary ? '500' : undefined,
            color: chineseIsPrimary ? theme.textPrimary : theme.textSecondary,
          }}
        >
          {sentence.zh}
        </AppText>
      ) : null}

      <View
        style={{
          marginTop: 14,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <AppText style={{ fontSize: 12, color: theme.textSecondary }}>{index + 1}</AppText>
          <AppText style={{ fontSize: 12, color: theme.textSecondary }}>
            {formatSeconds(sentence.start)} - {formatSeconds(sentence.end)}
          </AppText>
          <StatusPill label={isPlaying ? '正在播放' : '当前句'} tone="neutral" />
          {loopActive ? <StatusPill label="循环中" tone="amber" /> : null}
        </View>

        <View
          pointerEvents={interactive ? 'auto' : 'none'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            opacity: interactive ? 1 : 0.96,
          }}
        >
          <SentenceActionIcon
            icon={loopActive ? 'refresh-circle' : 'refresh-outline'}
            color={loopActive ? TEXT_ON_DARK : theme.textSecondary}
            backgroundColor={loopActive ? BG_HERO : theme.secondaryCardBackground}
            borderColor={loopActive ? undefined : theme.border}
            onPress={onToggleLoop}
            disabled={!interactive}
          />
          {isLoggedIn ? (
            <>
              <SentenceActionIcon
                icon={isFav ? 'heart' : 'heart-outline'}
                color={isFav ? COLOR_RED : theme.textSecondary}
                backgroundColor={isFav ? 'rgba(255,59,48,0.10)' : theme.secondaryCardBackground}
                borderColor={isFav ? undefined : theme.border}
                onPress={onToggleFavorite}
                disabled={!interactive || isToggling}
              />
              <SentenceActionIcon
                icon={existingNote ? 'create' : 'create-outline'}
                color={existingNote ? TEXT_ON_DARK : theme.textSecondary}
                backgroundColor={existingNote ? BG_HERO : theme.secondaryCardBackground}
                borderColor={existingNote ? undefined : theme.border}
                onPress={onOpenNote}
                disabled={!interactive}
              />
            </>
          ) : null}
        </View>
      </View>

      {noteVisible ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <TextInput
            value={noteInput}
            onChangeText={onChangeNote}
            placeholder="写下你的笔记..."
            placeholderTextColor={theme.textSecondary}
            multiline
            editable={interactive}
            style={{
              minHeight: 88,
              borderRadius: RADIUS_CARD,
              backgroundColor: theme.cardBackground,
              borderWidth: 0.5,
              borderColor: theme.border,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: theme.textPrimary,
              fontSize: FONT_BODY,
              lineHeight: 22,
              textAlignVertical: 'top',
            }}
          />
          {noteError ? <AppText style={{ fontSize: FONT_CAPTION, color: COLOR_RED }}>{noteError}</AppText> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <ActionButton label={noteSubmitting ? '保存中…' : '保存'} variant="dark" onPress={onSubmitNote} disabled={!interactive || noteSubmitting || !noteInput.trim()} />
            <ActionButton label="取消" variant="primary" onPress={onCancelNote} disabled={!interactive} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SubtitleListRow({
  sentence,
  index,
  showEnglish,
  showChinese,
  subtitleFontSize,
  onLayoutSentence,
  onSelectSentence,
  onNormalRowHeight,
}: {
  sentence: Sentence;
  index: number;
  showEnglish: boolean;
  showChinese: boolean;
  subtitleFontSize: number;
  onLayoutSentence: (sentenceId: number, event: LayoutChangeEvent) => void;
  onSelectSentence: (sentenceId: number) => void;
  onNormalRowHeight?: (sentenceId: number, height: number) => void;
}) {
  const { theme } = useAppTheme();
  const chineseIsPrimary = !showEnglish && showChinese;
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLayoutSentence(sentence.id, event);
      onNormalRowHeight?.(sentence.id, event.nativeEvent.layout.height);
    },
    [onLayoutSentence, onNormalRowHeight, sentence.id],
  );
  const handlePress = useCallback(() => {
    onSelectSentence(sentence.id);
  }, [onSelectSentence, sentence.id]);

  return (
    <Pressable
      onLayout={handleLayout}
      onPress={handlePress}
      style={{
        marginHorizontal: SPACING_PAGE_H,
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.separator,
      }}
    >
      {showEnglish ? (
        <AppText
          style={{
            fontSize: subtitleFontSize,
            lineHeight: subtitleFontSize + 11,
            fontWeight: '500',
            color: theme.textPrimary,
          }}
        >
          {sentence.en}
        </AppText>
      ) : null}
      {showChinese ? (
        <AppText
          style={{
            marginTop: showEnglish ? 8 : 0,
            fontSize: subtitleFontSize - 2.5,
            lineHeight: subtitleFontSize + 5.5,
            fontWeight: chineseIsPrimary ? '500' : undefined,
            color: chineseIsPrimary ? theme.textPrimary : theme.textSecondary,
          }}
        >
          {sentence.zh}
        </AppText>
      ) : null}

      <View
        style={{
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <AppText style={{ fontSize: 12, color: theme.textTertiary }}>{index + 1}</AppText>
          <AppText style={{ fontSize: 12, color: theme.textTertiary }}>
            {formatSeconds(sentence.start)} - {formatSeconds(sentence.end)}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Animation constants ──────────────────────────────────────────────────────
// Tuned for 120Hz ProMotion: shorter durations, ease curves (not springs) so
// motion is framerate-independent and matches UIKit's default fade/slide feel.
const CARD_ENTER_MS = 220;
const CARD_EXIT_MS  = 120;
// iOS-style fast ease-out cubic (matches UIKit spring default feel)
const FOCUS_EASING  = REasing.bezier(0.16, 1, 0.3, 1);
// Snappy spring that settles quickly without wobble
const SPRING_SNAPPY = { damping: 26, stiffness: 420, mass: 0.85 } as const;
// LayoutAnimation config — native-driven height+position transitions.
// easeInEaseOut feels more consistent than spring at 120Hz (no overshoot drift).
const FOCUS_LAYOUT_ANIM = LayoutAnimation.create(
  220,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SentenceListRow — unified row component.
 *
 * isFocused=false → compact row (in-flow, natural height).
 * isFocused=true  → FocusSentenceCard (in-flow, full height).
 *
 * Enter: spring scale (0.94→1) + spring translateY (12→0) + opacity fade (0→1).
 * Exit:  opacity fade out (CARD_EXIT_MS), THEN height collapses via LayoutAnimation
 *        driven by the parent's setFocusedSentenceId call.
 *
 * Local `exitingCard` state keeps the card rendered during the exit fade so
 * it doesn't vanish before the fade finishes.  LayoutAnimation (configured by
 * the parent before every setFocusedSentenceId) smoothly animates both the
 * collapse of the exiting row and the expansion of the entering row.
 */
function SentenceListRow({
  sentence,
  index,
  isFocused,
  showEnglish,
  showChinese,
  subtitleFontSize,
  isPlaying,
  loopActive,
  isLoggedIn,
  isFav,
  isToggling,
  existingNote,
  noteVisible,
  noteInput,
  noteSubmitting,
  noteError,
  onLayout,
  onSelect,
  onToggleLoop,
  onToggleFavorite,
  onOpenNote,
  onChangeNote,
  onSubmitNote,
  onCancelNote,
  onNormalRowHeight,
  onWordPress,
}: {
  sentence: Sentence;
  index: number;
  isFocused: boolean;
  showEnglish: boolean;
  showChinese: boolean;
  subtitleFontSize: number;
  isPlaying: boolean;
  loopActive: boolean;
  isLoggedIn: boolean;
  isFav: boolean;
  isToggling: boolean;
  existingNote: string | null;
  noteVisible: boolean;
  noteInput: string;
  noteSubmitting: boolean;
  noteError: string | null;
  onLayout: (sentenceId: number, event: LayoutChangeEvent) => void;
  onSelect: (sentenceId: number) => void;
  onToggleLoop: () => void;
  onToggleFavorite: () => void;
  onOpenNote: () => void;
  onChangeNote: (v: string) => void;
  onSubmitNote: () => void;
  onCancelNote: () => void;
  onNormalRowHeight: (sentenceId: number, height: number) => void;
  onWordPress?: (word: string, sentence: Sentence) => void;
}) {
  // Entry animation is OPACITY-ONLY. Previously we ran `scale` + `translateY`
  // springs alongside `LayoutAnimation` (which animates row height). Three
  // simultaneous animation systems on the same frame caused dropped frames on
  // Android phones (and to a lesser degree on iPhone) — the iPad path doesn't
  // run the per-row Reanimated entry at all, which is why it feels silky in
  // contrast. Keeping only opacity makes the new card appear smoothly while
  // LayoutAnimation handles size — no transform / layout conflict.
  const cardOpacity = useSharedValue(isFocused ? 1 : 0);

  const prevFocused = useRef(isFocused);

  // useLayoutEffect fires synchronously before paint — zero-lag animation start.
  useLayoutEffect(() => {
    const wasFocused = prevFocused.current;
    prevFocused.current = isFocused;

    if (isFocused && !wasFocused) {
      cardOpacity.value = 0;
      cardOpacity.value = withTiming(1, { duration: CARD_ENTER_MS, easing: FOCUS_EASING });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  const cardAnimStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
  }));

  const { theme } = useAppTheme();
  const chineseIsPrimary = !showEnglish && showChinese;

  const handleCompactLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLayout(sentence.id, event);
      onNormalRowHeight(sentence.id, event.nativeEvent.layout.height);
    },
    [onLayout, onNormalRowHeight, sentence.id],
  );

  if (isFocused) {
    return (
      <ReAnimated.View pointerEvents="auto" style={cardAnimStyle}>
        <FocusSentenceCard
          sentence={sentence}
          index={index}
          showEnglish={showEnglish}
          showChinese={showChinese}
          isPlaying={isPlaying}
          loopActive={loopActive}
          subtitleFontSize={subtitleFontSize}
          isLoggedIn={isLoggedIn}
          isFav={isFav}
          isToggling={isToggling}
          existingNote={existingNote}
          noteVisible={noteVisible}
          noteInput={noteInput}
          noteSubmitting={noteSubmitting}
          noteError={noteError}
          onSelect={() => onSelect(sentence.id)}
          onToggleLoop={onToggleLoop}
          onToggleFavorite={onToggleFavorite}
          onOpenNote={onOpenNote}
          onChangeNote={onChangeNote}
          onSubmitNote={onSubmitNote}
          onCancelNote={onCancelNote}
          onWordPress={onWordPress}
          interactive
        />
      </ReAnimated.View>
    );
  }

  return (
    <Pressable
      onPress={() => onSelect(sentence.id)}
      onLayout={handleCompactLayout}
      style={{
        marginHorizontal: SPACING_PAGE_H,
        paddingHorizontal: 18,
        // Generous vertical breathing room — when adjacent rows both have
        // highlight backgrounds at their edges (last line of row N + first
        // line of row N+1), tight padding makes the colored bgs look stacked.
        // The bg of an inline highlight Text fills the entire line-box height,
        // so the only way to add visible separation is at the row level.
        paddingTop: 28,
        paddingBottom: 26,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.separator,
      }}
    >
      {showEnglish ? (
        <HighlightedEnglish
          sentence={sentence}
          fontSize={subtitleFontSize}
          lineHeight={subtitleFontSize + 11}
          fontWeight="500"
          color={theme.textPrimary}
          onWordPress={onWordPress}
        />
      ) : null}
      {showChinese ? (
        <AppText
          style={{
            marginTop: showEnglish ? 12 : 0,
            fontSize: subtitleFontSize - 2.5,
            lineHeight: subtitleFontSize + 5.5,
            fontWeight: chineseIsPrimary ? '500' : undefined,
            color: chineseIsPrimary ? theme.textPrimary : theme.textSecondary,
          }}
        >
          {sentence.zh}
        </AppText>
      ) : null}
      <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <AppText style={{ fontSize: 12, color: theme.textTertiary }}>{index + 1}</AppText>
        <AppText style={{ fontSize: 12, color: theme.textTertiary }}>
          {formatSeconds(sentence.start)} - {formatSeconds(sentence.end)}
        </AppText>
      </View>
    </Pressable>
  );
}

function TabletActiveSentenceCard({
  sentence,
  index,
  isPlaying,
  showEnglish,
  showChinese,
  subtitleFontSize,
  isLoggedIn,
  isFav,
  isToggling,
  hasExistingNote,
  noteVisible,
  noteInput,
  noteSubmitting,
  noteError,
  onSelect,
  onToggleFavorite,
  onOpenNote,
  onChangeNote,
  onSubmitNote,
  onCancelNote,
  onLayout,
  onWordPress,
}: {
  sentence: Sentence;
  index: number;
  isPlaying: boolean;
  showEnglish: boolean;
  showChinese: boolean;
  subtitleFontSize: number;
  isLoggedIn: boolean;
  isFav: boolean;
  isToggling: boolean;
  hasExistingNote: boolean;
  noteVisible: boolean;
  noteInput: string;
  noteSubmitting: boolean;
  noteError: string | null;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onOpenNote: () => void;
  onChangeNote: (value: string) => void;
  onSubmitNote: () => void;
  onCancelNote: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onWordPress?: (word: string, sentence: Sentence) => void;
}) {
  const { theme } = useAppTheme();
  const chineseIsPrimary = !showEnglish && showChinese;

  return (
    <Pressable
      onPress={onSelect}
      onLayout={onLayout}
      style={({ pressed }) => ({
        marginHorizontal: 12,
        marginTop: 10,
        marginBottom: 12,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 12,
        backgroundColor: theme.cardBackground,
        borderWidth: 1,
        borderColor: theme.border,
        shadowColor: '#000',
        shadowOpacity: theme.colorScheme === 'dark' ? 0.18 : 0.08,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 3,
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <View style={{ minWidth: 0 }}>
        {showEnglish ? (
          <HighlightedEnglish
            sentence={sentence}
            fontSize={Math.max(subtitleFontSize, 18)}
            lineHeight={Math.max(subtitleFontSize + 12, 30)}
            fontWeight="700"
            color={theme.textPrimary}
            onWordPress={onWordPress}
          />
        ) : null}
        {showChinese ? (
          <AppText
            style={{
              marginTop: showEnglish ? 12 : 0,
              fontSize: Math.max(subtitleFontSize - 2, 14),
              lineHeight: Math.max(subtitleFontSize + 6, 22),
              fontWeight: chineseIsPrimary ? '500' : undefined,
              color: chineseIsPrimary ? theme.textPrimary : theme.textSecondary,
            }}
          >
            {sentence.zh}
          </AppText>
        ) : null}
      </View>

      <View
        style={{
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <AppText style={{ fontSize: 12, lineHeight: 15, fontWeight: '700', color: theme.textTertiary }}>
            {index + 1}
          </AppText>
          <AppText style={{ fontSize: 12, lineHeight: 15, color: theme.textSecondary }}>
            {formatSeconds(sentence.start)} - {formatSeconds(sentence.end)}
          </AppText>
          <StatusPill label={isPlaying ? '正在播放' : '当前句'} tone="neutral" />
          {hasExistingNote ? <StatusPill label="有笔记" tone="amber" /> : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SentenceActionIcon
            icon="play-outline"
            color={theme.textSecondary}
            backgroundColor={theme.secondaryCardBackground}
            borderColor={theme.border}
            onPress={onSelect}
            size={32}
            iconSize={16}
          />
          {isLoggedIn ? (
            <>
              <SentenceActionIcon
                icon={isFav ? 'heart' : 'heart-outline'}
                color={isFav ? COLOR_RED : theme.textSecondary}
                backgroundColor={isFav ? 'rgba(255,59,48,0.10)' : theme.secondaryCardBackground}
                borderColor={isFav ? undefined : theme.border}
                onPress={onToggleFavorite}
                disabled={isToggling}
                size={32}
                iconSize={16}
              />
              <SentenceActionIcon
                icon={hasExistingNote ? 'create' : 'create-outline'}
                color={hasExistingNote ? TEXT_ON_DARK : theme.textSecondary}
                backgroundColor={hasExistingNote ? BG_HERO : theme.secondaryCardBackground}
                borderColor={hasExistingNote ? undefined : theme.border}
                onPress={onOpenNote}
                size={32}
                iconSize={16}
              />
            </>
          ) : null}
        </View>
      </View>

      {noteVisible ? (
        <View style={{ marginTop: 14, gap: 8 }}>
          <TextInput
            value={noteInput}
            onChangeText={onChangeNote}
            placeholder="写下你的笔记..."
            placeholderTextColor={theme.textSecondary}
            multiline
            style={{
              minHeight: 88,
              borderRadius: RADIUS_CARD,
              backgroundColor: theme.cardBackground,
              borderWidth: 0.5,
              borderColor: theme.border,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: theme.textPrimary,
              fontSize: FONT_BODY,
              lineHeight: 22,
              textAlignVertical: 'top',
            }}
          />
          {noteError ? <AppText style={{ fontSize: FONT_CAPTION, color: COLOR_RED }}>{noteError}</AppText> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <ActionButton
              label={noteSubmitting ? '保存中…' : '保存'}
              variant="dark"
              onPress={onSubmitNote}
              disabled={noteSubmitting || !noteInput.trim()}
            />
            <ActionButton label="取消" variant="primary" onPress={onCancelNote} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function TabletTranscriptRow({
  sentence,
  index,
  showEnglish,
  showChinese,
  subtitleFontSize,
  isLoggedIn,
  isFav,
  isToggling,
  hasExistingNote,
  onSelect,
  onToggleFavorite,
  onOpenNote,
  onLayout,
  onWordPress,
}: {
  sentence: Sentence;
  index: number;
  showEnglish: boolean;
  showChinese: boolean;
  subtitleFontSize: number;
  isLoggedIn: boolean;
  isFav: boolean;
  isToggling: boolean;
  hasExistingNote: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onOpenNote: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onWordPress?: (word: string, sentence: Sentence) => void;
}) {
  const { theme } = useAppTheme();
  const chineseIsPrimary = !showEnglish && showChinese;

  return (
    <Pressable
      onPress={onSelect}
      onLayout={onLayout}
      style={({ pressed }) => ({
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.separator,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ minWidth: 0 }}>
        {showEnglish ? (
          <HighlightedEnglish
            sentence={sentence}
            fontSize={Math.max(subtitleFontSize + 1, 17)}
            lineHeight={Math.max(subtitleFontSize + 12, 28)}
            fontWeight="600"
            color={theme.textPrimary}
            onWordPress={onWordPress}
          />
        ) : null}
        {showChinese ? (
          <AppText
            style={{
              marginTop: showEnglish ? 10 : 0,
              fontSize: Math.max(subtitleFontSize - 2, 14),
              lineHeight: Math.max(subtitleFontSize + 6, 22),
              fontWeight: chineseIsPrimary ? '500' : undefined,
              color: chineseIsPrimary ? theme.textPrimary : theme.textSecondary,
            }}
          >
            {sentence.zh}
          </AppText>
        ) : null}
      </View>

      <View
        style={{
          marginTop: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <AppText style={{ fontSize: 12, lineHeight: 15, fontWeight: '700', color: theme.textTertiary }}>
            {index + 1}
          </AppText>
          <AppText style={{ fontSize: 12, lineHeight: 15, color: theme.textSecondary }}>
            {formatSeconds(sentence.start)} - {formatSeconds(sentence.end)}
          </AppText>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SentenceActionIcon
            icon="play-outline"
            color={theme.textSecondary}
            backgroundColor="transparent"
            borderColor={theme.border}
            onPress={onSelect}
            size={30}
            iconSize={15}
          />
          {isLoggedIn ? (
            <>
              <SentenceActionIcon
                icon={isFav ? 'heart' : 'heart-outline'}
                color={isFav ? COLOR_RED : theme.textSecondary}
                backgroundColor="transparent"
                borderColor={theme.border}
                onPress={onToggleFavorite}
                disabled={isToggling}
                size={30}
                iconSize={15}
              />
              <SentenceActionIcon
                icon={hasExistingNote ? 'create' : 'create-outline'}
                color={theme.textSecondary}
                backgroundColor="transparent"
                borderColor={theme.border}
                onPress={onOpenNote}
                size={30}
                iconSize={15}
              />
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function TabletTranscriptSentenceCard({
  isFocused,
  noteVisible,
  noteInput,
  noteSubmitting,
  noteError,
  onChangeNote,
  onSubmitNote,
  onCancelNote,
  ...props
}: {
  sentence: Sentence;
  index: number;
  isFocused: boolean;
  isPlaying: boolean;
  showEnglish: boolean;
  showChinese: boolean;
  subtitleFontSize: number;
  isLoggedIn: boolean;
  isFav: boolean;
  isToggling: boolean;
  hasExistingNote: boolean;
  noteVisible: boolean;
  noteInput: string;
  noteSubmitting: boolean;
  noteError: string | null;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onOpenNote: () => void;
  onChangeNote: (value: string) => void;
  onSubmitNote: () => void;
  onCancelNote: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onWordPress?: (word: string, sentence: Sentence) => void;
}) {
  if (!isFocused) {
    return (
      <TabletTranscriptRow
        sentence={props.sentence}
        index={props.index}
        showEnglish={props.showEnglish}
        showChinese={props.showChinese}
        subtitleFontSize={props.subtitleFontSize}
        isLoggedIn={props.isLoggedIn}
        isFav={props.isFav}
        isToggling={props.isToggling}
        hasExistingNote={props.hasExistingNote}
        onSelect={props.onSelect}
        onToggleFavorite={props.onToggleFavorite}
        onOpenNote={props.onOpenNote}
        onLayout={props.onLayout}
        onWordPress={props.onWordPress}
      />
    );
  }

  return (
    <TabletActiveSentenceCard
      {...props}
      noteVisible={noteVisible}
      noteInput={noteInput}
      noteSubmitting={noteSubmitting}
      noteError={noteError}
      onChangeNote={onChangeNote}
      onSubmitNote={onSubmitNote}
      onCancelNote={onCancelNote}
    />
  );
}

function TabletStudySentenceCard({
  sentence,
  showEnglish,
  showChinese,
  showPhonetic,
  subtitleFontSize,
  onWordPress,
}: {
  sentence: Sentence | null;
  showEnglish: boolean;
  showChinese: boolean;
  showPhonetic: boolean;
  subtitleFontSize: number;
  onWordPress?: (word: string, sentence: Sentence) => void;
}) {
  const { theme } = useAppTheme();
  const chineseIsPrimary = !showEnglish && showChinese;

  if (!sentence) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 36,
          paddingVertical: 28,
        }}
      >
        <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary, textAlign: 'center' }}>
          完成加载后，这里会展示当前句学习卡片。
        </AppText>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 36,
        paddingVertical: 28,
      }}
    >
      <View style={{ alignItems: 'center' }}>
        {showEnglish ? (
          <HighlightedEnglish
            sentence={sentence}
            fontSize={Math.max(subtitleFontSize + 5, 21)}
            lineHeight={Math.max(subtitleFontSize + 14, 32)}
            fontWeight="700"
            color={theme.textPrimary}
            onWordPress={onWordPress}
            centered
          />
        ) : null}

        {showPhonetic && sentence.phonetic ? (
          <AppText
            style={{
              textAlign: 'center',
              marginTop: showEnglish ? 8 : 0,
              fontSize: 14,
              lineHeight: 20,
              fontStyle: 'italic',
              color: theme.textSecondary,
            }}
          >
            {sentence.phonetic}
          </AppText>
        ) : null}

        {showChinese ? (
          <AppText
            style={{
              textAlign: 'center',
              marginTop: showEnglish ? 14 : 0,
              fontSize: Math.max(subtitleFontSize, 15),
              lineHeight: Math.max(subtitleFontSize + 8, 24),
              fontWeight: chineseIsPrimary ? '500' : undefined,
              color: chineseIsPrimary ? theme.textPrimary : theme.textSecondary,
            }}
          >
            {sentence.zh}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const MemoSentenceListRow = React.memo(SentenceListRow, (prev, next) => {
  // Always re-render when focus state changes.
  if (prev.isFocused !== next.isFocused) return false;
  // Inactive rows: only re-render on display-setting changes.
  if (!next.isFocused) {
    return (
      prev.sentence         === next.sentence &&
      prev.index            === next.index &&
      prev.showEnglish      === next.showEnglish &&
      prev.showChinese      === next.showChinese &&
      prev.subtitleFontSize === next.subtitleFontSize &&
      prev.isFav            === next.isFav &&
      prev.onLayout         === next.onLayout &&
      prev.onSelect         === next.onSelect &&
      prev.onNormalRowHeight === next.onNormalRowHeight &&
      prev.onWordPress       === next.onWordPress
    );
  }
  // Focused rows: compare all focus-card props.
  return (
    prev.sentence         === next.sentence &&
    prev.index            === next.index &&
    prev.showEnglish      === next.showEnglish &&
    prev.showChinese      === next.showChinese &&
    prev.subtitleFontSize === next.subtitleFontSize &&
    prev.isPlaying        === next.isPlaying &&
    prev.loopActive       === next.loopActive &&
    prev.isLoggedIn       === next.isLoggedIn &&
    prev.isFav            === next.isFav &&
    prev.isToggling       === next.isToggling &&
    prev.existingNote     === next.existingNote &&
    prev.noteVisible      === next.noteVisible &&
    prev.noteInput        === next.noteInput &&
    prev.noteSubmitting   === next.noteSubmitting &&
    prev.noteError        === next.noteError &&
    prev.onLayout         === next.onLayout &&
    prev.onSelect         === next.onSelect &&
    prev.onToggleLoop     === next.onToggleLoop &&
    prev.onToggleFavorite === next.onToggleFavorite &&
    prev.onOpenNote       === next.onOpenNote &&
    prev.onChangeNote     === next.onChangeNote &&
    prev.onSubmitNote     === next.onSubmitNote &&
    prev.onCancelNote     === next.onCancelNote &&
    prev.onNormalRowHeight === next.onNormalRowHeight &&
    prev.onWordPress      === next.onWordPress
  );
});

function SettingsQuickAction({
  icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 7,
        paddingVertical: 8,
        opacity: disabled ? 0.36 : pressed ? 0.62 : 1,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? theme.primaryBlue : theme.secondaryCardBackground,
          borderWidth: active ? 0 : 0.5,
          borderColor: active ? undefined : theme.border,
        }}
      >
        <Ionicons name={icon} size={21} color={active ? TEXT_ON_DARK : theme.textPrimary} />
      </View>
      <AppText
        numberOfLines={1}
        style={{
          fontSize: 11,
          lineHeight: 13,
          fontWeight: active ? '700' : '600',
          color: active ? theme.primaryBlue : theme.textSecondary,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function SettingsSwitch({ active, onPress }: { active: boolean; onPress: () => void }) {
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
        backgroundColor: active ? theme.primaryBlue : theme.colorScheme === 'dark' ? 'rgba(120,120,128,0.32)' : BG_CARD_SOFT,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.92)' : BG_CARD }} />
    </Pressable>
  );
}

function SettingsRow({
  icon,
  label,
  right,
}: {
  icon: string;
  label: string;
  right: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        minHeight: 54,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.separator,
      }}
    >
      <AppText style={{ width: 24, textAlign: 'center', fontSize: 17, lineHeight: 20, color: theme.textTertiary }}>
        {icon}
      </AppText>
      <AppText style={{ flex: 1, fontSize: 15, lineHeight: 20, color: theme.textPrimary }}>
        {label}
      </AppText>
      {right}
    </View>
  );
}

function SubtitleSizeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const { theme } = useAppTheme();
  const sizes = [14, 15, 16, 17, 18, 19, 20];

  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: theme.separator }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <AppText style={{ width: 24, textAlign: 'center', fontSize: 17, fontWeight: '700', color: theme.textTertiary }}>
          Tt
        </AppText>
        <AppText style={{ flex: 1, fontSize: 15, lineHeight: 20, color: theme.textPrimary }}>
          字幕大小
        </AppText>
        <AppText style={{ fontSize: 13, lineHeight: 16, fontWeight: '700', color: theme.primaryBlue }}>
          {value}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {sizes.map((size) => {
          const selected = size === value;
          return (
            <Pressable
              key={size}
              onPress={() => onChange(size)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 30,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? theme.primaryBlue : theme.secondaryCardBackground,
                opacity: pressed ? 0.68 : 1,
              })}
            >
              <AppText
                style={{
                  fontSize: 11,
                  lineHeight: 13,
                  fontWeight: '700',
                  color: selected ? TEXT_ON_DARK : theme.textTertiary,
                }}
              >
                {size}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function EpisodeSettingsSheet({
  variant = 'phone',
  visible,
  insetsBottom,
  subtitleFontSize,
  loopActive,
  singlePause,
  phoneticsOn,
  subtitlesHidden,
  activeSentenceFavorited,
  canFavorite,
  onClose,
  onChangeSubtitleFontSize,
  onToggleLoop,
  onToggleSinglePause,
  onTogglePhonetics,
  onToggleSubtitles,
  onToggleFavorite,
  onOpenCards,
  onOpenBilingual,
}: {
  variant?: 'phone' | 'tablet';
  visible: boolean;
  insetsBottom: number;
  subtitleFontSize: number;
  loopActive: boolean;
  singlePause: boolean;
  phoneticsOn: boolean;
  subtitlesHidden: boolean;
  activeSentenceFavorited: boolean;
  canFavorite: boolean;
  onClose: () => void;
  onChangeSubtitleFontSize: (value: number) => void;
  onToggleLoop: () => void;
  onToggleSinglePause: () => void;
  onTogglePhonetics: () => void;
  onToggleSubtitles: () => void;
  onToggleFavorite: () => void;
  onOpenCards: () => void;
  onOpenBilingual: () => void;
}) {
  const { theme } = useAppTheme();
  const isTabletVariant = variant === 'tablet';
  const screenH = Dimensions.get('window').height;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: isTabletVariant ? 'center' : 'flex-end',
          alignItems: isTabletVariant ? 'center' : 'stretch',
          padding: isTabletVariant ? 24 : 0,
        }}
      >
        <Pressable
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: isTabletVariant
              ? 'rgba(0,0,0,0.32)'
              : BG_OVERLAY,
          }}
        />
        <View
          style={
            isTabletVariant
              ? {
                  width: '100%',
                  maxWidth: 560,
                  maxHeight: Math.min(screenH * 0.78, 720),
                  borderRadius: 26,
                  overflow: 'hidden',
                  backgroundColor: theme.elevatedCardBackground,
                  borderWidth: 0.5,
                  borderColor: theme.border,
                  shadowColor: theme.shadowColor,
                  shadowOpacity: 0.18,
                  shadowRadius: 28,
                  shadowOffset: { width: 0, height: 16 },
                  elevation: 8,
                }
              : {
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 24,
                  backgroundColor: theme.elevatedCardBackground,
                  paddingBottom: Math.max(insetsBottom, 16),
                  borderTopWidth: 0.5,
                  borderTopColor: theme.separator,
                }
          }
        >
          {!isTabletVariant ? (
            <View
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.25)' : 'rgba(60,60,67,0.18)',
                marginTop: 12,
                marginBottom: 4,
              }}
            />
          ) : null}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              position: 'absolute',
              top: isTabletVariant ? 16 : 14,
              right: isTabletVariant ? 18 : 16,
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.secondaryCardBackground,
              zIndex: 5,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Ionicons name="close" size={16} color={theme.textTertiary} />
          </Pressable>

          <View
            style={{
              paddingHorizontal: isTabletVariant ? 22 : 20,
              paddingTop: isTabletVariant ? 18 : 6,
              paddingBottom: 8,
            }}
          >
            <AppText style={{ fontSize: 17, lineHeight: 22, fontWeight: '700', color: theme.textPrimary }}>
              设置
            </AppText>
          </View>

          <ScrollView
            style={{ maxHeight: '100%' }}
            contentContainerStyle={{
              paddingBottom: isTabletVariant ? 16 : Math.max(insetsBottom, 16),
            }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                flexDirection: 'row',
                paddingHorizontal: isTabletVariant ? 14 : 8,
                paddingTop: 4,
                paddingBottom: 14,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.separator,
              }}
            >
              <SettingsQuickAction icon="albums-outline" label="词卡" onPress={onOpenCards} />
              <SettingsQuickAction
                icon={activeSentenceFavorited ? 'bookmark' : 'bookmark-outline'}
                label={activeSentenceFavorited ? '已收藏' : '收藏'}
                active={activeSentenceFavorited}
                disabled={!canFavorite}
                onPress={onToggleFavorite}
              />
              <SettingsQuickAction icon="eye-off-outline" label="隐藏字幕" active={subtitlesHidden} onPress={onToggleSubtitles} />
              <SettingsQuickAction icon="text-outline" label="双语" onPress={onOpenBilingual} />
            </View>

            <SubtitleSizeControl value={subtitleFontSize} onChange={onChangeSubtitleFontSize} />

            <SettingsRow icon="↻" label="句子循环" right={<SettingsSwitch active={loopActive} onPress={onToggleLoop} />} />
            <SettingsRow icon="⏸" label="播放完当前句暂停" right={<SettingsSwitch active={singlePause} onPress={onToggleSinglePause} />} />
            <SettingsRow icon="Æ" label="显示音标" right={<SettingsSwitch active={phoneticsOn} onPress={onTogglePhonetics} />} />
            <SettingsRow icon="⊙" label="隐藏动态字幕" right={<SettingsSwitch active={subtitlesHidden} onPress={onToggleSubtitles} />} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function EpisodeScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { id, sentence } = useLocalSearchParams<{ id: string; sentence?: string }>();
  const episodeId = Array.isArray(id) ? id[0] : id;
  const targetSentenceParam = Array.isArray(sentence) ? sentence[0] : sentence;
  const targetSentenceId = targetSentenceParam ? Number(targetSentenceParam) : null;
  const { snapshot, loading, error } = useEpisodeDetailData(episodeId);
  const session = useAppSession();
  const {
    guardEntry,
    status: entitlementStatus,
    mobileMe,
    error: entitlementError,
  } = useEntitlementGuard();
  const { shouldUseTabletLayout: liveShouldUseTabletLayout } = useDeviceClass();
  // Lock the layout decision so frame 1 of this screen ALREADY commits to the
  // iPad branch on iPad. Otherwise `useWindowDimensions()` can settle one
  // frame late during navigation transitions and render the heavy phone JSX
  // briefly before flipping to the tablet layout — the user perceives this as
  // "iPad layout suddenly snapping in".
  //
  // We anchor on THREE signals (any one is sufficient):
  //   1. Native `Platform.isPad` — true on every iPad regardless of window
  //      width (handles split-view, transitions, first-frame races).
  //   2. Synchronous `Dimensions.get('window').width >= 900` — current app
  //      window already meets the tablet-layout threshold.
  //   3. Module-level cache `__tabletWidthSeen` — set the first time any
  //      EpisodeScreen mount observes a tablet-wide window; subsequent mounts
  //      treat the device as tablet from frame 1.
  const initialTabletLockRef = useRef<boolean>(
    Platform.OS === 'ios' && (Platform as unknown as { isPad?: boolean }).isPad === true
      ? true
      : Dimensions.get('window').width >= TABLET_LAYOUT_BREAKPOINT
        ? true
        : __episodeTabletWidthSeen,
  );
  // Once we've ever observed tablet width during this app session, remember.
  if (initialTabletLockRef.current || liveShouldUseTabletLayout) {
    __episodeTabletWidthSeen = true;
  }
  const shouldUseTabletLayout =
    initialTabletLockRef.current || liveShouldUseTabletLayout;
  const floatingInsets = useFloatingTabInsets();
  const isLoggedIn = session.status === 'authenticated';

  const [mode, setMode] = useState<TranscriptMode>('english');
  const [selectedMode, setSelectedMode] = useState<TranscriptMode>('english');
  const [loopActive, setLoopActive] = useState(false);
  const [singlePause, setSinglePause] = useState(false);
  const [intervalDelay, setIntervalDelay] = useState(0);
  const [subtitlesHidden, setSubtitlesHidden] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [subtitleFontSize, setSubtitleFontSize] = useState(16);
  const [phoneticsOn, setPhoneticsOn] = useState(false);
  const [showVideo, setShowVideo] = useState(true);

  // Per-sentence recording (real link via expo-audio).
  const tabletRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const tabletRecorderState = useAudioRecorderState(tabletRecorder, 250);
  const [recordingSentenceId, setRecordingSentenceId] = useState<number | null>(null);
  const [recordings, setRecordings] = useState<Record<number, { uri: string }>>({});
  const [playingRecordingSentenceId, setPlayingRecordingSentenceId] = useState<number | null>(null);
  const [recordingPermissionDenied, setRecordingPermissionDenied] = useState(false);
  const recordingPlayerRef = useRef<AudioPlayer | null>(null);
  const [dictationInput, setDictationInput] = useState('');
  const [dictationSubmitted, setDictationSubmitted] = useState(false);
  const [dictationShowAnswer, setDictationShowAnswer] = useState(false);
  const [revealedClozeSentenceIds, setRevealedClozeSentenceIds] = useState<Set<number>>(new Set());
  const [revealedClozeKeys, setRevealedClozeKeys] = useState<Set<string>>(new Set());
  const [favoritedIds, setFavoritedIds] = useState<Set<number>>(new Set());
  const [togglingFavId, setTogglingFavId] = useState<number | null>(null);
  const [noteVisible, setNoteVisible] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [existingNote, setExistingNote] = useState<string | null>(null);
  const [existingNoteId, setExistingNoteId] = useState<string | null>(null);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [premiumActionPending, setPremiumActionPending] = useState(false);
  const [deferredRowsReady, setDeferredRowsReady] = useState(true);
  // Word dictionary popup — opened by tapping a highlighted phrase. We
  // capture BOTH the word AND the source sentence at tap-time, so the popup's
  // "current example" stays locked to that sentence even as playback advances
  // to other sentences.
  const [dictContext, setDictContext] = useState<{ word: string; sentence: Sentence } | null>(null);

  const subtitleScrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const isUserInteractingRef = useRef(false);
  const rowLayoutMapRef = useRef<Map<number, RowLayout>>(new Map());
  const lastAutoVisibleSentenceIdRef = useRef<number | null>(null);
  const autoScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollInteractionRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
  const appliedRouteSentenceRef = useRef<string | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const learningSyncRef = useRef<{
    activeKey: string | null;
    completedKeys: Set<string>;
    lastRequestAt: number;
  }>({
    activeKey: null,
    completedKeys: new Set<string>(),
    lastRequestAt: 0,
  });
  const sentenceEndHandledRef = useRef<{
    sentenceId: number | null;
    mode: 'none' | 'loop' | 'pause' | 'interval';
    timestamp: number;
  }>({ sentenceId: null, mode: 'none', timestamp: 0 });
  // Single source of truth — which sentence shows the focus card.
  // Updated immediately when active sentence changes; no pending/resolved split.
  const [focusedSentenceId, setFocusedSentenceId] = useState<number | null>(null);
  const normalRowHeightsRef = useRef<Map<number, number>>(new Map());
  const modeRequestIdRef = useRef(0);
  const committedModeRef = useRef<TranscriptMode>('english');
  const modePerfRef = useRef<{
    mode: TranscriptMode;
    startedAt: number;
    sentenceCount: number;
    requestId: number;
  } | null>(null);

  const episode = snapshot?.episode;
  const sentences = snapshot?.sentences ?? [];
  const phraseCards = snapshot?.phraseCards ?? [];

  const player = useEpisodePlayerController({
    videoSrc: snapshot?.videoSrc ?? '',
    title: episode?.title ?? '',
    artwork: episode?.cover,
    durationLabel: episode?.duration ?? '00:00',
    sentences,
  });

  useEffect(() => {
    committedModeRef.current = mode;
    setSelectedMode(mode);
  }, [mode]);

  const activeSentenceId = player.isPlaybackPositionReady ? player.currentSentenceId : null;
  const activeSentence = useMemo(
    () => sentences.find((sentence) => sentence.id === activeSentenceId) ?? null,
    [activeSentenceId, sentences],
  );
  const activeSentenceIndex = useMemo(
    () => (activeSentence ? sentences.findIndex((sentence) => sentence.id === activeSentence.id) : -1),
    [activeSentence, sentences],
  );
  const focusedSentenceIndex = useMemo(
    () => (focusedSentenceId != null ? sentences.findIndex((sentence) => sentence.id === focusedSentenceId) : -1),
    [focusedSentenceId, sentences],
  );
  const renderAnchorIndex = activeSentenceIndex >= 0 ? activeSentenceIndex : focusedSentenceIndex >= 0 ? focusedSentenceIndex : 0;
  const shouldWindowModeRows =
    !deferredRowsReady &&
    sentences.length > MODE_FIRST_PAINT_WINDOW_THRESHOLD &&
    (mode === 'bilingual' || mode === 'english' || mode === 'chinese' || mode === 'cloze');
  const sentenceRenderWindow = useMemo(
    () => buildSentenceRenderRows(sentences, renderAnchorIndex, shouldWindowModeRows),
    [renderAnchorIndex, sentences, shouldWindowModeRows],
  );

  useEffect(() => {
    const perf = modePerfRef.current;
    if (perf && perf.mode === mode) {
      requestAnimationFrame(() => {
        logEpisodeModePerf('episode_mode_first_paint_ready', {
          mode,
          sentenceCount: sentences.length,
          elapsedMs: Date.now() - perf.startedAt,
          platform: Platform.OS,
          isTablet: shouldUseTabletLayout,
          initialRows: sentenceRenderWindow.rows.length,
          windowed: sentenceRenderWindow.windowed,
        });
      });
    }

    if (deferredRowsReady) return undefined;

    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        setDeferredRowsReady(true);
        const latest = modePerfRef.current;
        if (latest?.mode === mode) {
          logEpisodeModePerf('episode_mode_deferred_work_done', {
            mode,
            sentenceCount: sentences.length,
            elapsedMs: Date.now() - latest.startedAt,
            platform: Platform.OS,
            isTablet: shouldUseTabletLayout,
          });
        }
      });
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, [
    deferredRowsReady,
    mode,
    sentenceRenderWindow.rows.length,
    sentenceRenderWindow.windowed,
    sentences.length,
    shouldUseTabletLayout,
  ]);
  // Follow the active sentence immediately — no pending/resolved split.
  //
  // CRITICAL: Scroll and LayoutAnimation must start in the SAME frame, otherwise
  // the focus card is rendered far below the viewport during the height-growth
  // animation while scroll lags behind. We use useLayoutEffect (synchronous,
  // pre-paint) and call scrollTo BEFORE configureNext + setState, so on the
  // next paint the focus card lands at its target viewport position with both
  // animations running in parallel — no visible "card disappeared" gap.
  //
  // We do NOT rely on a delayed setTimeout/InteractionManager scroll: that
  // chain caused the 300-500ms window where the active sentence was off-screen.
  useLayoutEffect(() => {
    if (!deferredRowsReady) return;
    if (mode === 'dictation' || mode === 'cloze' || mode === 'cards') return;
    if (activeSentenceId == null) {
      if (sentences.length === 0) setFocusedSentenceId(null);
      return;
    }
    if (focusedSentenceId === activeSentenceId) return;

    // Pre-scroll so the new focused row's TOP sits ~80px from viewport top.
    // We use the row's CURRENT (compact) layout y; after LayoutAnimation
    // collapses the previously-focused row above, the row settles slightly
    // higher, but the active card stays comfortably in view either way.
    let scrolled = false;
    if (!isUserInteractingRef.current) {
      const layout = rowLayoutMapRef.current.get(activeSentenceId);
      const sv = subtitleScrollRef.current;
      const vh = viewportHeightRef.current;
      if (layout && sv && vh > 0) {
        const desiredTop = Math.max(64, Math.min(120, vh * 0.18));
        const targetY = Math.max(0, layout.y - desiredTop);
        if (Math.abs(targetY - scrollYRef.current) > 4) {
          sv.scrollTo({ y: targetY, animated: true });
          scrollYRef.current = targetY;
        }
        scrolled = true;
      }
    }

    LayoutAnimation.configureNext(FOCUS_LAYOUT_ANIM);
    setFocusedSentenceId(activeSentenceId);
    if (scrolled) lastAutoVisibleSentenceIdRef.current = activeSentenceId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSentenceId, deferredRowsReady, mode, sentences.length]);

  // Pin focus to the first sentence as soon as the list loads (before playback).
  useEffect(() => {
    if (sentences.length === 0) return;
    if (mode === 'dictation' || mode === 'cloze' || mode === 'cards') return;
    setFocusedSentenceId((prev) => prev ?? sentences[0].id);
  }, [sentences, mode]);

  // If the focused sentence is removed from the list, clear focus.
  useEffect(() => {
    if (focusedSentenceId == null) return;
    if (sentences.some((s) => s.id === focusedSentenceId)) return;
    setFocusedSentenceId(null);
  }, [focusedSentenceId, sentences]);

  useEffect(() => {
    if (!targetSentenceId || !Number.isFinite(targetSentenceId) || sentences.length === 0) {
      appliedRouteSentenceRef.current = null;
      return;
    }
    const routeKey = `${episodeId}:${targetSentenceId}`;
    if (appliedRouteSentenceRef.current === routeKey) return;
    if (!sentences.some((item) => item.id === targetSentenceId)) return;
    player.jumpToSentence(targetSentenceId);
    appliedRouteSentenceRef.current = routeKey;
  }, [episodeId, player, sentences, targetSentenceId]);

  useEffect(() => {
    if (!isLoggedIn || !session.session || sentences.length === 0) return;
    const sentenceIdSet = new Set(sentences.map((s) => s.id));
    fetchUserFavorites(session.session, 'sentence')
      .then((items) => {
        const ids = new Set<number>();
        for (const item of items) {
          const parsed = Number(item.target_id);
          if (!Number.isNaN(parsed) && sentenceIdSet.has(parsed)) ids.add(parsed);
        }
        setFavoritedIds(ids);
      })
      .catch(() => undefined);
  }, [isLoggedIn, session.session, sentences]);

  useEffect(() => {
    setNoteVisible(false);
    setNoteInput('');
    setExistingNote(null);
    setExistingNoteId(null);
    setNoteError(null);
  }, [activeSentenceId]);

  useEffect(() => {
    setDictationInput('');
    setDictationSubmitted(false);
    setDictationShowAnswer(false);
    setRevealedClozeSentenceIds(new Set());
    setRevealedClozeKeys(new Set());
  }, [activeSentenceId]);

  const runPremiumAction = useCallback(
    async (action: () => Promise<void> | void) => {
      if (premiumActionPending) return false;
      setPremiumActionPending(true);
      try {
        const ok = await guardEntry('premium_library');
        if (!ok) return false;
        await action();
        return true;
      } finally {
        setPremiumActionPending(false);
      }
    },
    [guardEntry, premiumActionPending],
  );

  const getCachedPremiumDecision = useCallback((): 'allowed' | 'blocked' | 'unknown' => {
    if (session.status !== 'authenticated') return 'blocked';
    if (mobileMe) {
      return mobileMe.entitlements.isActivated ? 'allowed' : 'blocked';
    }
    if (entitlementStatus === 'no_session') return 'blocked';
    if (entitlementStatus === 'ready' && !entitlementError) return 'blocked';
    return 'unknown';
  }, [entitlementError, entitlementStatus, mobileMe, session.status]);

  const commitModeAfterPaint = useCallback((next: TranscriptMode, requestId: number) => {
    requestAnimationFrame(() => {
      if (modeRequestIdRef.current !== requestId) return;
      setDeferredRowsReady(false);
      setMode(next);
      setShowSettingsSheet(false);
      logEpisodeModePerf('episode_mode_content_applied', {
        mode: next,
        sentenceCount: sentences.length,
        elapsedMs: modePerfRef.current?.requestId === requestId ? Date.now() - modePerfRef.current.startedAt : 0,
        platform: Platform.OS,
        isTablet: shouldUseTabletLayout,
      });
    });
  }, [sentences.length, shouldUseTabletLayout]);

  const handleModeChange = useCallback(
    (next: TranscriptMode) => {
      const requestId = modeRequestIdRef.current + 1;
      modeRequestIdRef.current = requestId;
      const startedAt = Date.now();
      modePerfRef.current = {
        mode: next,
        startedAt,
        sentenceCount: sentences.length,
        requestId,
      };
      logEpisodeModePerf('episode_mode_tab_press', {
        mode: next,
        sentenceCount: sentences.length,
        platform: Platform.OS,
        isTablet: shouldUseTabletLayout,
      });
      setSelectedMode(next);
      logEpisodeModePerf('episode_mode_selected_applied', {
        mode: next,
        sentenceCount: sentences.length,
        elapsedMs: Date.now() - startedAt,
        platform: Platform.OS,
        isTablet: shouldUseTabletLayout,
      });

      if (next === 'english') {
        commitModeAfterPaint(next, requestId);
        return;
      }

      const cachedDecision = getCachedPremiumDecision();
      if (cachedDecision === 'allowed') {
        commitModeAfterPaint(next, requestId);
        return;
      }

      if (cachedDecision === 'blocked') {
        requestAnimationFrame(() => {
          if (modeRequestIdRef.current !== requestId) return;
          setSelectedMode(committedModeRef.current);
          void guardEntry('premium_library');
        });
        return;
      }

      void (async () => {
        const ok = await guardEntry('premium_library');
        if (modeRequestIdRef.current !== requestId) return;
        if (ok) {
          commitModeAfterPaint(next, requestId);
          return;
        }
        setSelectedMode(committedModeRef.current);
      })();
    },
    [commitModeAfterPaint, getCachedPremiumDecision, guardEntry, sentences.length, shouldUseTabletLayout],
  );

  const loadSentenceNote = useCallback(
    async (sentenceId: number) => {
      if (!session.session) return;
      try {
        const notes = await fetchNotesForSentence(session.session as NonNullable<typeof session.session>, sentenceId);
        const first = notes[0];
        if (first) {
          setExistingNote(first.note);
          setExistingNoteId(first.id);
          setNoteInput(first.note);
          return;
        }
        setExistingNote(null);
        setExistingNoteId(null);
        setNoteInput('');
      } catch {
        return;
      }
    },
    [session.session],
  );

  const handleOpenNote = useCallback(async () => {
    if (!session.session || activeSentenceId == null) return;
    await runPremiumAction(async () => {
      setNoteVisible(true);
      await loadSentenceNote(activeSentenceId);
    });
  }, [activeSentenceId, loadSentenceNote, runPremiumAction, session.session]);

  const handleSubmitNote = useCallback(async () => {
    if (!session.session || activeSentenceId == null || !episodeId || !noteInput.trim()) return;
    setNoteSubmitting(true);
    setNoteError(null);
    try {
      if (existingNoteId) {
        await updateNote(session.session, existingNoteId, noteInput.trim());
      } else {
        const created = await addNote(session.session, activeSentenceId, episodeId, noteInput.trim());
        setExistingNoteId(created.id);
      }
      setExistingNote(noteInput.trim());
      setNoteVisible(false);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setNoteSubmitting(false);
    }
  }, [session.session, activeSentenceId, episodeId, noteInput, existingNoteId]);

  const handleToggleFavorite = useCallback(async (sentenceId: number) => {
    if (!session.session) return;
    await runPremiumAction(async () => {
      setTogglingFavId(sentenceId);
      const isFav = favoritedIds.has(sentenceId);
      try {
        if (isFav) {
          await removeFavoriteByTarget(session.session as NonNullable<typeof session.session>, 'sentence', String(sentenceId));
          setFavoritedIds((prev) => {
            const next = new Set(prev);
            next.delete(sentenceId);
            return next;
          });
        } else {
          await addFavorite(session.session as NonNullable<typeof session.session>, 'sentence', String(sentenceId));
          setFavoritedIds((prev) => new Set(prev).add(sentenceId));
        }
      } finally {
        setTogglingFavId(null);
      }
    });
  }, [favoritedIds, runPremiumAction, session.session]);

  const loopSentenceRef = useRef<Sentence | null>(null);
  useEffect(() => {
    if (loopActive && activeSentenceId != null) {
      loopSentenceRef.current = sentences.find((s) => s.id === activeSentenceId) ?? null;
    }
  }, [activeSentenceId, loopActive, sentences]);

  useEffect(() => {
    return () => {
      if (intervalTimerRef.current) {
        clearTimeout(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }
      if (autoScrollTimeoutRef.current) {
        clearTimeout(autoScrollTimeoutRef.current);
        autoScrollTimeoutRef.current = null;
      }
      if (autoScrollInteractionRef.current) {
        autoScrollInteractionRef.current.cancel();
        autoScrollInteractionRef.current = null;
      }
    };
  }, [episodeId]);

  const cancelPendingAutoScroll = useCallback(() => {
    if (autoScrollTimeoutRef.current) {
      clearTimeout(autoScrollTimeoutRef.current);
      autoScrollTimeoutRef.current = null;
    }
    if (autoScrollInteractionRef.current) {
      autoScrollInteractionRef.current.cancel();
      autoScrollInteractionRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!player.isPlaying) return;
    const currentSentence = loopActive
      ? loopSentenceRef.current
      : sentences.find((s) => s.id === activeSentenceId) ?? null;
    if (!currentSentence || player.currentTime < currentSentence.end - 0.1) return;

    const now = Date.now();
    const actionMode: 'none' | 'loop' | 'pause' | 'interval' = loopActive
      ? 'loop'
      : singlePause
        ? 'pause'
        : intervalDelay > 0
          ? 'interval'
          : 'none';
    const handled = sentenceEndHandledRef.current;
    if (
      handled.sentenceId === currentSentence.id &&
      handled.mode === actionMode &&
      now - handled.timestamp < 500
    ) {
      return;
    }

    if (loopActive) {
      player.handleSeek(currentSentence.start);
      player.play();
      sentenceEndHandledRef.current = { sentenceId: currentSentence.id, mode: 'loop', timestamp: now };
      return;
    }

    if (singlePause) {
      player.pause();
      sentenceEndHandledRef.current = { sentenceId: currentSentence.id, mode: 'pause', timestamp: now };
      return;
    }

    if (intervalDelay > 0) {
      if (intervalTimerRef.current) return;
      player.pause();
      intervalTimerRef.current = setTimeout(() => {
        intervalTimerRef.current = null;
        const index = sentences.findIndex((s) => s.id === currentSentence.id);
        if (index >= 0 && index < sentences.length - 1) {
          player.jumpToNext();
          player.play();
        }
      }, intervalDelay * 1000);
      sentenceEndHandledRef.current = { sentenceId: currentSentence.id, mode: 'interval', timestamp: now };
    }
  }, [activeSentenceId, intervalDelay, loopActive, player, sentences, singlePause]);

  const syncLearningProgress = useCallback(
    async (status: 'learning' | 'reviewed', sentenceId: number, incrementReviewCount: boolean) => {
      if (!session.session || !episodeId) return;
      const now = Date.now();
      if (now - learningSyncRef.current.lastRequestAt < 800) {
        return;
      }
      learningSyncRef.current.lastRequestAt = now;
      try {
        await upsertLearningProgress(session.session, {
          episodeId,
          sentenceId,
          status,
          incrementReviewCount,
        });
      } catch (syncError) {
        console.warn('[episode][learning_progress] sync_failed', {
          episodeId,
          sentenceId,
          status,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    },
    [episodeId, session.session],
  );

  useEffect(() => {
    if (!isLoggedIn || !session.session || !episodeId || activeSentenceId == null) {
      return;
    }
    const key = `${episodeId}:${activeSentenceId}`;
    if (learningSyncRef.current.activeKey === key) {
      return;
    }
    learningSyncRef.current.activeKey = key;
    void syncLearningProgress('learning', activeSentenceId, false);
  }, [activeSentenceId, episodeId, isLoggedIn, session.session, syncLearningProgress]);

  useEffect(() => {
    if (!isLoggedIn || !session.session || !episodeId) return;
    const currentSentence = activeSentence;
    if (!currentSentence) return;
    if (player.currentTime < currentSentence.end - 0.12) return;

    const completionKey = `${episodeId}:${currentSentence.id}`;
    if (learningSyncRef.current.completedKeys.has(completionKey)) {
      return;
    }
    learningSyncRef.current.completedKeys.add(completionKey);
    void syncLearningProgress('reviewed', currentSentence.id, true);
  }, [activeSentence, episodeId, isLoggedIn, player.currentTime, session.session, syncLearningProgress]);

  const ensureVisible = useCallback((sentenceId: number, reason: 'manual' | 'auto') => {
    const layout = rowLayoutMapRef.current.get(sentenceId);
    const scrollView = subtitleScrollRef.current;
    const viewportHeight = viewportHeightRef.current;
    const scrollY = scrollYRef.current;
    if (!layout || !scrollView || viewportHeight <= 0) return null;
    if (reason === 'auto' && isUserInteractingRef.current) return false;
    const topInset = reason === 'manual' ? 72 : 96;
    const bottomInset = reason === 'manual' ? 108 : 144;
    const rowTop = layout.y;
    const rowBottom = layout.y + layout.height;
    const topLimit = scrollY + topInset;
    const bottomLimit = scrollY + viewportHeight - bottomInset;
    let targetY: number | null = null;
    if (rowTop < topLimit) targetY = Math.max(0, rowTop - topInset);
    else if (rowBottom > bottomLimit) targetY = Math.max(0, rowBottom - viewportHeight + bottomInset);
    if (targetY === null || Math.abs(targetY - scrollY) <= 4) return true;
    scrollYRef.current = targetY;
    scrollView.scrollTo({ y: targetY, animated: true });
    return true;
  }, []);

  // NOTE: Auto-scroll on active-sentence change is handled SYNCHRONOUSLY in the
  // useLayoutEffect above (pre-scroll before LayoutAnimation). The previous
  // delayed setTimeout(110) + InteractionManager + animated:true chain caused
  // a 300-500ms window where the focus card was rendered off-screen on 120Hz
  // devices. That delayed effect has been removed by design — do not restore it.
  //
  // This fallback effect only handles "safety net" re-syncs (e.g., if the user
  // was interacting during the focus change and we skipped the synchronous
  // scroll). It runs once after the LayoutAnimation has settled.
  // Safety net: only react to a *new* sentence id. A transient null flicker
  // (e.g. expo-video status blink during pause) must NOT reset our "last
  // scrolled" tracker — otherwise the next time the same id reappears we
  // re-run ensureVisible('auto') which, for early sentences whose layout.y
  // is small, clamps targetY to 0 and scrolls the list to the top.
  useEffect(() => {
    if (activeSentenceId == null) {
      cancelPendingAutoScroll();
      return;
    }
    if (lastAutoVisibleSentenceIdRef.current === activeSentenceId) return;
    cancelPendingAutoScroll();
    autoScrollTimeoutRef.current = setTimeout(() => {
      autoScrollTimeoutRef.current = null;
      const result = ensureVisible(activeSentenceId, 'auto');
      if (result === true) lastAutoVisibleSentenceIdRef.current = activeSentenceId;
      // result === null: layout not yet measured — keep the previous tracker so
      // we do not fire repeatedly. result === false: user is interacting; same.
    }, 260); // wait for LayoutAnimation (220ms) to settle, then verify
  }, [activeSentenceId, cancelPendingAutoScroll, ensureVisible]);

  const handleSelectSentence = useCallback((sentenceId: number) => {
    ensureVisible(sentenceId, 'manual');
    player.jumpToSentence(sentenceId);
  }, [ensureVisible, player]);

  const handleCopySentence = useCallback(
    (sentenceId: number) => {
      const target = sentences.find((item) => item.id === sentenceId);
      if (!target) return;
      const text = target.zh ? `${target.en}\n${target.zh}` : target.en;
      try {
        Clipboard.setString(text);
      } catch {
        // ignore — clipboard not available
      }
    },
    [sentences],
  );

  // Stop any in-progress recording-playback on cleanup.
  useEffect(() => {
    return () => {
      try {
        recordingPlayerRef.current?.remove();
      } catch {
        // ignore
      }
      recordingPlayerRef.current = null;
    };
  }, []);

  const stopRecordingPlayback = useCallback(() => {
    try {
      const p = recordingPlayerRef.current;
      if (p) {
        p.pause();
        p.remove();
      }
    } catch {
      // ignore
    }
    recordingPlayerRef.current = null;
    setPlayingRecordingSentenceId(null);
  }, []);

  const handleToggleRecording = useCallback(
    async (sentenceId: number) => {
      // Stop playback if running.
      stopRecordingPlayback();

      // Already recording → stop & save.
      if (recordingSentenceId === sentenceId) {
        try {
          await tabletRecorder.stop();
          const uri = tabletRecorder.uri;
          if (uri) {
            setRecordings((prev) => ({ ...prev, [sentenceId]: { uri } }));
          }
        } catch {
          // ignore
        } finally {
          setRecordingSentenceId(null);
        }
        return;
      }

      // Recording a different sentence → stop the previous one without saving the swap.
      if (recordingSentenceId != null) {
        try {
          await tabletRecorder.stop();
          const uri = tabletRecorder.uri;
          if (uri) {
            setRecordings((prev) => ({ ...prev, [recordingSentenceId]: { uri } }));
          }
        } catch {
          // ignore
        }
        setRecordingSentenceId(null);
      }

      // Permission gate (cached after first grant by the OS).
      try {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          setRecordingPermissionDenied(true);
          return;
        }
        setRecordingPermissionDenied(false);
      } catch {
        setRecordingPermissionDenied(true);
        return;
      }

      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        await tabletRecorder.prepareToRecordAsync();
        tabletRecorder.record();
        setRecordingSentenceId(sentenceId);
      } catch {
        setRecordingSentenceId(null);
      }
    },
    [recordingSentenceId, stopRecordingPlayback, tabletRecorder],
  );

  const handlePlayRecording = useCallback(
    (sentenceId: number) => {
      const item = recordings[sentenceId];
      if (!item) return;

      if (playingRecordingSentenceId === sentenceId) {
        stopRecordingPlayback();
        return;
      }

      // Stop any prior playback first.
      stopRecordingPlayback();
      try {
        const p = createAudioPlayer({ uri: item.uri });
        recordingPlayerRef.current = p;
        p.play();
        setPlayingRecordingSentenceId(sentenceId);
      } catch {
        // ignore
      }
    },
    [playingRecordingSentenceId, recordings, stopRecordingPlayback],
  );

  // Auto-clear playing flag if the recording finished naturally. We poll the
  // recorder-player state via a lightweight effect; expo-audio fires status
  // events but the simplest robust approach here is to clear when the
  // recorder-player reports ended. We use a minimal interval to avoid extra deps.
  useEffect(() => {
    if (playingRecordingSentenceId == null) return;
    const t = setInterval(() => {
      const p = recordingPlayerRef.current;
      if (!p) return;
      // `currentStatus` mirrors the latest status object on the SharedObject.
      const finished =
        (p as unknown as { didJustFinish?: boolean }).didJustFinish === true ||
        (!p.playing && !p.paused);
      if (finished) {
        stopRecordingPlayback();
      }
    }, 350);
    return () => clearInterval(t);
  }, [playingRecordingSentenceId, stopRecordingPlayback]);

  const handleOpenSentenceNote = useCallback(
    async (sentenceId: number) => {
      if (!session.session) return;
      await runPremiumAction(async () => {
        ensureVisible(sentenceId, 'manual');
        player.jumpToSentence(sentenceId);
        setNoteVisible(true);
        await loadSentenceNote(sentenceId);
      });
    },
    [ensureVisible, loadSentenceNote, player, runPremiumAction, session.session],
  );

  const handlePrev = useCallback(() => {
    if (activeSentenceId == null) return;
    const index = sentences.findIndex((s) => s.id === activeSentenceId);
    if (index > 0) ensureVisible(sentences[index - 1].id, 'manual');
    player.jumpToPrev();
  }, [activeSentenceId, ensureVisible, player, sentences]);

  const handleNext = useCallback(() => {
    if (activeSentenceId == null) return;
    const index = sentences.findIndex((s) => s.id === activeSentenceId);
    if (index >= 0 && index < sentences.length - 1) ensureVisible(sentences[index + 1].id, 'manual');
    player.jumpToNext();
  }, [activeSentenceId, ensureVisible, player, sentences]);

  const handleSubmitDictation = useCallback(() => {
    setDictationSubmitted(true);
  }, []);

  const handleRetryDictation = useCallback(() => {
    setDictationInput('');
    setDictationSubmitted(false);
    setDictationShowAnswer(false);
  }, []);

  const handleToggleClozeWord = useCallback((sentenceId: number, index: number) => {
    const key = `${sentenceId}-${index}`;
    setRevealedClozeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleToggleClozeAnswer = useCallback((sentenceId: number) => {
    setRevealedClozeSentenceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sentenceId)) next.delete(sentenceId);
      else next.add(sentenceId);
      return next;
    });
  }, []);

  const updateSentenceRowLayout = useCallback((sentenceId: number, event: LayoutChangeEvent) => {
    rowLayoutMapRef.current.set(sentenceId, {
      y: event.nativeEvent.layout.y,
      height: event.nativeEvent.layout.height,
    });
  }, []);

  const updateNormalRowHeight = useCallback((sentenceId: number, height: number) => {
    normalRowHeightsRef.current.set(sentenceId, height);
  }, []);

  const handleTranscriptViewportLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const handleTranscriptScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleTranscriptScrollBegin = useCallback(() => {
    isUserInteractingRef.current = true;
  }, []);

  const handleTranscriptScrollEnd = useCallback(() => {
    isUserInteractingRef.current = false;
  }, []);

  const transcriptShowEnglish = !subtitlesHidden && mode !== 'chinese';
  const transcriptShowChinese = !subtitlesHidden && mode !== 'english';

  // Stable callback for opening the word dictionary popup. Tapping a highlight
  // phrase in any sentence row routes here. We mirror english-player web: the
  // popup looks up matching phraseCards by phrase text (case-insensitive).
  const handleWordPress = useCallback((word: string, sentence: Sentence) => {
    setDictContext({ word, sentence });
  }, []);

  const transcriptRows = useMemo(
    () => (
      <View>
        {sentenceRenderWindow.rows.map(({ sentence: currentSentence, index }) => (
          <MemoSentenceListRow
            key={currentSentence.id}
            sentence={currentSentence}
            index={index}
            isFocused={currentSentence.id === focusedSentenceId}
            showEnglish={transcriptShowEnglish}
            showChinese={transcriptShowChinese}
            subtitleFontSize={subtitleFontSize}
            isPlaying={player.isPlaying}
            loopActive={loopActive}
            isLoggedIn={isLoggedIn}
            isFav={favoritedIds.has(currentSentence.id)}
            isToggling={togglingFavId === currentSentence.id}
            existingNote={existingNote}
            noteVisible={noteVisible && currentSentence.id === focusedSentenceId}
            noteInput={noteInput}
            noteSubmitting={noteSubmitting}
            noteError={noteError}
            onLayout={updateSentenceRowLayout}
            onSelect={handleSelectSentence}
            onToggleLoop={() => setLoopActive((prev) => !prev)}
            onToggleFavorite={() => void handleToggleFavorite(currentSentence.id)}
            onOpenNote={() => void handleOpenNote()}
            onChangeNote={setNoteInput}
            onSubmitNote={() => void handleSubmitNote()}
            onCancelNote={() => setNoteVisible(false)}
            onNormalRowHeight={updateNormalRowHeight}
            onWordPress={handleWordPress}
          />
        ))}
      </View>
    ),
    [
      existingNote,
      favoritedIds,
      focusedSentenceId,
      handleOpenNote,
      handleSelectSentence,
      handleSubmitNote,
      handleToggleFavorite,
      handleWordPress,
      isLoggedIn,
      loopActive,
      noteError,
      noteInput,
      noteSubmitting,
      noteVisible,
      player.isPlaying,
      sentenceRenderWindow.rows,
      subtitleFontSize,
      togglingFavId,
      transcriptShowChinese,
      transcriptShowEnglish,
      updateNormalRowHeight,
      updateSentenceRowLayout,
    ],
  );

  // No "loading…" placeholder screen — we render the full episode shell
  // immediately (back button + video frame + mode tabs + transcript area)
  // and let the data fill in when it arrives. This makes the navigation
  // from LibraryScreen feel instant: tap → episode page appears at once,
  // content morphs in within a few hundred ms.
  //
  // The only hard error state is when loading has finished AND snapshot is
  // still missing — surface a small error message in-place rather than
  // bouncing the user to a separate "数据不可用" screen.
  const hasError = !loading && (!snapshot || !episode) && Boolean(error);

  const tabletTranscriptRows = useMemo(
    () => {
      // Cards mode → the right pane is the phrase-card panel (mirrors web).
      if (mode === 'cards') {
        return (
          <PhraseCardPanelNative
            cards={phraseCards}
            onJump={(sentenceId) => {
              handleModeChange('bilingual');
              handleSelectSentence(sentenceId);
            }}
          />
        );
      }

      const renderEnglishContent = (currentSentence: Sentence, focused: boolean) => {
        if (!transcriptShowEnglish) return undefined;

        // Dictation mode → hide the English (replaced by " · · · ") so the
        // user types into the dictation panel below the focus card. Tap a
        // row to reveal that sentence's English.
        if (mode === 'dictation') {
          const revealed = revealedClozeSentenceIds.has(currentSentence.id);
          if (!revealed) {
            return (
              <AppText
                style={{
                  fontSize: 16,
                  lineHeight: 28,
                  letterSpacing: 4,
                  color: theme.textTertiary,
                }}
              >
                · · ·
              </AppText>
            );
          }
        }

        // Cloze mode → render with cloze blanks; tapping a blank reveals it.
        if (mode === 'cloze') {
          const revealed = getRevealedIndicesForSentence(currentSentence.id, revealedClozeKeys);
          const showAllAnswer = revealedClozeSentenceIds.has(currentSentence.id);
          const segments = getCachedClozeSegments(currentSentence, showAllAnswer, revealed.indices, revealed.key);
          return (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              {segments.map((seg, idx) => {
                if (seg.type === 'text') {
                  return (
                    <AppText
                      key={`text-${idx}`}
                      style={{
                        fontSize: 16,
                        lineHeight: 28,
                        fontWeight: focused ? '600' : '500',
                        color: theme.textPrimary,
                      }}
                    >
                      {seg.text}
                    </AppText>
                  );
                }
                return (
                  <Pressable
                    key={`cloze-${idx}`}
                    onPress={() => handleToggleClozeWord(currentSentence.id, seg.index)}
                    style={({ pressed }) => ({
                      marginHorizontal: 2,
                      marginVertical: 2,
                      borderRadius: 4,
                      backgroundColor: seg.bg,
                      opacity: pressed ? 0.72 : 1,
                    })}
                  >
                    <AppText
                      style={{
                        fontSize: 16,
                        lineHeight: 28,
                        fontWeight: '500',
                        paddingHorizontal: 4,
                        color: seg.revealed ? seg.color : seg.bg,
                      }}
                    >
                      {seg.text}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          );
        }

        return (
          <HighlightedEnglish
            sentence={currentSentence}
            fontSize={Math.max(subtitleFontSize, 16)}
            lineHeight={Math.max(subtitleFontSize + 12, 28)}
            fontWeight={focused ? '600' : '500'}
            color={theme.textPrimary}
            onWordPress={handleWordPress}
          />
        );
      };

      return (
        <View>
          {sentenceRenderWindow.rows.map(({ sentence: currentSentence, index }) => {
            const isFocused = currentSentence.id === focusedSentenceId;
            const isFocusActiveSentence = currentSentence.id === activeSentenceId;
            const isFav = favoritedIds.has(currentSentence.id);
            const isToggling = togglingFavId === currentSentence.id;
            const hasNote = Boolean(existingNote) && isFocused;
            // In dictation mode, tapping a row reveals its English in place
            // (matches web SubtitlePanel behaviour). In other modes, tap-to-jump.
            const onSelect = () => {
              if (mode === 'dictation') {
                handleToggleClozeAnswer(currentSentence.id);
              }
              handleSelectSentence(currentSentence.id);
            };
            const onCopy = () => handleCopySentence(currentSentence.id);
            const onToggleFavorite = () => void handleToggleFavorite(currentSentence.id);
            const onOpenNote = () => void handleOpenSentenceNote(currentSentence.id);
            const onLayout = (event: LayoutChangeEvent) =>
              updateSentenceRowLayout(currentSentence.id, event);

            const isRecording = recordingSentenceId === currentSentence.id;
            const hasRecording = recordings[currentSentence.id] != null;
            const isPlayingRecording = playingRecordingSentenceId === currentSentence.id;
            const onToggleRecording = () => void handleToggleRecording(currentSentence.id);
            const onPlayRecording = () => handlePlayRecording(currentSentence.id);

            if (isFocused) {
              return (
                <TabletActiveSentenceCardV2
                  key={currentSentence.id}
                  sentence={currentSentence}
                  index={index}
                  isPlaying={player.isPlaying && isFocusActiveSentence}
                  showEnglish={transcriptShowEnglish}
                  showChinese={transcriptShowChinese}
                  showPhonetic={phoneticsOn}
                  englishContent={renderEnglishContent(currentSentence, true)}
                  isLoggedIn={isLoggedIn}
                  isFav={isFav}
                  hasNote={hasNote}
                  isToggling={isToggling}
                  onSelect={onSelect}
                  onCopy={onCopy}
                  onToggleFavorite={onToggleFavorite}
                  onOpenNote={onOpenNote}
                  onLayout={onLayout}
                  recordingSupported
                  isRecording={isRecording}
                  hasRecording={hasRecording}
                  isPlayingRecording={isPlayingRecording}
                  onToggleRecording={onToggleRecording}
                  onPlayRecording={onPlayRecording}
                />
              );
            }

            return (
              <TabletTranscriptRowV2
                key={currentSentence.id}
                sentence={currentSentence}
                index={index}
                showEnglish={transcriptShowEnglish}
                showChinese={transcriptShowChinese}
                showPhonetic={false}
                englishContent={renderEnglishContent(currentSentence, false)}
                isLoggedIn={isLoggedIn}
                isFav={isFav}
                hasNote={false}
                isToggling={isToggling}
                onSelect={onSelect}
                onCopy={onCopy}
                onToggleFavorite={onToggleFavorite}
                onOpenNote={onOpenNote}
                onLayout={onLayout}
                recordingSupported
                isRecording={isRecording}
                hasRecording={hasRecording}
                isPlayingRecording={isPlayingRecording}
                onToggleRecording={onToggleRecording}
                onPlayRecording={onPlayRecording}
              />
            );
          })}
        </View>
      );
    },
    [
      activeSentenceId,
      existingNote,
      favoritedIds,
      focusedSentenceId,
      handleCopySentence,
      handleOpenSentenceNote,
      handlePlayRecording,
      handleSelectSentence,
      handleToggleClozeAnswer,
      handleToggleClozeWord,
      handleToggleFavorite,
      handleToggleRecording,
      handleWordPress,
      isLoggedIn,
      mode,
      phoneticsOn,
      phraseCards,
      player.isPlaying,
      playingRecordingSentenceId,
      recordingSentenceId,
      recordings,
      revealedClozeKeys,
      revealedClozeSentenceIds,
      sentenceRenderWindow.rows,
      sentences.length,
      subtitleFontSize,
      togglingFavId,
      transcriptShowChinese,
      transcriptShowEnglish,
      updateSentenceRowLayout,
    ],
  );

  const tabletStudyContent = useMemo(() => {
    const focusedSentence =
      (focusedSentenceId != null ? sentences.find((item) => item.id === focusedSentenceId) ?? null : null);
    const currentStudySentence = activeSentence ?? focusedSentence ?? sentences[0] ?? null;
    const currentClozeSentence = currentStudySentence;
    const currentStudySentenceIndex = currentStudySentence
      ? Math.max(
          sentences.findIndex((item) => item.id === currentStudySentence.id),
          0,
        )
      : 0;
    const studyTimeLabel = currentStudySentence
      ? `${formatSeconds(currentStudySentence.start)} – ${formatSeconds(currentStudySentence.end)}`
      : '';

    // Dictation mode → DictationPanel only (it has its own header). Avoid the
    // outer 1/180 toolbar since it would duplicate the panel's own meta row.
    if (mode === 'dictation') {
      return (
        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, padding: 12 }}
            showsVerticalScrollIndicator={false}
          >
            <DictationPanel
              sentence={currentStudySentence}
              sentenceIndex={currentStudySentenceIndex}
              sentenceTotal={sentences.length}
              input={dictationInput}
              submitted={dictationSubmitted}
              showAnswer={dictationShowAnswer}
              isFavorite={currentStudySentence != null && favoritedIds.has(currentStudySentence.id)}
              canFavorite={isLoggedIn && currentStudySentence != null}
              onInput={setDictationInput}
              onSubmit={handleSubmitDictation}
              onRetry={handleRetryDictation}
              onNext={handleNext}
              onToggleAnswer={() => setDictationShowAnswer((prev) => !prev)}
              onToggleFavorite={() => {
                if (currentStudySentence != null) void handleToggleFavorite(currentStudySentence.id);
              }}
              onEditNote={() => {
                handleModeChange('bilingual');
                void handleOpenNote();
              }}
            />
          </ScrollView>
        </View>
      );
    }

    // Cloze mode → ClozeCard fills the focus area; right pane shows blanked rows.
    if (mode === 'cloze') {
      return (
        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {currentClozeSentence ? (
              <ClozeCard
                sentence={currentClozeSentence}
                index={currentStudySentenceIndex}
                total={sentences.length}
                active={currentClozeSentence.id === activeSentenceId}
              revealedIndices={getRevealedIndicesForSentence(currentClozeSentence.id, revealedClozeKeys).indices}
              revealedIndicesKey={getRevealedIndicesForSentence(currentClozeSentence.id, revealedClozeKeys).key}
                showAnswer={revealedClozeSentenceIds.has(currentClozeSentence.id)}
                onRevealWord={(clozeIndex) => handleToggleClozeWord(currentClozeSentence.id, clozeIndex)}
                onToggleAnswer={() => handleToggleClozeAnswer(currentClozeSentence.id)}
                onSelect={() => handleSelectSentence(currentClozeSentence.id)}
                onLayout={(event) => updateSentenceRowLayout(currentClozeSentence.id, event)}
              />
            ) : (
              <SurfaceCard style={{ marginHorizontal: 12 }}>
                <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>
                  当前暂无可挖空句子。
                </AppText>
              </SurfaceCard>
            )}
          </ScrollView>
        </View>
      );
    }

    // Cards mode → phrase cards live on the RIGHT pane now. The left bottom
    // shows the focus card so the user still sees the current sentence.
    // No outer toolbar (toggle to dictation is meaningless here).
    if (mode === 'cards') {
      return (
        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingTop: 4, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            <TabletStudySentenceCard
              sentence={currentStudySentence}
              showEnglish={transcriptShowEnglish}
              showChinese={transcriptShowChinese}
              showPhonetic={phoneticsOn}
              subtitleFontSize={subtitleFontSize}
              onWordPress={handleWordPress}
            />
          </ScrollView>
        </View>
      );
    }

    // Default modes (bilingual / english / chinese): index/time + fav/note +
    // "switch to dictation" pill at the top, then the focus card below.
    const dictationToggleLabel = '切换到听写';
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <View
          style={{
            minHeight: 38,
            paddingHorizontal: 14,
            paddingTop: 8,
            paddingBottom: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <AppText style={{ fontSize: 12, fontWeight: '600', color: theme.textPrimary, fontVariant: ['tabular-nums'] }}>
            {sentences.length > 0 ? `${currentStudySentenceIndex + 1}` : '--'}
          </AppText>
          <AppText style={{ fontSize: 11, color: theme.textTertiary }}>/</AppText>
          <AppText style={{ fontSize: 12, color: theme.textSecondary, fontVariant: ['tabular-nums'] }}>
            {sentences.length > 0 ? `${sentences.length}` : '--'}
          </AppText>
          {studyTimeLabel ? (
            <AppText style={{ fontSize: 11.5, color: theme.textSecondary, fontVariant: ['tabular-nums'] }}>
              {studyTimeLabel}
            </AppText>
          ) : null}

          <View style={{ flex: 1 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {isLoggedIn && currentStudySentence ? (
              <>
                <SentenceActionIcon
                  icon={favoritedIds.has(currentStudySentence.id) ? 'heart' : 'heart-outline'}
                  color={favoritedIds.has(currentStudySentence.id) ? COLOR_RED : theme.textSecondary}
                  backgroundColor="transparent"
                  onPress={() => void handleToggleFavorite(currentStudySentence.id)}
                  disabled={togglingFavId === currentStudySentence.id}
                  size={28}
                  iconSize={15}
                />
                <SentenceActionIcon
                  icon={existingNote ? 'create' : 'create-outline'}
                  color={existingNote ? theme.textPrimary : theme.textSecondary}
                  backgroundColor="transparent"
                  onPress={() => void handleOpenNote()}
                  size={28}
                  iconSize={15}
                />
              </>
            ) : null}
            <Pressable
              onPress={() => {
                void handleModeChange('dictation');
              }}
              style={({ pressed }) => ({
                height: 28,
                paddingHorizontal: 10,
                marginLeft: 4,
                borderRadius: 6,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'transparent',
                borderWidth: 1,
                borderColor: 'transparent',
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <AppText
                style={{
                  fontSize: 11.5,
                  letterSpacing: 0.2,
                  color: theme.textSecondary,
                  fontWeight: '600',
                }}
              >
                {dictationToggleLabel}
              </AppText>
            </Pressable>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: theme.separator, opacity: 0.7 }} />

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 2, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <TabletStudySentenceCard
            sentence={currentStudySentence}
            showEnglish={transcriptShowEnglish}
            showChinese={transcriptShowChinese}
            showPhonetic={phoneticsOn}
            subtitleFontSize={subtitleFontSize}
            onWordPress={handleWordPress}
          />
        </ScrollView>
      </View>
    );
  }, [
    activeSentence,
    activeSentenceId,
    activeSentenceIndex,
    dictationInput,
    dictationShowAnswer,
    dictationSubmitted,
    existingNote,
    favoritedIds,
    focusedSentenceId,
    handleModeChange,
    handleNext,
    handleOpenNote,
    handleRetryDictation,
    handleSelectSentence,
    handleSubmitDictation,
    handleSubmitNote,
    handleToggleClozeAnswer,
    handleToggleClozeWord,
    handleToggleFavorite,
    handleWordPress,
    isLoggedIn,
    loopActive,
    mode,
    noteError,
    noteInput,
    noteSubmitting,
    noteVisible,
    phoneticsOn,
    phraseCards,
    player.isPlaying,
    revealedClozeKeys,
    revealedClozeSentenceIds,
    sentences,
    subtitleFontSize,
    togglingFavId,
    transcriptShowChinese,
    transcriptShowEnglish,
    updateSentenceRowLayout,
  ]);

  const tabletControlProps = useMemo(
    () => ({
      currentRate: player.playbackRateLabel,
      currentRateValue: player.player.playbackRate || 1,
      currentTime: player.currentTime,
      duration: player.duration,
      aPointTime: player.aPointTime,
      bPointTime: player.bPointTime,
      abLoopActive: player.abLoopActive,
      isPlaying: player.isPlaying,
      showVideo,
      phoneticsOn,
      isLoopActive: loopActive,
      singlePause,
      intervalDelay,
      onSeek: player.handleSeek,
      onSelectRate: (rate: number) => {
        player.player.playbackRate = rate;
      },
      onToggleVideo: () => setShowVideo((prev) => !prev),
      onTogglePhonetics: () => setPhoneticsOn((prev) => !prev),
      onPrev: handlePrev,
      onPlayPause: player.togglePlayPause,
      onNext: handleNext,
      onABPoint: player.handleABPoint,
      onToggleLoop: () => setLoopActive((prev) => !prev),
      onToggleSinglePause: () => setSinglePause((prev) => !prev),
      onSetIntervalDelay: setIntervalDelay,
    }),
    [
      handleNext,
      handlePrev,
      intervalDelay,
      loopActive,
      phoneticsOn,
      player,
      showVideo,
      singlePause,
    ],
  );

  const tabletNoteSheet = useMemo(
    () => ({
      visible: shouldUseTabletLayout && noteVisible,
      input: noteInput,
      submitting: noteSubmitting,
      error: noteError,
      hasExistingNote: Boolean(existingNote),
      onChange: setNoteInput,
      onSubmit: () => void handleSubmitNote(),
      onCancel: () => setNoteVisible(false),
    }),
    [existingNote, handleSubmitNote, noteError, noteInput, noteSubmitting, noteVisible, shouldUseTabletLayout],
  );

  if (shouldUseTabletLayout) {
    return (
      <>
        <EpisodeScreenTablet
          episode={episode}
          snapshotReady={Boolean(snapshot && player.player)}
          loading={loading}
          error={error}
          hasError={hasError}
          mode={selectedMode}
          cover={episode?.cover}
          playerView={player.player}
          toastMessage={player.toastMessage}
          totalSentences={sentences.length}
          studyPanelContent={tabletStudyContent}
          transcriptRowsContent={tabletTranscriptRows}
          transcriptScrollRef={subtitleScrollRef}
          onTranscriptViewportLayout={handleTranscriptViewportLayout}
          onTranscriptScroll={handleTranscriptScroll}
          onTranscriptScrollBegin={handleTranscriptScrollBegin}
          onTranscriptScrollEnd={handleTranscriptScrollEnd}
          onTranscriptMomentumBegin={handleTranscriptScrollBegin}
          onTranscriptMomentumEnd={handleTranscriptScrollEnd}
          onBack={() => router.back()}
          onOpenSettings={() => setShowSettingsSheet(true)}
          onChangeMode={(next) => {
            void handleModeChange(next);
          }}
          controlProps={tabletControlProps}
          noteSheet={tabletNoteSheet}
        />

        <EpisodeSettingsSheet
          variant="tablet"
          visible={showSettingsSheet}
          insetsBottom={insets.bottom}
          subtitleFontSize={subtitleFontSize}
          loopActive={loopActive}
          singlePause={singlePause}
          phoneticsOn={phoneticsOn}
          subtitlesHidden={subtitlesHidden}
          activeSentenceFavorited={activeSentenceId != null && favoritedIds.has(activeSentenceId)}
          canFavorite={isLoggedIn && activeSentenceId != null}
          onClose={() => setShowSettingsSheet(false)}
          onChangeSubtitleFontSize={setSubtitleFontSize}
          onToggleLoop={() => setLoopActive((prev) => !prev)}
          onToggleSinglePause={() => setSinglePause((prev) => !prev)}
          onTogglePhonetics={() => setPhoneticsOn((prev) => !prev)}
          onToggleSubtitles={() => setSubtitlesHidden((prev) => !prev)}
          onToggleFavorite={() => {
            if (activeSentenceId != null) void handleToggleFavorite(activeSentenceId);
          }}
          onOpenCards={() => {
            void handleModeChange('cards');
          }}
          onOpenBilingual={() => {
            setSubtitlesHidden(false);
            void handleModeChange('bilingual');
          }}
        />

        <WordDictPopup
          variant="tablet"
          visible={dictContext !== null}
          word={dictContext?.word ?? null}
          phraseCards={phraseCards}
          currentSentence={dictContext?.sentence ?? null}
          insetsBottom={insets.bottom}
          onClose={() => setDictContext(null)}
          onJumpToSentence={(sentenceId) => {
            handleSelectSentence(sentenceId);
          }}
        />
      </>
    );
  }

  const compactTopInset = floatingInsets.placement === 'top' ? floatingInsets.top : insets.top;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: theme.pageBackground }}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingTop: compactTopInset + 10 }}>
          <View
            style={{
              marginHorizontal: SPACING_PAGE_H,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <TopToolbarButton icon="chevron-back" onPress={() => router.back()} />
            <TopToolbarButton icon="settings-outline" onPress={() => setShowSettingsSheet(true)} />
          </View>

          <View
            style={{
              marginHorizontal: SPACING_PAGE_H,
              marginBottom: 0,
              borderRadius: 28,
              overflow: 'hidden',
              backgroundColor: theme.cardBackground,
              borderWidth: 0.5,
              borderColor: theme.border,
              shadowColor: '#000',
              shadowOpacity: 0.06,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 2,
            }}
          >
            <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.secondaryCardBackground }}>
              {episode?.cover ? (
                <Image source={episode.cover} style={{ position: 'absolute', width: '100%', height: '100%' }} contentFit="cover" />
              ) : null}
              {/* Mount VideoView ONLY after the snapshot is loaded and we
                  actually have a video source. The player + AVAudioSession
                  are heavyweight to initialize and were running during the
                  navigation slide-up, causing audio activation glitches
                  ("声音先于画面"). Cover image stays visible until ready. */}
              {snapshot && player.player ? (
                <VideoView
                  player={player.player}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  nativeControls={false}
                />
              ) : null}
            </View>
          </View>

          <ModeTabs value={selectedMode} onChange={handleModeChange} />
        </View>

        <View style={{ flex: 1, minHeight: 0 }}>
          {player.toastMessage ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                right: 16,
                bottom: 18,
                left: 16,
                zIndex: 3,
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
                  {player.toastMessage}
                </AppText>
              </View>
            </View>
          ) : null}

          {mode === 'cards' ? (
            <PhraseCardPanelNative
              cards={phraseCards}
              onJump={(sentenceId) => {
                handleModeChange('bilingual');
                handleSelectSentence(sentenceId);
              }}
            />
          ) : mode === 'dictation' ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingTop: 10, paddingBottom: 12 }}
              showsVerticalScrollIndicator={false}
            >
              <DictationPanel
                sentence={activeSentence}
                sentenceIndex={Math.max(activeSentenceIndex, 0)}
                sentenceTotal={sentences.length}
                input={dictationInput}
                submitted={dictationSubmitted}
                showAnswer={dictationShowAnswer}
                isFavorite={activeSentence != null && favoritedIds.has(activeSentence.id)}
                canFavorite={isLoggedIn && activeSentence != null}
                onInput={setDictationInput}
                onSubmit={handleSubmitDictation}
                onRetry={handleRetryDictation}
                onNext={handleNext}
                onToggleAnswer={() => setDictationShowAnswer((prev) => !prev)}
                onToggleFavorite={() => {
                if (activeSentence != null) void handleToggleFavorite(activeSentence.id);
              }}
              onEditNote={() => {
                  handleModeChange('bilingual');
                  void handleOpenNote();
                }}
              />
            </ScrollView>
          ) : mode === 'cloze' ? (
            <ScrollView
              ref={subtitleScrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingTop: 10, paddingBottom: 12 }}
              onLayout={(event) => { viewportHeightRef.current = event.nativeEvent.layout.height; }}
              onScroll={(event) => { scrollYRef.current = event.nativeEvent.contentOffset.y; }}
              onScrollBeginDrag={() => { isUserInteractingRef.current = true; }}
              onScrollEndDrag={() => { isUserInteractingRef.current = false; }}
              onMomentumScrollBegin={() => { isUserInteractingRef.current = true; }}
              onMomentumScrollEnd={() => { isUserInteractingRef.current = false; }}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
            >
              {sentences.length > 0 ? sentenceRenderWindow.rows.map(({ sentence, index }) => {
                const revealed = getRevealedIndicesForSentence(sentence.id, revealedClozeKeys);

                return (
                  <MemoClozeCard
                    key={sentence.id}
                    sentence={sentence}
                    index={index}
                    total={sentences.length}
                    active={sentence.id === activeSentenceId}
                    revealedIndices={revealed.indices}
                    revealedIndicesKey={revealed.key}
                    showAnswer={revealedClozeSentenceIds.has(sentence.id)}
                    onRevealWord={(clozeIndex) => handleToggleClozeWord(sentence.id, clozeIndex)}
                    onToggleAnswer={() => handleToggleClozeAnswer(sentence.id)}
                    onSelect={() => handleSelectSentence(sentence.id)}
                    onLayout={(event) => {
                      rowLayoutMapRef.current.set(sentence.id, {
                        y: event.nativeEvent.layout.y,
                        height: event.nativeEvent.layout.height,
                      });
                    }}
                  />
                );
              }) : (
                <SurfaceCard>
                  <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>当前暂无可挖空句子。</AppText>
                </SurfaceCard>
              )}
            </ScrollView>
          ) : (
            <ScrollView
              ref={subtitleScrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingTop: 10, paddingBottom: 12 }}
              onLayout={(event) => { viewportHeightRef.current = event.nativeEvent.layout.height; }}
              onScroll={(event) => { scrollYRef.current = event.nativeEvent.contentOffset.y; }}
              onScrollBeginDrag={() => { isUserInteractingRef.current = true; }}
              onScrollEndDrag={() => { isUserInteractingRef.current = false; }}
              onMomentumScrollBegin={() => { isUserInteractingRef.current = true; }}
              onMomentumScrollEnd={() => { isUserInteractingRef.current = false; }}
              scrollEventThrottle={16}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {/* Inline loading hint while the snapshot fetch is in flight.
                  No full-screen spinner — keeps the page shell visible so
                  the user knows where they are. */}
              {loading && sentences.length === 0 ? (
                <View style={{ alignItems: 'center', paddingTop: 36, gap: 10 }}>
                  <ActivityIndicator color={theme.textSecondary} />
                  <AppText style={{ fontSize: FONT_CAPTION, color: theme.textSecondary }}>
                    正在加载字幕…
                  </AppText>
                </View>
              ) : null}
              {hasError ? (
                <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: 24 }}>
                  <AppText style={{ fontSize: FONT_CALLOUT, color: COLOR_RED }}>
                    {error ?? '单集数据不可用'}
                  </AppText>
                </View>
              ) : null}
              {transcriptRows}
            </ScrollView>
          )}
        </View>

        <EpisodeBottomBar
          currentRate={player.playbackRateLabel}
          currentRateValue={player.player.playbackRate || 1}
          currentTime={player.currentTime}
          duration={player.duration}
          aPointTime={player.aPointTime}
          bPointTime={player.bPointTime}
          isPlaying={player.isPlaying}
          isSubtitlesHidden={subtitlesHidden}
          abPointStage={player.abLoopActive && player.bPointTime !== null ? 'ab' : player.aPointTime !== null ? 'b' : 'a'}
          isLoopActive={loopActive}
          singlePause={singlePause}
          intervalDelay={intervalDelay}
          onSeek={player.handleSeek}
          onSelectRate={(rate) => {
            player.player.playbackRate = rate;
          }}
          onToggleSubtitles={() => setSubtitlesHidden((prev) => !prev)}
          onPrev={handlePrev}
          onPlayPause={player.togglePlayPause}
          onNext={handleNext}
          onABPoint={player.handleABPoint}
          onToggleLoop={() => setLoopActive((prev) => !prev)}
          onToggleSinglePause={() => setSinglePause((prev) => !prev)}
          onSetIntervalDelay={setIntervalDelay}
        />

        <EpisodeSettingsSheet
          visible={showSettingsSheet}
          insetsBottom={insets.bottom}
          subtitleFontSize={subtitleFontSize}
          loopActive={loopActive}
          singlePause={singlePause}
          phoneticsOn={phoneticsOn}
          subtitlesHidden={subtitlesHidden}
          activeSentenceFavorited={activeSentenceId != null && favoritedIds.has(activeSentenceId)}
          canFavorite={isLoggedIn && activeSentenceId != null}
          onClose={() => setShowSettingsSheet(false)}
          onChangeSubtitleFontSize={setSubtitleFontSize}
          onToggleLoop={() => setLoopActive((prev) => !prev)}
          onToggleSinglePause={() => setSinglePause((prev) => !prev)}
          onTogglePhonetics={() => setPhoneticsOn((prev) => !prev)}
          onToggleSubtitles={() => setSubtitlesHidden((prev) => !prev)}
          onToggleFavorite={() => {
            if (activeSentenceId != null) void handleToggleFavorite(activeSentenceId);
          }}
          onOpenCards={() => {
            void handleModeChange('cards');
          }}
          onOpenBilingual={() => {
            setSubtitlesHidden(false);
            void handleModeChange('bilingual');
          }}
        />

        <WordDictPopup
          visible={dictContext !== null}
          word={dictContext?.word ?? null}
          phraseCards={phraseCards}
          // Locked at tap-time, not the live activeSentence — so the example
          // doesn't switch as playback advances past the highlight.
          currentSentence={dictContext?.sentence ?? null}
          insetsBottom={insets.bottom}
          onClose={() => setDictContext(null)}
          onJumpToSentence={(sentenceId) => {
            handleSelectSentence(sentenceId);
          }}
        />
      </View>
    </SafeAreaView>
  );
}
