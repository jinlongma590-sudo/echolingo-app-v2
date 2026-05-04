import { env } from '@/lib/env';
import {
  fetchEpisodesByIds,
  fetchSentencesByIds,
  type EpisodeLookup,
  type SentenceLookup,
} from '@/services/api/contentLookup';
import type { StoredSession } from '@/types/auth';
import { buildSupabaseUrl, supabaseFetchJson } from '@/services/supabase/rest';

const USER_NOTES_TIMEOUT_MS = 12000;

export interface SentenceNote {
  id: string;
  user_id: string;
  sentence_id: number;
  episode_id: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface SentenceNoteWithDetails extends SentenceNote {
  sentence: SentenceLookup | null;
  episode: EpisodeLookup | null;
}

function withNotesTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = USER_NOTES_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

export async function fetchUserNotes(session: StoredSession): Promise<SentenceNote[]> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  const request = supabaseFetchJson<SentenceNote[]>(
    `/rest/v1/sentence_notes?select=*&user_id=eq.${userId}&order=updated_at.desc&limit=100`,
    undefined,
    session.accessToken,
  );

  return withNotesTimeout(request, []);
}

export async function fetchUserNotesWithDetails(session: StoredSession): Promise<SentenceNoteWithDetails[]> {
  const notes = await fetchUserNotes(session);
  if (notes.length === 0) {
    return [];
  }

  const [sentenceRows, episodeRows] = await Promise.all([
    withNotesTimeout(
      fetchSentencesByIds(session.accessToken, Array.from(new Set(notes.map((note) => note.sentence_id)))),
      new Map<number, SentenceLookup>(),
    ),
    withNotesTimeout(
      fetchEpisodesByIds(session.accessToken, Array.from(new Set(notes.map((note) => note.episode_id)))),
      new Map<string, EpisodeLookup>(),
    ),
  ]);

  return notes.map((note) => ({
    ...note,
    sentence: sentenceRows.get(note.sentence_id) ?? null,
    episode: episodeRows.get(note.episode_id) ?? null,
  }));
}

export async function fetchNotesForSentence(session: StoredSession, sentenceId: number): Promise<SentenceNote[]> {
  const userId = session.user?.id;
  if (!userId) return [];

  return supabaseFetchJson<SentenceNote[]>(
    `/rest/v1/sentence_notes?select=*&user_id=eq.${userId}&sentence_id=eq.${sentenceId}&order=updated_at.desc`,
    undefined,
    session.accessToken,
  ).catch(() => []);
}

export async function addNote(
  session: StoredSession,
  sentenceId: number,
  episodeId: string,
  note: string,
): Promise<SentenceNote> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  const response = await fetch(buildSupabaseUrl('/rest/v1/sentence_notes'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ user_id: userId, sentence_id: sentenceId, episode_id: episodeId, note }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '添加笔记失败');
  }

  const data = (await response.json()) as SentenceNote[];
  return data[0];
}

export async function updateNote(
  session: StoredSession,
  noteId: string,
  note: string,
): Promise<SentenceNote> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  const response = await fetch(
    buildSupabaseUrl(`/rest/v1/sentence_notes?id=eq.${noteId}&user_id=eq.${userId}`),
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ note }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '更新笔记失败');
  }

  const data = (await response.json()) as SentenceNote[];
  return data[0];
}

export async function deleteNote(session: StoredSession, noteId: string): Promise<void> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  const response = await fetch(
    buildSupabaseUrl(`/rest/v1/sentence_notes?id=eq.${noteId}&user_id=eq.${userId}`),
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '删除笔记失败');
  }
}
