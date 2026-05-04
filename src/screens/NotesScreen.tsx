import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import {
  deleteNote,
  fetchUserNotesWithDetails,
  updateNote,
  type SentenceNoteWithDetails,
} from '@/services/api/sentenceNotes';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { safeBack } from '@/navigation/safeBack';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  ACCENT,
  BG_CARD,
  BG_CARD_SOFT,
  BG_PAGE,
  BORDER_SOFT,
  COLOR_RED,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';

function extractErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function isExpiredSessionError(error: unknown) {
  const message = extractErrorText(error).toLowerCase();
  return (
    message.includes('jwt expired') ||
    message.includes('pgrst303') ||
    message.includes('401') ||
    message.includes('auth session missing') ||
    message.includes('invalid jwt') ||
    message.includes('unauthorized')
  );
}

function toFriendlyNotesError(error: unknown) {
  if (isExpiredSessionError(error)) {
    return '登录状态已失效';
  }
  return '笔记数据暂时不可用，请稍后再试。';
}

function openEpisodeTarget(episodeId: string, sentenceId?: number | null) {
  router.push({
    pathname: '/episode/[id]',
    params: sentenceId ? { id: episodeId, sentence: String(sentenceId) } : { id: episodeId },
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatTimecode(seconds?: number | null) {
  if (!Number.isFinite(seconds)) return null;
  const safe = Math.max(0, Math.floor(Number(seconds)));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${`${secs}`.padStart(2, '0')}`;
}

function buildEpisodeMeta(note: SentenceNoteWithDetails) {
  const start = formatTimecode(note.sentence?.start);
  const end = formatTimecode(note.sentence?.end);
  const timeRange = start && end ? `${start} - ${end}` : null;
  const episodeTitle = note.episode?.title ?? `单集 ${note.episode_id}`;
  return timeRange ? `${episodeTitle} · ${timeRange}` : episodeTitle;
}

function OverviewMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.metricCard,
        {
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      <AppText style={styles.metricLabel}>{label}</AppText>
      <AppText style={styles.metricValue}>{value}</AppText>
      <AppText style={[styles.metricNote, { color: theme.textTertiary }]}>{note}</AppText>
    </View>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <AppText style={styles.sectionTitle}>{title}</AppText>
        {subtitle ? <AppText style={styles.sectionSubtitle}>{subtitle}</AppText> : null}
      </View>
      {action}
    </View>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.emptyState,
        {
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      <View
        style={[
          styles.emptyIconWrap,
          {
            backgroundColor: theme.fillTertiary,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={theme.textSecondary} />
      </View>
      <AppText style={styles.emptyTitle}>{title}</AppText>
      <AppText style={styles.emptySubtitle}>{subtitle}</AppText>
    </View>
  );
}

function NoteAction({
  icon,
  label,
  destructive = false,
  disabled = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.noteAction,
        destructive && [
          styles.noteActionDestructive,
          {
            backgroundColor: 'rgba(255,69,58,0.14)',
            borderColor: 'rgba(255,69,58,0.24)',
          },
        ],
        !destructive && {
          backgroundColor: theme.fillSecondary,
          borderColor: theme.border,
        },
        disabled && styles.noteActionDisabled,
        pressed && !disabled && styles.noteActionPressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={15}
        color={destructive ? theme.destructive : disabled ? theme.textTertiary : theme.textPrimary}
      />
      <AppText style={[styles.noteActionLabel, destructive && styles.noteActionLabelDestructive]}>
        {label}
      </AppText>
    </Pressable>
  );
}

interface NoteEditorModalProps {
  visible: boolean;
  initialValue: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (nextValue: string) => void;
}

function NoteEditorModal({ visible, initialValue, saving, onClose, onSubmit }: NoteEditorModalProps) {
  const { theme } = useAppTheme();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [initialValue, visible]);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <AppText style={styles.modalTitle}>编辑笔记</AppText>
          <AppText style={styles.modalSubtitle}>更新当前句的学习记录，保存后会同步回笔记中心与原句页。</AppText>

          <View style={styles.editorWrap}>
            <TextInput
              multiline
              value={value}
              onChangeText={setValue}
              placeholder="记录你的理解、语感、口语替换或发音提醒…"
              placeholderTextColor={TEXT_SECONDARY}
              style={styles.editorInput}
              textAlignVertical="top"
              autoFocus
            />
          </View>

          <View style={styles.modalActions}>
            <Pressable
              onPress={onClose}
              disabled={saving}
              style={({ pressed }) => [
                styles.modalButton,
                styles.modalButtonSecondary,
                {
                  backgroundColor: theme.secondaryCardBackground,
                  borderColor: theme.border,
                },
                pressed && styles.modalButtonPressed,
              ]}
            >
              <AppText style={styles.modalButtonSecondaryText}>取消</AppText>
            </Pressable>
            <Pressable
              onPress={() => onSubmit(value)}
              disabled={saving || !value.trim()}
              style={({ pressed }) => [
                styles.modalButton,
                styles.modalButtonPrimary,
                {
                  backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
                },
                (saving || !value.trim()) && styles.modalButtonDisabled,
                pressed && !saving && value.trim() && styles.modalButtonPressed,
              ]}
            >
              <AppText style={styles.modalButtonPrimaryText}>{saving ? '保存中…' : '保存修改'}</AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function NotesScreen() {
  const session = useAppSession();
  const { theme } = useAppTheme();
  const [notes, setNotes] = useState<SentenceNoteWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<SentenceNoteWithDetails | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const isLoggedIn = session.status === 'authenticated';
  const sessionExpired = session.authStateReason === 'expired';

  const load = useCallback(async () => {
    if (!session.session) return;
    setLoading(true);
    setError(null);
    try {
      setNotes(await fetchUserNotesWithDetails(session.session));
    } catch (err) {
      if (isExpiredSessionError(err)) {
        setNotes([]);
        await session.invalidateSession();
        return;
      }
      setError(toFriendlyNotesError(err));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (sessionExpired) {
      setNotes([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (isLoggedIn) {
      void load();
    } else {
      setNotes([]);
      setError(null);
      setLoading(false);
    }
  }, [isLoggedIn, load, sessionExpired]);

  const episodeCount = useMemo(
    () => new Set(notes.map((note) => note.episode?.id ?? note.episode_id)).size,
    [notes],
  );
  const latestUpdatedAt = notes[0]?.updated_at ?? null;
  const latestUpdatedLabel = latestUpdatedAt ? formatDateTime(latestUpdatedAt) : '还没有更新记录';

  const handleDelete = useCallback(
    (note: SentenceNoteWithDetails) => {
      const currentSession = session.session;
      if (!currentSession) return;

      Alert.alert('删除笔记', '删除后不可恢复，确定要删除这条笔记吗？', [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingId(note.id);
              setError(null);
              try {
                await deleteNote(currentSession, note.id);
                setNotes((prev) => prev.filter((item) => item.id !== note.id));
                if (editingNote?.id === note.id) {
                  setEditingNote(null);
                }
              } catch (err) {
                if (isExpiredSessionError(err)) {
                  setNotes([]);
                  await session.invalidateSession();
                  return;
                }
                setError(toFriendlyNotesError(err));
              } finally {
                setDeletingId(null);
              }
            })();
          },
        },
      ]);
    },
    [editingNote?.id, session.session],
  );

  const handleSaveEdit = useCallback(
    async (nextValue: string) => {
      const currentSession = session.session;
      if (!currentSession || !editingNote) return;
      const trimmed = nextValue.trim();
      if (!trimmed) {
        Alert.alert('笔记内容不能为空', '请先输入内容，再保存修改。');
        return;
      }

      setSavingEdit(true);
      setError(null);
      try {
        const updated = await updateNote(currentSession, editingNote.id, trimmed);
        setNotes((prev) =>
          prev.map((item) =>
            item.id === editingNote.id
              ? {
                  ...item,
                  note: updated.note,
                  updated_at: updated.updated_at,
                }
              : item,
          ),
        );
        setEditingNote(null);
      } catch (err) {
        if (isExpiredSessionError(err)) {
          setEditingNote(null);
          setNotes([]);
          await session.invalidateSession();
          return;
        }
        setError(toFriendlyNotesError(err));
      } finally {
        setSavingEdit(false);
      }
    },
    [editingNote, session],
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.backRow}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my')} accessibilityLabel="返回我的" />
      </View>
    </View>
  );

  if (!isLoggedIn && !sessionExpired) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <SurfaceCard style={{ padding: 20 }}>
          <AppText style={styles.authTitle}>登录后查看你的全部句子笔记</AppText>
          <AppText style={styles.authSubtitle}>
            登录后可以集中查看你保存的句子笔记，并从笔记回到原句继续学习。
          </AppText>
          <Pressable
            onPress={() => router.push('/auth/sign-in')}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
              },
              pressed && styles.pressed,
            ]}
          >
            <AppText style={styles.primaryButtonText}>去登录</AppText>
          </Pressable>
        </SurfaceCard>
      </AppScreenShell>
    );
  }

  if (sessionExpired) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <SurfaceCard style={{ padding: 20 }}>
          <EmptyState
            icon="shield-checkmark-outline"
            title="登录状态已失效"
            subtitle="请重新登录后查看你的笔记。"
          />
          <View style={styles.expiredActions}>
            <Pressable
              onPress={() => router.push('/auth/sign-in')}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.primaryButtonText}>去登录</AppText>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  backgroundColor: theme.secondaryCardBackground,
                  borderColor: theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.secondaryButtonText}>返回我的</AppText>
            </Pressable>
          </View>
        </SurfaceCard>
      </AppScreenShell>
    );
  }

  return (
    <>
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false} headerScrollFade>
        <SurfaceCard style={styles.overviewCard}>
          <View style={styles.overviewHeader}>
            <View style={{ flex: 1, gap: 6 }}>
              <AppText style={styles.overviewEyebrow}>笔记总览</AppText>
              <AppText style={styles.overviewTitle}>当前账户下的全部句子笔记</AppText>
              <AppText style={styles.overviewSubtitle}>你添加的句子笔记会按最近更新排列，方便随时回顾。</AppText>
            </View>
            <View
              style={[
                styles.overviewBadge,
                {
                  backgroundColor: theme.fillTertiary,
                  borderColor: theme.border,
                },
              ]}
            >
              <Ionicons name="document-text-outline" size={18} color={theme.textPrimary} />
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingOverview}>
              <ActivityIndicator size="small" color={TEXT_SECONDARY} />
              <AppText style={styles.loadingText}>正在加载笔记数据…</AppText>
            </View>
          ) : (
            <>
              <View style={[styles.metricRow, { borderTopColor: theme.border }]}>
                <OverviewMetric label="笔记条数" value={notes.length} note="当前账户累计保留" />
                <OverviewMetric label="涉及单集" value={episodeCount} note="分布到的精听单集数" />
                <OverviewMetric
                  label="最近更新"
                  value={notes.length ? latestUpdatedLabel.slice(5, 10).replace('-', '.') : '暂无'}
                  note={notes.length ? latestUpdatedLabel : '添加第一条笔记后会显示'}
                />
              </View>

              <View style={styles.overviewFootnote}>
                <Ionicons name="time-outline" size={14} color={TEXT_SECONDARY} />
                <AppText style={styles.overviewFootnoteText}>
                  {notes.length ? `最近一条更新于 ${latestUpdatedLabel}` : '还没有句子笔记，去单集页记录你的第一条学习笔记。'}
                </AppText>
              </View>
            </>
          )}
        </SurfaceCard>

        <SurfaceCard style={styles.listCard}>
          <SectionHeader
            title="全部笔记"
            subtitle={
              loading
                ? '正在同步笔记列表…'
                : notes.length > 0
                  ? `共 ${notes.length} 条，支持回到原句、编辑与删除。`
                  : '在精听页面给句子添加笔记后，会集中显示在这里。'
            }
          />

          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="small" color={TEXT_SECONDARY} />
              <AppText style={styles.loadingText}>加载中…</AppText>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <EmptyState icon="alert-circle-outline" title="笔记数据暂时不可用" subtitle={error} />
              <Pressable
                onPress={() => void load()}
                style={({ pressed }) => [
                  styles.retryButton,
                  {
                    backgroundColor: theme.secondaryCardBackground,
                    borderColor: theme.border,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <AppText style={styles.retryButtonText}>重试</AppText>
              </Pressable>
            </View>
          ) : notes.length === 0 ? (
            <View style={styles.emptyCard}>
              <EmptyState
                icon="create-outline"
                title="暂无句子笔记"
                subtitle="在精听页面给句子添加笔记后，会集中显示在这里，并保留来源单集和回到原句的路径。"
              />
            </View>
          ) : (
            <View style={styles.notesStack}>
              {notes.map((note) => (
                <View key={note.id} style={styles.noteCard}>
                  <View style={styles.noteHeaderRow}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <AppText style={styles.noteTitle}>{note.note}</AppText>
                      <AppText style={styles.noteUpdatedText}>更新于 {formatDateTime(note.updated_at)}</AppText>
                    </View>
                    <View style={styles.noteMetaPill}>
                      <Ionicons name="bookmark-outline" size={12} color={ACCENT} />
                      <AppText style={styles.noteMetaPillText}>句子笔记</AppText>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.quoteBlock,
                      {
                        backgroundColor: theme.secondaryCardBackground,
                      },
                    ]}
                  >
                    <AppText style={styles.quoteEnglish}>{note.sentence?.en ?? `句子 #${note.sentence_id}`}</AppText>
                    {note.sentence?.zh ? (
                      <AppText style={[styles.quoteChinese, { color: theme.textSecondary }]}>{note.sentence.zh}</AppText>
                    ) : null}
                  </View>

                  <View style={styles.noteMetaRow}>
                    <View style={styles.metaItem}>
                      <Ionicons name="headset-outline" size={14} color={TEXT_SECONDARY} />
                      <AppText style={styles.metaText}>{buildEpisodeMeta(note)}</AppText>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="return-up-forward-outline" size={14} color={TEXT_SECONDARY} />
                      <AppText style={styles.metaText}>可直接定位回原句</AppText>
                    </View>
                  </View>

                  <View style={styles.noteActionsRow}>
                    <NoteAction
                      icon="play-circle-outline"
                      label={note.sentence ? '回到原句' : '进入单集'}
                      onPress={() => openEpisodeTarget(note.episode_id, note.sentence?.id ?? note.sentence_id)}
                    />
                    <NoteAction icon="create-outline" label="编辑" onPress={() => setEditingNote(note)} />
                    <NoteAction
                      icon="trash-outline"
                      label={deletingId === note.id ? '删除中…' : '删除'}
                      destructive
                      disabled={deletingId === note.id}
                      onPress={() => handleDelete(note)}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </SurfaceCard>

        {!loading && !error ? (
          <View style={styles.privacyNote}>
            <Ionicons name="lock-closed-outline" size={14} color={TEXT_SECONDARY} />
            <AppText style={styles.privacyNoteText}>笔记仅对当前账户可见，不会对外公开。</AppText>
          </View>
        ) : null}

        {error && notes.length > 0 ? <AppText style={styles.inlineError}>{error}</AppText> : null}
      </AppScreenShell>

      <NoteEditorModal
        visible={editingNote != null}
        initialValue={editingNote?.note ?? ''}
        saving={savingEdit}
        onClose={() => {
          if (!savingEdit) setEditingNote(null);
        }}
        onSubmit={(nextValue) => {
          void handleSaveEdit(nextValue);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 30,
    gap: 12,
  },
  header: {
    paddingTop: 4,
    paddingBottom: 0,
  },
  backRow: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 2,
    paddingBottom: 4,
  },
  authTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: TEXT_PRIMARY,
  },
  authSubtitle: {
    marginTop: 8,
    fontSize: FONT_BODY,
    lineHeight: 22,
    color: TEXT_SECONDARY,
  },
  expiredActions: {
    marginTop: 18,
    gap: 10,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEXT_PRIMARY,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  overviewCard: {
    padding: 22,
  },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  overviewEyebrow: {
    fontSize: FONT_MICRO,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: TEXT_TERTIARY,
  },
  overviewTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: TEXT_PRIMARY,
  },
  overviewSubtitle: {
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  overviewBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  loadingOverview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 92,
    paddingTop: 26,
  },
  loadingText: {
    fontSize: FONT_BODY,
    color: TEXT_SECONDARY,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 0.5,
  },
  metricCard: {
    flex: 1,
    minHeight: 120,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 16,
    borderWidth: 0.5,
    gap: 8,
  },
  metricLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  metricValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
  },
  metricNote: {
    marginTop: 'auto',
    fontSize: FONT_CAPTION,
    lineHeight: 17,
  },
  overviewFootnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: BORDER_SOFT,
  },
  overviewFootnoteText: {
    flex: 1,
    fontSize: FONT_CAPTION,
    lineHeight: 17,
    color: TEXT_SECONDARY,
  },
  listCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: FONT_CALLOUT,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  centerState: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  retryButton: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 0.5,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: FONT_CALLOUT,
    lineHeight: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  emptyCard: {
    paddingVertical: 6,
  },
  emptyState: {
    minHeight: 184,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: BG_CARD_SOFT,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  emptyIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: TEXT_PRIMARY,
  },
  emptySubtitle: {
    maxWidth: 290,
    fontSize: FONT_CALLOUT,
    lineHeight: 20,
    textAlign: 'center',
    color: TEXT_SECONDARY,
  },
  notesStack: {
    gap: 16,
  },
  noteCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
    gap: 14,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  noteTitle: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: TEXT_PRIMARY,
  },
  noteUpdatedText: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  noteMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
  noteMetaPillText: {
    fontSize: FONT_MICRO,
    lineHeight: 12,
    fontWeight: '700',
    color: ACCENT,
  },
  quoteBlock: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  quoteEnglish: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  quoteChinese: {
    fontSize: FONT_CALLOUT,
    lineHeight: 20,
    color: 'rgba(28,28,30,0.62)',
  },
  noteMetaRow: {
    gap: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    flex: 1,
    fontSize: FONT_CAPTION,
    lineHeight: 17,
    color: TEXT_SECONDARY,
  },
  noteActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  noteAction: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    borderWidth: 0.5,
  },
  noteActionDestructive: {
  },
  noteActionDisabled: {
    opacity: 0.52,
  },
  noteActionPressed: {
    opacity: 0.7,
  },
  noteActionLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  noteActionLabelDestructive: {
    color: COLOR_RED,
  },
  privacyNote: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  privacyNoteText: {
    flex: 1,
    fontSize: FONT_CAPTION,
    lineHeight: 17,
    color: TEXT_SECONDARY,
  },
  inlineError: {
    marginTop: 10,
    fontSize: FONT_CAPTION,
    lineHeight: 17,
    color: COLOR_RED,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.24)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 24,
    backgroundColor: BG_PAGE,
    padding: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  modalSubtitle: {
    marginTop: 6,
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  editorWrap: {
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  editorInput: {
    minHeight: 132,
    fontSize: FONT_BODY,
    lineHeight: 22,
    color: TEXT_PRIMARY,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  modalButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonSecondary: {
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  modalButtonPrimary: {
    backgroundColor: TEXT_PRIMARY,
  },
  modalButtonDisabled: {
    opacity: 0.45,
  },
  modalButtonPressed: {
    opacity: 0.74,
  },
  modalButtonSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  modalButtonPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.74,
  },
});
