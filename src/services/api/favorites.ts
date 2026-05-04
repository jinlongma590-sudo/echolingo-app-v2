import { env } from '@/lib/env';
import {
  fetchEpisodesByIds,
  fetchPhraseCardsByIds,
  fetchSentencesByIds,
  type EpisodeLookup,
  type PhraseCardLookup,
  type SentenceLookup,
} from '@/services/api/contentLookup';
import type { StoredSession } from '@/types/auth';
import { buildSupabaseUrl, supabaseFetchJson } from '@/services/supabase/rest';

export type FavoriteType = 'episode' | 'sentence' | 'phrase';

export interface FavoriteItem {
  id: number;
  user_id: string;
  target_type: FavoriteType;
  target_id: string;
  created_at: string;
}

export interface FavoriteSentenceDetail {
  sentence: SentenceLookup | null;
  episode: EpisodeLookup | null;
}

export interface FavoritePhraseDetail {
  phrase: PhraseCardLookup | null;
  sentence: SentenceLookup | null;
  episode: EpisodeLookup | null;
}

export interface FavoriteDetailsBundle {
  episodes: Map<string, EpisodeLookup>;
  sentences: Map<string, FavoriteSentenceDetail>;
  phrases: Map<string, FavoritePhraseDetail>;
}

export async function fetchUserFavorites(session: StoredSession, targetType?: FavoriteType): Promise<FavoriteItem[]> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  let url = `/rest/v1/favorites?select=id,user_id,target_type,target_id,created_at&user_id=eq.${userId}&order=created_at.desc&limit=100`;
  if (targetType) url += `&target_type=eq.${targetType}`;

  return supabaseFetchJson<FavoriteItem[]>(url, undefined, session.accessToken);
}

export async function fetchFavoriteDetails(
  session: StoredSession,
  favorites: FavoriteItem[],
): Promise<FavoriteDetailsBundle> {
  const episodeFavorites = favorites.filter((item) => item.target_type === 'episode');
  const sentenceFavorites = favorites.filter((item) => item.target_type === 'sentence');
  const phraseFavorites = favorites.filter((item) => item.target_type === 'phrase');

  const episodes = await fetchEpisodesByIds(
    session.accessToken,
    episodeFavorites.map((item) => item.target_id),
  );

  const sentenceRows = await fetchSentencesByIds(
    session.accessToken,
    sentenceFavorites
      .map((item) => Number(item.target_id))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  const sentenceEpisodes = await fetchEpisodesByIds(
    session.accessToken,
    Array.from(new Set(Array.from(sentenceRows.values()).map((row) => row.episode_id))),
  );
  const sentences = new Map<string, FavoriteSentenceDetail>();
  sentenceFavorites.forEach((item) => {
    const sentence = sentenceRows.get(Number(item.target_id)) ?? null;
    const episode = sentence ? sentenceEpisodes.get(sentence.episode_id) ?? null : null;
    sentences.set(item.target_id, { sentence, episode });
  });

  const phraseRows = await fetchPhraseCardsByIds(
    session.accessToken,
    phraseFavorites.map((item) => item.target_id),
  );
  const phraseSentenceRows = await fetchSentencesByIds(
    session.accessToken,
    Array.from(new Set(Array.from(phraseRows.values()).map((row) => row.sentence_id ?? 0).filter((value) => value > 0))),
  );
  const phraseEpisodes = await fetchEpisodesByIds(
    session.accessToken,
    Array.from(
      new Set(
        Array.from(phraseRows.values())
          .map((row) => row.episode_id)
          .filter(Boolean),
      ),
    ),
  );
  const phrases = new Map<string, FavoritePhraseDetail>();
  phraseFavorites.forEach((item) => {
    const phrase = phraseRows.get(item.target_id) ?? null;
    const sentence = phrase?.sentence_id ? phraseSentenceRows.get(phrase.sentence_id) ?? null : null;
    const episode = phrase ? phraseEpisodes.get(phrase.episode_id) ?? null : null;
    phrases.set(item.target_id, { phrase, sentence, episode });
  });

  return {
    episodes,
    sentences,
    phrases,
  };
}

export async function addFavorite(
  session: StoredSession,
  targetType: FavoriteType,
  targetId: string,
): Promise<FavoriteItem> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  const response = await fetch(buildSupabaseUrl('/rest/v1/favorites'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ user_id: userId, target_type: targetType, target_id: targetId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '收藏失败');
  }

  const data = (await response.json()) as FavoriteItem[];
  return data[0];
}

export async function removeFavoriteByTarget(
  session: StoredSession,
  targetType: FavoriteType,
  targetId: string,
): Promise<void> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  const response = await fetch(
    buildSupabaseUrl(`/rest/v1/favorites?user_id=eq.${userId}&target_type=eq.${targetType}&target_id=eq.${encodeURIComponent(targetId)}`),
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
    throw new Error(text || '取消收藏失败');
  }
}

export async function checkFavorite(
  session: StoredSession,
  targetType: FavoriteType,
  targetId: string,
): Promise<boolean> {
  const userId = session.user?.id;
  if (!userId) return false;

  const items = await supabaseFetchJson<FavoriteItem[]>(
    `/rest/v1/favorites?select=id&user_id=eq.${userId}&target_type=eq.${targetType}&target_id=eq.${encodeURIComponent(targetId)}&limit=1`,
    undefined,
    session.accessToken,
  ).catch(() => [] as FavoriteItem[]);

  return items.length > 0;
}
