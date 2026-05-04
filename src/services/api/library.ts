import { env } from '@/lib/env';
import type { EpisodeStub } from '@/types/echolingo';
import { normalizeCoverUrl } from '@/utils/mediaUrl';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

type LibraryResponse = {
  items: EpisodeStub[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type LibraryEpisodesResult = LibraryResponse;

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  const json = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return json;
}

export async function fetchLibraryEpisodes(
  page = 1,
  pageSize = 24,
): Promise<LibraryEpisodesResult> {
  const response = await fetchJson<ApiResponse<LibraryResponse>>(
    `${env.apiBaseUrl}/api/v2/library?page=${page}&pageSize=${pageSize}`,
  );

  if (!response.success || !response.data) {
    throw new Error(response.error || 'LIBRARY_FETCH_FAILED');
  }

  return {
    ...response.data,
    items: response.data.items.map((item) => ({
      ...item,
      cover: normalizeCoverUrl(item.cover) ?? item.cover,
    })),
  };
}
