import { supabaseFetchJson } from '@/services/supabase/rest';
import { normalizeCoverUrl } from '@/utils/mediaUrl';

export interface EpisodeLookup {
  id: string;
  title: string;
  cover: string | null;
  duration: string;
  difficulty: string;
}

export interface SentenceLookup {
  id: number;
  episode_id: string;
  start: number;
  end: number;
  en: string;
  zh: string;
}

export interface PhraseCardLookup {
  id: string;
  episode_id: string;
  sentence_id: number | null;
  phrase: string;
  tag: string;
  zh: string;
}

function buildQuotedInParam(ids: string[]) {
  return `(${ids.map((id) => `"${id}"`).join(',')})`;
}

function buildNumberInParam(ids: number[]) {
  return `(${ids.join(',')})`;
}

export async function fetchEpisodesByIds(accessToken: string, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, EpisodeLookup>();
  }

  const rows = await supabaseFetchJson<EpisodeLookup[]>(
    `/rest/v1/episodes?select=id,title,cover,duration,difficulty&id=in.${buildQuotedInParam(uniqueIds)}&limit=${uniqueIds.length}`,
    undefined,
    accessToken,
  ).catch(() => [] as EpisodeLookup[]);

  return new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        cover: normalizeCoverUrl(row.cover),
      },
    ]),
  );
}

export async function fetchSentencesByIds(accessToken: string, ids: number[]) {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) {
    return new Map<number, SentenceLookup>();
  }

  const rows = await supabaseFetchJson<SentenceLookup[]>(
    `/rest/v1/sentences?select=id,episode_id,start,end,en,zh&id=in.${buildNumberInParam(uniqueIds)}&limit=${uniqueIds.length}`,
    undefined,
    accessToken,
  ).catch(() => [] as SentenceLookup[]);

  return new Map(rows.map((row) => [row.id, row]));
}

export async function fetchSentencesByEpisodeIds(accessToken: string, episodeIds: string[]) {
  const uniqueEpisodeIds = Array.from(new Set(episodeIds.filter(Boolean)));
  if (uniqueEpisodeIds.length === 0) {
    return [] as SentenceLookup[];
  }

  return supabaseFetchJson<SentenceLookup[]>(
    `/rest/v1/sentences?select=id,episode_id,start,end,en,zh&episode_id=in.${buildQuotedInParam(uniqueEpisodeIds)}&limit=5000`,
    undefined,
    accessToken,
  ).catch(() => [] as SentenceLookup[]);
}

export async function fetchPhraseCardsByIds(accessToken: string, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, PhraseCardLookup>();
  }

  const rows = await supabaseFetchJson<PhraseCardLookup[]>(
    `/rest/v1/phrase_cards?select=id,episode_id,sentence_id,phrase,tag,zh&id=in.${buildQuotedInParam(uniqueIds)}&limit=${uniqueIds.length}`,
    undefined,
    accessToken,
  ).catch(() => [] as PhraseCardLookup[]);

  return new Map(rows.map((row) => [String(row.id), { ...row, id: String(row.id) }]));
}
