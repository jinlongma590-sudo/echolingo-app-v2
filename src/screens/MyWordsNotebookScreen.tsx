import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import {
  ActionButton,
  ChromeIconButton,
  SurfaceCard,
} from '@/components/ui/ApplePrimitives';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useVocabularyNotebookData } from '@/hooks/useVocabularyNotebookData';
import { safeBack } from '@/navigation/safeBack';
import { updateVocabularyWordStatus, type NotebookStatus, type NotebookWord } from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  ACCENT,
  BG_CARD,
  BG_CARD_SOFT,
  BG_OVERLAY,
  BG_PAGE,
  BORDER_SOFT,
  COLOR_AMBER_BG,
  COLOR_GREEN_BG,
  COLOR_RED,
  COLOR_RED_BG,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  RADIUS_BTN,
  RADIUS_CARD,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';

const TABLET_PAGE_MAX_WIDTH = 1220;

type NotebookTab = 'all' | NotebookStatus;

function keyForWord(word: NotebookWord) {
  return `${word.bookSlug ?? word.book}-${word.word.toLowerCase()}`;
}

function buildMobileMetaLine(word: NotebookWord) {
  if (word.status === 'mastered') {
    return `${word.book} · 已掌握`;
  }

  const reviewLabel =
    word.nextReview.includes('到期') || word.nextReview.includes('现在')
      ? word.nextReview
      : `下次复习 ${word.nextReview}`;

  return `${word.book} · ${reviewLabel}`;
}

function buildStatusSummary(word: NotebookWord) {
  if (word.status === 'mistake') return '建议优先回看';
  if (word.status === 'due') return '继续安排复习';
  return '状态稳定';
}

function statusLabel(status: NotebookStatus) {
  if (status === 'mistake') return '错词';
  if (status === 'due') return '待复习';
  return '已掌握';
}

function DetailBlock({
  title,
  content,
  level = 'secondary',
}: {
  title: string;
  content: string;
  level?: 'primary' | 'secondary' | 'tertiary' | 'tag';
}) {
  const { theme } = useAppTheme();
  const palette =
    level === 'primary'
      ? { bg: theme.cardBackground, title: theme.textSecondary, body: theme.textPrimary, padding: 16, bodySize: FONT_BODY, lineHeight: 22 }
      : level === 'secondary'
        ? { bg: theme.secondaryCardBackground, title: theme.textSecondary, body: theme.textPrimary, padding: 14, bodySize: FONT_CALLOUT, lineHeight: 20 }
        : level === 'tertiary'
          ? { bg: theme.secondaryCardBackground, title: theme.textSecondary, body: theme.textSecondary, padding: 12, bodySize: FONT_CAPTION, lineHeight: 18 }
          : { bg: theme.elevatedCardBackground, title: theme.textSecondary, body: theme.textSecondary, padding: 12, bodySize: FONT_CAPTION, lineHeight: 18 };

  return (
    <View style={{ borderRadius: RADIUS_CARD, backgroundColor: palette.bg, padding: palette.padding, gap: 6 }}>
      <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: palette.title }}>{title}</AppText>
      <AppText style={{ fontSize: palette.bodySize, lineHeight: palette.lineHeight, color: palette.body }}>{content}</AppText>
    </View>
  );
}

function OverviewStat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: 'due' | 'mastered' | 'mistake';
}) {
  const { theme } = useAppTheme();
  const tone =
    tint === 'due'
      ? { bg: theme.colorScheme === 'dark' ? 'rgba(255,159,10,0.16)' : 'rgba(245,166,35,0.11)', fg: theme.warning }
      : tint === 'mastered'
        ? { bg: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : 'rgba(52,199,89,0.08)', fg: theme.success }
        : { bg: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.14)' : 'rgba(255,59,48,0.08)', fg: theme.destructive };

  return (
    <View
      style={{
        flex: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: tone.bg,
        gap: 2,
      }}
    >
      <AppText style={{ fontSize: FONT_MICRO, color: tone.fg }}>{label}</AppText>
      <AppText style={{ fontSize: 20, fontWeight: '700', color: TEXT_PRIMARY }}>{value}</AppText>
    </View>
  );
}

function NotebookPrimaryButton({
  label,
  tone = 'secondary',
  onPress,
  disabled = false,
}: {
  label: string;
  tone?: 'primary' | 'secondary';
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 48,
        borderRadius: RADIUS_BTN,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        backgroundColor:
          tone === 'primary'
            ? theme.primaryBlue
            : theme.colorScheme === 'dark'
              ? theme.secondaryCardBackground
              : theme.cardBackground,
        borderWidth: 1,
        borderColor: tone === 'primary' ? theme.primaryBlue : theme.border,
        opacity: disabled ? 0.42 : pressed ? 0.76 : 1,
      })}
    >
      <AppText style={{ fontSize: 16, fontWeight: '600', color: tone === 'primary' ? '#FFFFFF' : theme.textPrimary }}>{label}</AppText>
    </Pressable>
  );
}

function WordStatusPill({ status }: { status: NotebookStatus }) {
  const { theme } = useAppTheme();
  const palette =
    status === 'due'
      ? { bg: theme.colorScheme === 'dark' ? 'rgba(255,159,10,0.16)' : 'rgba(245,166,35,0.12)', fg: theme.warning }
      : status === 'mastered'
        ? { bg: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : 'rgba(52,199,89,0.08)', fg: theme.success }
        : { bg: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.14)' : 'rgba(255,59,48,0.08)', fg: theme.destructive };

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: palette.bg,
      }}
    >
      <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: palette.fg }}>{statusLabel(status)}</AppText>
    </View>
  );
}

function CompactSearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        minHeight: 50,
        borderRadius: RADIUS_CARD,
        backgroundColor: theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: theme.border,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        gap: 8,
        marginBottom: 14,
      }}
    >
      <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        style={{ flex: 1, minHeight: 44, color: theme.textPrimary, fontSize: FONT_BODY }}
      />
    </View>
  );
}

function DetailSummaryTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: theme.border,
        gap: 4,
      }}
    >
      <AppText style={{ fontSize: FONT_MICRO, color: theme.textSecondary }}>{label}</AppText>
      <AppText style={{ fontSize: FONT_CALLOUT, fontWeight: '600', color: theme.textPrimary }}>{value}</AppText>
    </View>
  );
}

export function MyWordsNotebookScreen() {
  const { theme } = useAppTheme();
  const { isTablet } = useDeviceClass();
  const session = useAppSession();
  const params = useLocalSearchParams<{ tab?: string; bookSlug?: string }>();
  const { data, loading, error, authRequired, refresh } = useVocabularyNotebookData();
  const [activeTab, setActiveTab] = useState<NotebookTab>('all');
  const [query, setQuery] = useState('');
  const [selectedWordKey, setSelectedWordKey] = useState<string | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const isLoggedIn = session.status === 'authenticated';
  const words = data?.words ?? [];
  const requestedBookSlug = typeof params.bookSlug === 'string' && params.bookSlug.trim().length > 0 ? params.bookSlug : undefined;

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh]),
  );

  useEffect(() => {
    const tab = params.tab;
    if (tab === 'all' || tab === 'due' || tab === 'mastered' || tab === 'mistake') {
      setActiveTab(tab);
    }
  }, [params.tab]);

  const scopedWords = useMemo(
    () => (requestedBookSlug ? words.filter((word) => word.bookSlug === requestedBookSlug) : words),
    [requestedBookSlug, words],
  );

  const counts = useMemo(
    () => ({
      all: scopedWords.length,
      due: scopedWords.filter((word) => word.status === 'due').length,
      mastered: scopedWords.filter((word) => word.status === 'mastered').length,
      mistake: scopedWords.filter((word) => word.status === 'mistake').length,
    }),
    [scopedWords],
  );

  const scopedBookTitle = useMemo(() => {
    if (!requestedBookSlug) return null;
    return scopedWords[0]?.book ?? requestedBookSlug;
  }, [requestedBookSlug, scopedWords]);

  const filteredWords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return scopedWords.filter((word) => {
      const statusMatched = activeTab === 'all' || word.status === activeTab;
      const keywordMatched =
        keyword.length === 0 ||
        word.word.toLowerCase().includes(keyword) ||
        word.meaning.toLowerCase().includes(keyword) ||
        word.book.toLowerCase().includes(keyword) ||
        word.english.toLowerCase().includes(keyword);
      return statusMatched && keywordMatched;
    });
  }, [activeTab, query, scopedWords]);

  const selectedWord = useMemo(() => scopedWords.find((word) => keyForWord(word) === selectedWordKey) ?? null, [scopedWords, selectedWordKey]);

  const subtitle = requestedBookSlug
    ? counts.all > 0
      ? `查看《${scopedBookTitle ?? '当前词书'}》的待复习、已掌握和错词`
      : `《${scopedBookTitle ?? '当前词书'}》还没有沉淀词条`
    : counts.all > 0
      ? '管理待复习、已掌握和错词'
      : '查看你的词库状态与待复习词';

  async function handleStatusChange(word: NotebookWord, status: NotebookStatus) {
    if (!session.session) return;
    const key = keyForWord(word);
    setUpdatingKey(key);
    setMutationError(null);

    try {
      await updateVocabularyWordStatus(session.session, {
        word: word.word,
        book: word.book,
        bookSlug: word.bookSlug,
        status,
      });
      await refresh();
    } catch (err) {
      setMutationError(getVocabularyUserErrorMessage(err, 'notebook_mutation'));
    } finally {
      setUpdatingKey(null);
    }
  }

  function openReview(word: NotebookWord) {
    router.push({
      pathname: '/words/review',
      params: word.bookSlug
        ? { mode: 'review', bookSlug: word.bookSlug, source: 'direct', resume: 'true' }
        : { mode: 'review', source: 'direct', resume: 'true' },
    });
  }

  if (!isLoggedIn || authRequired) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
            <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
          </View>
          <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
            <View style={{ gap: 16 }}>
              <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>我的词库需要登录</AppText>
              <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                登录后即可查看待复习、已掌握和错词状态。
              </AppText>
              <ActionButton label="去登录" variant="dark" onPress={() => router.push('/auth/sign-in')} />
            </View>
          </SurfaceCard>
        </View>
        </AppScreenShell>
    );
  }

  if (error && !data) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
            <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
          </View>
          <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
            <View style={{ gap: 16 }}>
              <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>词库加载失败</AppText>
              <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                现在还没有成功取回你的词库内容，请稍后再试。
              </AppText>
              <AppText style={{ fontSize: 12, color: COLOR_RED }}>{error}</AppText>
              <ActionButton label="重试" variant="dark" onPress={() => void refresh()} />
            </View>
          </SurfaceCard>
        </View>
        </AppScreenShell>
    );
  }

  const overviewCard = (
    <SurfaceCard style={{ marginHorizontal: isTablet ? 0 : SPACING_PAGE_H, padding: 20, gap: 18 }}>
      <View style={{ gap: 8 }}>
        <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '600', color: TEXT_SECONDARY }}>当前词库</AppText>
        <AppText style={{ fontSize: 28, fontWeight: '700', lineHeight: 34, color: TEXT_PRIMARY }}>
          {requestedBookSlug
            ? `${scopedBookTitle ?? '当前词书'}\n待复习 ${counts.due} 个`
            : `当前收录 ${counts.all} 个词\n待复习 ${counts.due} 个`}
        </AppText>
        <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>{subtitle}</AppText>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <OverviewStat label="待复习" value={counts.due} tint="due" />
        <OverviewStat label="已掌握" value={counts.mastered} tint="mastered" />
        <OverviewStat label="错词" value={counts.mistake} tint="mistake" />
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <NotebookPrimaryButton
          label="去复习"
          tone="secondary"
          onPress={() =>
            router.push(
              requestedBookSlug
                ? `/words/review?mode=review&bookSlug=${encodeURIComponent(requestedBookSlug)}&source=direct&resume=true`
                : '/words/review?mode=review&source=direct&resume=true',
            )
          }
        />
        <NotebookPrimaryButton
          label="开始学习"
          tone="primary"
          onPress={() =>
            router.push(
              requestedBookSlug
                ? `/words/review?mode=learn&bookSlug=${encodeURIComponent(requestedBookSlug)}&source=direct&resume=true`
                : '/words/review?mode=learn&source=direct&resume=true',
            )
          }
        />
      </View>
    </SurfaceCard>
  );

  return (
    <>
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
          <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        </View>

        {isTablet ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 20, paddingHorizontal: SPACING_PAGE_H }}>
            <View style={{ width: 348, gap: 16 }}>
              {overviewCard}
              {error && data ? (
                <View>
                  <AppText style={{ fontSize: 12, color: COLOR_RED }}>{error}</AppText>
                </View>
              ) : null}
              {mutationError ? (
                <View>
                  <AppText style={{ fontSize: 12, color: COLOR_RED }}>{mutationError}</AppText>
                </View>
              ) : null}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ paddingTop: 10, paddingBottom: 6 }}>
                <AppText
                  style={{
                    fontSize: 20,
                    fontWeight: '700',
                    letterSpacing: -0.4,
                    color: TEXT_PRIMARY,
                  }}
                >
                  词条列表
                </AppText>
                <AppText
                  style={{
                    fontSize: FONT_CALLOUT,
                    color: TEXT_SECONDARY,
                    marginTop: 3,
                    lineHeight: 18,
                  }}
                >
                  按状态浏览并继续复习
                </AppText>
              </View>
              <View style={{ maxWidth: 420, paddingBottom: 8 }}>
                <CompactSearchField value={query} onChangeText={setQuery} placeholder="搜索单词、释义、词书" />
              </View>

              {loading ? (
                <SurfaceCard style={{ marginBottom: 12 }}>
                  <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
                    <ActivityIndicator color={TEXT_SECONDARY} />
                    <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>正在读取词库记录</AppText>
                  </View>
                </SurfaceCard>
              ) : scopedWords.length === 0 ? (
                <SurfaceCard style={{ marginBottom: 12 }}>
                  <View style={{ gap: 10 }}>
                    <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>
                      {requestedBookSlug ? '这本词书还没有沉淀词条' : '你的词库还没有沉淀内容'}
                    </AppText>
                    <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                      {requestedBookSlug
                        ? '先从这本词书开始学习，新词、待复习词和错词会自动沉淀到这里。'
                        : '完成学习后，待复习词、已掌握词和错词会自动收进这里。'}
                    </AppText>
                    <ActionButton
                      label="去学习新词"
                      variant="dark"
                      onPress={() =>
                        router.push(
                          requestedBookSlug
                            ? `/words/review?mode=learn&bookSlug=${encodeURIComponent(requestedBookSlug)}&source=direct&resume=true`
                            : '/words/review?mode=learn&source=direct&resume=true',
                        )
                      }
                    />
                  </View>
                </SurfaceCard>
              ) : filteredWords.length === 0 ? (
                <SurfaceCard style={{ marginBottom: 12 }}>
                  <View style={{ gap: 10 }}>
                    <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>没有找到匹配的词条</AppText>
                    <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                      换一个关键词，或切换上方状态继续筛选。
                    </AppText>
                  </View>
                </SurfaceCard>
              ) : (
                filteredWords.map((word) => {
                  const wordKey = keyForWord(word);
                  const secondaryAction =
                    word.status === 'due'
                      ? { label: '标记已掌握', nextStatus: 'mastered' as const }
                      : { label: '移入待复习', nextStatus: 'due' as const };
                  const isUpdating = updatingKey === wordKey;

                  return (
                    <SurfaceCard key={wordKey} style={{ marginBottom: 12, padding: 18 }}>
                      <View style={{ gap: 14 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                          <View style={{ flex: 1, gap: 6 }}>
                            <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>{word.word}</AppText>
                            <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: TEXT_PRIMARY }}>{word.meaning}</AppText>
                          </View>
                          <WordStatusPill status={word.status} />
                        </View>

                        <View style={{ gap: 3 }}>
                          <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>{buildMobileMetaLine(word)}</AppText>
                          <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>
                            学习 {word.reviewCount ?? 0} 次 / 错误 {word.mistakeCount ?? 0} 次 · {buildStatusSummary(word)}
                          </AppText>
                        </View>

                        <View style={{ borderRadius: RADIUS_CARD, backgroundColor: theme.secondaryCardBackground, padding: 14, gap: 6 }}>
                          <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: TEXT_SECONDARY }}>英文释义</AppText>
                          <AppText
                            numberOfLines={3}
                            style={{ fontSize: FONT_CAPTION, lineHeight: 17, color: TEXT_SECONDARY }}
                          >
                            {word.english?.trim() ? word.english : '暂无英文释义'}
                          </AppText>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <NotebookPrimaryButton label="查看详情" tone="secondary" onPress={() => setSelectedWordKey(wordKey)} />
                          <ActionButton
                            label={secondaryAction.label}
                            variant="dark"
                            disabled={isUpdating}
                            onPress={() => void handleStatusChange(word, secondaryAction.nextStatus)}
                          />
                        </View>
                      </View>
                    </SurfaceCard>
                  );
                })
              )}
            </View>
          </View>
        ) : (
          <>
            {overviewCard}

            {error && data ? (
              <View style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 16 }}>
                <AppText style={{ fontSize: 12, color: COLOR_RED }}>{error}</AppText>
              </View>
            ) : null}

            <View style={{ paddingTop: 10, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 6 }}>
              <AppText
                style={{
                  fontSize: 20,
                  fontWeight: '700',
                  letterSpacing: -0.4,
                  color: TEXT_PRIMARY,
                }}
              >
                词条列表
              </AppText>
              <AppText
                style={{
                  fontSize: FONT_CALLOUT,
                  color: TEXT_SECONDARY,
                  marginTop: 3,
                  lineHeight: 18,
                }}
              >
                按状态浏览并继续复习
              </AppText>
            </View>
            <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingBottom: 14 }}>
              <CompactSearchField value={query} onChangeText={setQuery} placeholder="搜索单词、释义、词书" />
            </View>

            {loading ? (
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
                <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
                  <ActivityIndicator color={TEXT_SECONDARY} />
                  <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>正在读取词库记录</AppText>
                </View>
              </SurfaceCard>
            ) : scopedWords.length === 0 ? (
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
                <View style={{ gap: 10 }}>
                  <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>
                    {requestedBookSlug ? '这本词书还没有沉淀词条' : '你的词库还没有沉淀内容'}
                  </AppText>
                  <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                    {requestedBookSlug
                      ? '先从这本词书开始学习，新词、待复习词和错词会自动沉淀到这里。'
                      : '完成学习后，待复习词、已掌握词和错词会自动收进这里。'}
                  </AppText>
                  <ActionButton
                    label="去学习新词"
                    variant="dark"
                    onPress={() =>
                    router.push(
                      requestedBookSlug
                        ? `/words/review?mode=learn&bookSlug=${encodeURIComponent(requestedBookSlug)}&source=direct&resume=true`
                        : '/words/review?mode=learn&source=direct&resume=true',
                    )
                  }
                  />
                </View>
              </SurfaceCard>
            ) : filteredWords.length === 0 ? (
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
                <View style={{ gap: 10 }}>
                  <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>没有找到匹配的词条</AppText>
                  <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                    换一个关键词，或切换上方状态继续筛选。
                  </AppText>
                </View>
              </SurfaceCard>
            ) : (
              filteredWords.map((word) => {
                const wordKey = keyForWord(word);
                const secondaryAction =
                  word.status === 'due'
                    ? { label: '标记已掌握', nextStatus: 'mastered' as const }
                    : { label: '移入待复习', nextStatus: 'due' as const };
                const isUpdating = updatingKey === wordKey;

                return (
                  <SurfaceCard key={wordKey} style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 12, padding: 18 }}>
                    <View style={{ gap: 14 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                        <View style={{ flex: 1, gap: 6 }}>
                          <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>{word.word}</AppText>
                          <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: TEXT_PRIMARY }}>{word.meaning}</AppText>
                        </View>
                        <WordStatusPill status={word.status} />
                      </View>

                      <View style={{ gap: 3 }}>
                        <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>{buildMobileMetaLine(word)}</AppText>
                        <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>
                          学习 {word.reviewCount ?? 0} 次 / 错误 {word.mistakeCount ?? 0} 次 · {buildStatusSummary(word)}
                        </AppText>
                      </View>

                      <View style={{ borderRadius: RADIUS_CARD, backgroundColor: theme.secondaryCardBackground, padding: 14, gap: 6 }}>
                        <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: TEXT_SECONDARY }}>英文释义</AppText>
                        <AppText
                          numberOfLines={3}
                          style={{ fontSize: FONT_CAPTION, lineHeight: 17, color: TEXT_SECONDARY }}
                        >
                          {word.english?.trim() ? word.english : '暂无英文释义'}
                        </AppText>
                      </View>

                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <NotebookPrimaryButton label="查看详情" tone="secondary" onPress={() => setSelectedWordKey(wordKey)} />
                        <ActionButton
                          label={secondaryAction.label}
                          variant="dark"
                          disabled={isUpdating}
                          onPress={() => void handleStatusChange(word, secondaryAction.nextStatus)}
                        />
                      </View>
                    </View>
                  </SurfaceCard>
                );
              })
            )}

            {mutationError ? (
              <View style={{ marginHorizontal: SPACING_PAGE_H }}>
                <AppText style={{ fontSize: 12, color: COLOR_RED }}>{mutationError}</AppText>
              </View>
            ) : null}
          </>
        )}
        </View>
      </AppScreenShell>

      <Modal visible={Boolean(selectedWord)} transparent animationType="slide" onRequestClose={() => setSelectedWordKey(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: BG_OVERLAY }}>
          <Pressable style={{ flex: 1 }} onPress={() => setSelectedWordKey(null)} />
          {selectedWord ? (
            <View style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: theme.pageBackground, paddingHorizontal: SPACING_PAGE_H, paddingTop: 12, paddingBottom: 24, gap: 16 }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: TEXT_SECONDARY, opacity: 0.3 }} />
              </View>

              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <AppText style={{ fontSize: FONT_MICRO, fontWeight: '700', color: TEXT_SECONDARY }}>单词详情</AppText>
                    <AppText style={{ fontSize: 30, fontWeight: '700', color: TEXT_PRIMARY }}>{selectedWord.word}</AppText>
                    <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>{selectedWord.phonetic || '暂无音标'}</AppText>
                    <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>{selectedWord.book}</AppText>
                  </View>
                  <WordStatusPill status={selectedWord.status} />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <DetailSummaryTile label="下次复习" value={selectedWord.nextReview} />
                <DetailSummaryTile label="学习 / 错误" value={`${selectedWord.reviewCount ?? 0} / ${selectedWord.mistakeCount ?? 0}`} />
              </View>

              <DetailBlock title="中文义" content={selectedWord.meaning} level="primary" />
              {selectedWord.english ? <DetailBlock title="英文释义" content={selectedWord.english} level="secondary" /> : null}
              {selectedWord.example || selectedWord.exampleZh ? (
                <View style={{ gap: 10 }}>
                  {selectedWord.example ? <DetailBlock title="例句" content={selectedWord.example} level="tertiary" /> : null}
                  {selectedWord.exampleZh ? <DetailBlock title="例句翻译" content={selectedWord.exampleZh} level="tertiary" /> : null}
                </View>
              ) : null}
              {selectedWord.pattern ? <DetailBlock title="标签信息" content={selectedWord.pattern} level="tag" /> : null}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                {selectedWord.status !== 'mastered' ? (
                  <NotebookPrimaryButton label="去复习" tone="secondary" onPress={() => openReview(selectedWord)} />
                ) : null}
                <NotebookPrimaryButton
                  label={selectedWord.status === 'due' ? '标记已掌握' : '移入待复习'}
                  tone="primary"
                  disabled={updatingKey === keyForWord(selectedWord)}
                  onPress={() => void handleStatusChange(selectedWord, selectedWord.status === 'due' ? 'mastered' : 'due')}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
