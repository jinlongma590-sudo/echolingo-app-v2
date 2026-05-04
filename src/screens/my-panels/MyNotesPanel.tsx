import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import {
  deleteNote,
  fetchUserNotesWithDetails,
  updateNote,
  type SentenceNoteWithDetails,
} from '@/services/api/sentenceNotes';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.12 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 2,
  } as const;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

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

export function MyNotesPanel() {
  const { theme } = useAppTheme();
  const session = useAppSession();
  const [notes, setNotes] = useState<SentenceNoteWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [statusText, setStatusText] = useState<string | null>(null);

  async function load() {
    if (!session.session || session.status !== 'authenticated') return;
    setLoading(true);
    setErrorText(null);
    try {
      const data = await fetchUserNotesWithDetails(session.session);
      setNotes(data);
      if (data.length > 0 && !selectedNoteId) {
        setSelectedNoteId(data[0].id);
        setEditorValue(data[0].note);
      }
    } catch (error) {
      setNotes([]);
      setErrorText(isExpiredSessionError(error) ? '登录状态已失效，请重新登录后重试。' : '笔记数据暂时不可用，请稍后再试。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session, session.status]);

  const selectedNote = useMemo(
    () => notes.find((item) => item.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  useEffect(() => {
    if (selectedNote) {
      setEditorValue(selectedNote.note);
    }
  }, [selectedNote]);

  async function handleSave() {
    if (!session.session || !selectedNote) return;
    setSaving(true);
    setStatusText(null);
    try {
      await updateNote(session.session, selectedNote.id, editorValue);
      setStatusText('笔记已保存');
      await load();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '笔记保存失败');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!session.session || !selectedNote) return;
    Alert.alert('删除笔记', '删除后将无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteNote(session.session!, selectedNote.id);
              setStatusText('笔记已删除');
              setSelectedNoteId(null);
              setEditorValue('');
              await load();
            } catch (error) {
              setStatusText(error instanceof Error ? error.message : '删除失败');
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>我的笔记</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          复盘精听过程中的重点句子
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View
          style={[
            styles.listCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor),
            },
          ]}
        >
          {session.status !== 'authenticated' || !session.session ? (
            <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>登录后可查看和编辑最近笔记。</AppText>
          ) : loading ? (
            <ActivityIndicator color={theme.primaryBlue} />
          ) : errorText ? (
            <View style={styles.errorState}>
              <AppText style={[styles.emptyText, { color: theme.destructive }]}>{errorText}</AppText>
              <Pressable
                onPress={() => void load()}
                style={({ pressed }) => [
                  styles.retryButton,
                  { backgroundColor: theme.fillSecondary, borderColor: theme.border },
                  pressed && styles.cardPressed,
                ]}
              >
                <AppText style={[styles.retryButtonText, { color: theme.textPrimary }]}>重试</AppText>
              </Pressable>
            </View>
          ) : notes.length === 0 ? (
            <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>暂时还没有笔记内容。</AppText>
          ) : (
            <View style={styles.noteList}>
              {notes.slice(0, 5).map((note) => {
                const active = selectedNoteId === note.id;
                return (
                  <Pressable
                    key={note.id}
                    onPress={() => setSelectedNoteId(note.id)}
                    style={({ pressed }) => [
                      styles.noteCard,
                      {
                        backgroundColor: active
                          ? 'rgba(10,132,255,0.10)'
                          : theme.colorScheme === 'dark'
                            ? theme.secondaryCardBackground
                            : 'rgba(248,250,252,0.78)',
                        borderColor: active ? 'rgba(10,132,255,0.18)' : 'rgba(15,23,42,0.08)',
                      },
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <View style={styles.noteHeadRow}>
                      <AppText style={[styles.noteEpisodeTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                        {note.episode?.title ?? `单集 ${note.episode_id}`}
                      </AppText>
                      <AppText style={[styles.noteTime, { color: theme.textSecondary }]}>{formatDateTime(note.updated_at)}</AppText>
                    </View>
                    <AppText style={[styles.noteSentence, { color: theme.textPrimary }]} numberOfLines={2}>
                      {note.sentence?.en ?? '句子内容暂不可用'}
                    </AppText>
                    <AppText style={[styles.noteContent, { color: theme.textSecondary }]} numberOfLines={1}>
                      {note.note}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {selectedNote ? (
          <View
            style={[
              styles.detailCard,
              {
                backgroundColor: theme.cardBackground,
                borderColor: 'rgba(15,23,42,0.08)',
                ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
              },
            ]}
          >
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/episode/[id]',
                  params: { id: selectedNote.episode_id, sentence: String(selectedNote.sentence_id) },
                })
              }
            >
              <AppText style={[styles.detailTitle, { color: theme.primaryBlue }]}>{selectedNote.episode?.title ?? selectedNote.episode_id}</AppText>
            </Pressable>
            <AppText style={[styles.detailSentence, { color: theme.textPrimary }]}>
              {selectedNote.sentence?.en ?? '句子内容暂不可用'}
            </AppText>
            <AppText style={[styles.detailMeta, { color: theme.textSecondary }]}>
              最近更新 {formatDateTime(selectedNote.updated_at)}
            </AppText>
            <View
              style={[
                styles.editorWrap,
                {
                  backgroundColor:
                    theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                  borderColor: 'rgba(15,23,42,0.08)',
                },
              ]}
            >
              <TextInput
                value={editorValue}
                onChangeText={setEditorValue}
                multiline
                style={[styles.editorInput, { color: theme.textPrimary }]}
                placeholder="编辑笔记内容"
                placeholderTextColor={theme.textSecondary}
              />
            </View>
            {statusText ? (
              <AppText style={[styles.statusText, { color: statusText.includes('失败') ? theme.destructive : '#34C759' }]}>
                {statusText}
              </AppText>
            ) : null}
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => void handleSave()}
                disabled={saving}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primaryBlue },
                  pressed && !saving && styles.cardPressed,
                ]}
              >
                <AppText style={styles.primaryButtonText}>{saving ? '保存中…' : '保存笔记'}</AppText>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: 'rgba(255,69,58,0.24)', backgroundColor: 'rgba(255,69,58,0.08)' },
                  pressed && styles.cardPressed,
                ]}
              >
                <AppText style={styles.secondaryButtonText}>删除</AppText>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 0 },
  panelHeader: { marginBottom: 14 },
  panelTitle: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.35 },
  panelSubtitle: { marginTop: 4, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  panelContent: { gap: 12 },
  listCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  emptyText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  errorState: { gap: 12, alignItems: 'flex-start' },
  retryButton: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: { fontSize: 13, lineHeight: 17, fontWeight: '700' },
  noteList: { gap: 10 },
  noteCard: {
    height: 92,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  noteHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noteEpisodeTitle: { flex: 1, fontSize: 15, lineHeight: 19, fontWeight: '800' },
  noteTime: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  noteSentence: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  noteContent: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  detailCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  detailTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
  detailSentence: { marginTop: 10, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  detailMeta: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  editorWrap: {
    marginTop: 14,
    minHeight: 120,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  editorInput: { minHeight: 92, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlignVertical: 'top' },
  statusText: { marginTop: 10, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  actionRow: { marginTop: 14, flexDirection: 'row', gap: 10 },
  primaryButton: { flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FFFFFF' },
  secondaryButton: { width: 88, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FF453A' },
  cardPressed: { opacity: 0.84 },
});
