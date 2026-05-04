import { env, hasSupabaseEnv } from '@/lib/env';
import type { Episode, EpisodeDetailSnapshot, PhraseCard, Sentence } from '@/types/echolingo';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

type SnapshotResponse = {
  metadata: {
    id: string;
    title: string;
    cover: string;
    duration: string;
    difficulty: string;
    difficulty_stars?: number | null;
    voice?: string | null;
    tags?: string[];
    issue_number?: number | null;
    display_issue_number?: number | null;
    accent?: string;
    category?: string;
    description?: string;
    video_source?: string | null;
    video_url_r2?: string | null;
  };
  transcript: Array<{
    id: number;
    start: number;
    end: number;
    en: string;
    zh: string;
    highlight?: string[] | null;
    phonetic?: string | null;
  }>;
};

type PhraseCardRow = {
  id: string | number;
  phrase: string;
  tag: string;
  zh: string;
  sentence_id: number | null;
  type?: string | null;
  phonetic?: string | null;
  definition?: string | null;
  example?: string | null;
  example_zh?: string | null;
  context_en?: string | null;
  context_zh?: string | null;
  start?: number | null;
  end?: number | null;
  exam_tags?: string[] | null;
};

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const json = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return json;
}

function normalizeEpisode(metadata: SnapshotResponse['metadata']): Episode {
  return {
    id: metadata.id,
    title: metadata.title,
    cover: metadata.cover,
    duration: metadata.duration,
    difficulty: metadata.difficulty || 'Intermediate',
    tags: metadata.tags || [],
    description: metadata.description || undefined,
    accent: metadata.accent || undefined,
    voice: metadata.voice || undefined,
    issue_number: metadata.issue_number ?? null,
    display_issue_number: metadata.display_issue_number ?? null,
    video_source: metadata.video_source || undefined,
    video_url_r2: metadata.video_url_r2 || undefined,
  };
}

function normalizeSentences(rows: SnapshotResponse['transcript']): Sentence[] {
  return rows.map((item) => ({
    id: item.id,
    start: item.start,
    end: item.end,
    en: item.en || '',
    zh: item.zh || '',
    highlight: item.highlight || [],
    phonetic: item.phonetic || null,
  }));
}

function normalizePhraseCards(rows: PhraseCardRow[]): PhraseCard[] {
  return rows.map((item) => ({
    id: item.id,
    key: `${item.phrase}-${item.id}`,
    phrase: item.phrase,
    tag: item.tag,
    zh: item.zh,
    sentenceId: item.sentence_id ?? 0,
    type: item.type ?? undefined,
    phonetic: item.phonetic ?? undefined,
    definition: item.definition ?? undefined,
    example: item.example ?? undefined,
    exampleZh: item.example_zh ?? undefined,
    contextEn: item.context_en ?? undefined,
    contextZh: item.context_zh ?? undefined,
    start: item.start ?? undefined,
    end: item.end ?? undefined,
    exam_tags: item.exam_tags ?? undefined,
  }));
}

function resolveVideoSrc(episode: Episode) {
  const raw = episode.video_url_r2?.trim();
  if (raw) {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
  }

  if (episode.video_source === 'r2') {
    return `${env.mediaDomain.replace(/\/$/, '')}/videos/${episode.id}.mp4`;
  }

  return `${env.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/episode-videos/${episode.id}.mp4`;
}

export async function fetchEpisodeSnapshot(id: string): Promise<SnapshotResponse> {
  const response = await fetchJson<ApiResponse<SnapshotResponse>>(
    `${env.apiBaseUrl}/api/v2/episode/${id}/snapshot`,
    { headers: { Accept: 'application/json' } },
  );

  if (!response.success || !response.data) {
    throw new Error(response.error || 'EPISODE_SNAPSHOT_FAILED');
  }

  return response.data;
}

export async function fetchEpisodePhraseCards(id: string): Promise<PhraseCard[]> {
  if (!hasSupabaseEnv) {
    return [];
  }

  const url = `${env.supabaseUrl}/rest/v1/phrase_cards?episode_id=eq.${encodeURIComponent(id)}&select=id,phrase,tag,zh,sentence_id,type,phonetic,definition,example,example_zh,context_en,context_zh,start,end,exam_tags&order=id.asc`;
  const rows = await fetchJson<PhraseCardRow[]>(url, {
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
      Accept: 'application/json',
    },
  });

  return normalizePhraseCards(rows);
}

export async function fetchEpisodeDetail(id: string): Promise<EpisodeDetailSnapshot> {
  // Parallel-fetch snapshot + phrase cards. Previously these ran sequentially
  // (~2 round-trips of latency), now they run concurrently. Phrase-card
  // failures are non-fatal — the page still works, highlights just lose
  // their dictionary popups.
  const [snapshot, phraseCardsResult] = await Promise.all([
    fetchEpisodeSnapshot(id),
    fetchEpisodePhraseCards(id).catch(() => [] as PhraseCard[]),
  ]);

  const episode = normalizeEpisode(snapshot.metadata);
  const sentences = normalizeSentences(snapshot.transcript);

  return {
    episode,
    sentences,
    phraseCards: phraseCardsResult,
    videoSrc: resolveVideoSrc(episode),
  };
}
