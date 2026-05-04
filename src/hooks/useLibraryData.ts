import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchLibraryEpisodes } from '@/services/api/library';
import type { EpisodeStub } from '@/types/echolingo';
import type { LibraryEpisodesResult } from '@/services/api/library';

const INITIAL_PAGE = 1;
const DEFAULT_PAGE_SIZE = 24;
const FIRST_PAGE_CACHE_TTL_MS = 60_000;
const EMPTY_FIRST_PAGE_CACHE_TTL_MS = 5_000;

type LibraryRefreshOptions = {
  reason?: string;
  force?: boolean;
};

type UseLibraryDataOptions = {
  consumer?: string;
};

type LibraryFirstPageStoreState = {
  response: LibraryEpisodesResult | null;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastRequestAt: number | null;
  isEmptyResult: boolean;
  lastRefreshReason: string | null;
  version: number;
  inflight: Promise<LibraryEpisodesResult> | null;
};

type FetchFirstPageOptions = {
  consumer: string;
  instanceId: string;
  reason: string;
  pageSize: number;
};

const firstPageListeners = new Set<() => void>();
let firstPageStore: LibraryFirstPageStoreState = {
  response: null,
  pageSize: DEFAULT_PAGE_SIZE,
  isLoading: false,
  error: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastRequestAt: null,
  isEmptyResult: false,
  lastRefreshReason: null,
  version: 0,
  inflight: null,
};
let libraryInstanceCounter = 0;

function dedupeEpisodes(items: EpisodeStub[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function getFirstPageCacheTtl(response: LibraryEpisodesResult | null) {
  return response && response.items.length > 0 ? FIRST_PAGE_CACHE_TTL_MS : EMPTY_FIRST_PAGE_CACHE_TTL_MS;
}

function getFreshFirstPageResponse(pageSize: number) {
  if (
    firstPageStore.response &&
    firstPageStore.pageSize === pageSize &&
    firstPageStore.lastSuccessAt &&
    Date.now() - firstPageStore.lastSuccessAt < getFirstPageCacheTtl(firstPageStore.response)
  ) {
    return firstPageStore.response;
  }

  return null;
}

function emitFirstPageStoreUpdate() {
  firstPageListeners.forEach((listener) => listener());
}

function setFirstPageStore(next: Partial<LibraryFirstPageStoreState>) {
  firstPageStore = {
    ...firstPageStore,
    ...next,
    version: firstPageStore.version + 1,
  };
  emitFirstPageStoreUpdate();
}

function subscribeFirstPageStore(listener: () => void) {
  firstPageListeners.add(listener);
  return () => {
    firstPageListeners.delete(listener);
  };
}

function logRecommendationEvent(event: string, payload: Record<string, unknown>) {
  if (__DEV__) {
    console.debug(event, payload);
  }
}

async function fetchFirstPage(options: FetchFirstPageOptions) {
  const startedAt = Date.now();

  if (firstPageStore.inflight) {
    logRecommendationEvent('home_recommendations_fetch_start', {
      consumer: options.consumer,
      instanceId: options.instanceId,
      reason: options.reason,
      count: firstPageStore.response?.items.length ?? 0,
      source: 'store_inflight',
      inflightJoined: true,
      storeVersion: firstPageStore.version,
    });

    const response = await firstPageStore.inflight;
    logRecommendationEvent('home_recommendations_fetch_done', {
      consumer: options.consumer,
      instanceId: options.instanceId,
      reason: options.reason,
      count: response.items.length,
      elapsedMs: Date.now() - startedAt,
      source: 'store_inflight',
      inflightJoined: true,
      storeVersion: firstPageStore.version,
    });
    return response;
  }

  setFirstPageStore({
    isLoading: true,
    error: null,
    lastRequestAt: startedAt,
    lastRefreshReason: options.reason,
    pageSize: options.pageSize,
  });

  logRecommendationEvent('home_recommendations_fetch_start', {
    consumer: options.consumer,
    instanceId: options.instanceId,
    reason: options.reason,
    count: firstPageStore.response?.items.length ?? 0,
    source: 'network',
    inflightJoined: false,
    storeVersion: firstPageStore.version,
  });

  const task = fetchLibraryEpisodes(INITIAL_PAGE, options.pageSize);
  firstPageStore.inflight = task;

  try {
    const response = await task;
    setFirstPageStore({
      response,
      pageSize: response.pageSize || options.pageSize,
      isLoading: false,
      error: null,
      lastSuccessAt: Date.now(),
      lastErrorAt: null,
      isEmptyResult: response.items.length === 0,
      inflight: null,
    });

    logRecommendationEvent('home_recommendations_fetch_done', {
      consumer: options.consumer,
      instanceId: options.instanceId,
      reason: options.reason,
      count: response.items.length,
      elapsedMs: Date.now() - startedAt,
      source: 'network',
      inflightJoined: false,
      storeVersion: firstPageStore.version,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Library load failed';
    setFirstPageStore({
      isLoading: false,
      error: message,
      lastErrorAt: Date.now(),
      isEmptyResult: (firstPageStore.response?.items.length ?? 0) === 0,
      inflight: null,
    });

    logRecommendationEvent('home_recommendations_fetch_error', {
      consumer: options.consumer,
      instanceId: options.instanceId,
      reason: options.reason,
      count: firstPageStore.response?.items.length ?? 0,
      elapsedMs: Date.now() - startedAt,
      source: 'network',
      inflightJoined: false,
      storeVersion: firstPageStore.version,
      message,
    });
    throw err;
  } finally {
    if (firstPageStore.inflight === task) {
      setFirstPageStore({ inflight: null, isLoading: false });
    }
  }
}

export function useLibraryData(options: UseLibraryDataOptions = {}) {
  const consumer = options.consumer ?? 'library';
  const instanceIdRef = useRef<string | null>(null);
  if (!instanceIdRef.current) {
    libraryInstanceCounter += 1;
    instanceIdRef.current = `${consumer}:${libraryInstanceCounter}`;
  }
  const instanceId = instanceIdRef.current;
  const cachedFirstPage = getFreshFirstPageResponse(DEFAULT_PAGE_SIZE);
  const initialRefreshReasonRef = useRef(cachedFirstPage ? 'mount_revalidate' : 'mount');
  const initialResponse = cachedFirstPage ?? firstPageStore.response;
  const [episodes, setEpisodes] = useState<EpisodeStub[]>(() => initialResponse?.items ?? []);
  const [loading, setLoading] = useState(() => !initialResponse || firstPageStore.isLoading);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(() => firstPageStore.error);
  const [totalEpisodes, setTotalEpisodes] = useState(() => initialResponse?.total ?? 0);
  const [hasMore, setHasMore] = useState(() => initialResponse?.hasMore ?? false);
  const [page, setPage] = useState(() => initialResponse?.page ?? INITIAL_PAGE);
  const [pageSize, setPageSize] = useState(() => initialResponse?.pageSize ?? DEFAULT_PAGE_SIZE);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(() => firstPageStore.lastSuccessAt);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(() => firstPageStore.lastErrorAt);
  const [lastRequestAt, setLastRequestAt] = useState<number | null>(() => firstPageStore.lastRequestAt);
  const [isEmptyResult, setIsEmptyResult] = useState(() => firstPageStore.isEmptyResult);
  const [lastRefreshReason, setLastRefreshReason] = useState<string | null>(() => firstPageStore.lastRefreshReason);
  const [storeVersion, setStoreVersion] = useState(() => firstPageStore.version);
  const mountedRef = useRef(true);
  const pageRef = useRef(initialResponse?.page ?? INITIAL_PAGE);
  const pageSizeRef = useRef(initialResponse?.pageSize ?? DEFAULT_PAGE_SIZE);
  const episodesRef = useRef<EpisodeStub[]>(initialResponse?.items ?? []);
  const refreshingRef = useRef(false);
  const loadingMoreRef = useRef(false);

  const applyFirstPageSnapshot = useCallback(() => {
    if (!mountedRef.current) return;

    const response = firstPageStore.response;
    setLoading(!response && firstPageStore.isLoading);
    setRefreshing(firstPageStore.isLoading && episodesRef.current.length > 0);
    setError(firstPageStore.error);
    setLastSuccessAt(firstPageStore.lastSuccessAt);
    setLastErrorAt(firstPageStore.lastErrorAt);
    setLastRequestAt(firstPageStore.lastRequestAt);
    setIsEmptyResult(firstPageStore.isEmptyResult);
    setLastRefreshReason(firstPageStore.lastRefreshReason);
    setStoreVersion(firstPageStore.version);

    if (!response) return;

    const safePageSize = response.pageSize || pageSizeRef.current || DEFAULT_PAGE_SIZE;
    const safeTotal = typeof response.total === 'number' && response.total > 0 ? response.total : 0;
    const nextItems =
      pageRef.current > INITIAL_PAGE
        ? dedupeEpisodes([...response.items, ...episodesRef.current])
        : dedupeEpisodes(response.items);
    const derivedHasMore =
      typeof response.hasMore === 'boolean'
        ? response.hasMore
        : safeTotal > 0
          ? nextItems.length < safeTotal
          : response.items.length >= safePageSize;

    setEpisodes(nextItems);
    episodesRef.current = nextItems;
    setTotalEpisodes(safeTotal || nextItems.length);
    setHasMore(derivedHasMore);
    pageSizeRef.current = safePageSize;
    setPageSize(safePageSize);
    if (pageRef.current <= INITIAL_PAGE) {
      const safePage = response.page || INITIAL_PAGE;
      pageRef.current = safePage;
      setPage(safePage);
    }

    logRecommendationEvent('home_recommendations_store_update', {
      consumer,
      instanceId,
      reason: firstPageStore.lastRefreshReason,
      count: nextItems.length,
      source: 'first_page_store',
      inflightJoined: false,
      storeVersion: firstPageStore.version,
    });
  }, [consumer, instanceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    episodesRef.current = episodes;
  }, [episodes]);

  useEffect(() => {
    applyFirstPageSnapshot();
    return subscribeFirstPageStore(applyFirstPageSnapshot);
  }, [applyFirstPageSnapshot]);

  const loadPage = useCallback(async (
    nextPage: number,
    mode: 'replace' | 'append',
    refreshOptions: LibraryRefreshOptions = {},
  ) => {
    if (!mountedRef.current) return;

    const reason = refreshOptions.reason ?? (mode === 'append' ? 'load_more' : 'manual');

    if (mode === 'replace') {
      if (refreshingRef.current && !refreshOptions.force && !firstPageStore.inflight) {
        logRecommendationEvent('home_recommendations_refresh_skipped', {
          consumer,
          instanceId,
          reason,
          source: 'instance_refreshing',
          count: episodesRef.current.length,
          inflightJoined: false,
          storeVersion: firstPageStore.version,
        });
        return;
      }
      refreshingRef.current = true;
      if (nextPage === INITIAL_PAGE && episodesRef.current.length === 0) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
    } else {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }

    const startedAt = Date.now();
    setLastRequestAt(startedAt);
    setLastRefreshReason(reason);

    try {
      const response =
        nextPage === INITIAL_PAGE && mode === 'replace'
          ? await fetchFirstPage({
              consumer,
              instanceId,
              reason,
              pageSize: pageSizeRef.current || DEFAULT_PAGE_SIZE,
            })
          : await fetchLibraryEpisodes(nextPage, pageSizeRef.current || DEFAULT_PAGE_SIZE);
      if (!mountedRef.current) return;

      const safePage = response.page || nextPage;
      const safePageSize = response.pageSize || pageSizeRef.current || DEFAULT_PAGE_SIZE;
      const safeTotal = typeof response.total === 'number' && response.total > 0 ? response.total : 0;

      const merged = mode === 'append' ? [...episodesRef.current, ...response.items] : response.items;
      const deduped = dedupeEpisodes(merged);
      const derivedHasMore =
        typeof response.hasMore === 'boolean'
          ? response.hasMore
          : safeTotal > 0
            ? deduped.length < safeTotal
            : response.items.length >= safePageSize;

      setEpisodes(deduped);
      episodesRef.current = deduped;
      setHasMore(derivedHasMore);
      setTotalEpisodes(safeTotal || deduped.length);
      pageRef.current = safePage;
      setPage(safePage);
      pageSizeRef.current = safePageSize;
      setPageSize(safePageSize);
      setLastSuccessAt(Date.now());
      setLastErrorAt(null);
      setIsEmptyResult(deduped.length === 0);
    } catch (err) {
      if (!mountedRef.current) return;

      if (mode === 'replace') {
        const message = err instanceof Error ? err.message : 'Library load failed';
        setError(message);
        setLastErrorAt(Date.now());
        setIsEmptyResult(episodesRef.current.length === 0);
        if (episodesRef.current.length === 0) {
          setTotalEpisodes(0);
          setHasMore(false);
        }
        pageRef.current = INITIAL_PAGE;
        setPage(INITIAL_PAGE);
        pageSizeRef.current = DEFAULT_PAGE_SIZE;
        setPageSize(DEFAULT_PAGE_SIZE);
      }
    } finally {
      if (!mountedRef.current) return;
      if (mode === 'replace') {
        refreshingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      } else {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [consumer, instanceId]);

  useEffect(() => {
    void loadPage(INITIAL_PAGE, 'replace', { reason: initialRefreshReasonRef.current });
  }, [loadPage]);

  const refresh = useCallback(async (options: LibraryRefreshOptions = {}) => {
    await loadPage(INITIAL_PAGE, 'replace', options);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (loading || refreshing || loadingMore || loadingMoreRef.current || refreshingRef.current || !hasMore) {
      return;
    }

    await loadPage(pageRef.current + 1, 'append');
  }, [hasMore, loadPage, loading, loadingMore, refreshing]);

  return {
    episodes,
    loading,
    refreshing,
    loadingMore,
    error,
    totalEpisodes,
    hasMore,
    page,
    pageSize,
    lastSuccessAt,
    lastErrorAt,
    lastRequestAt,
    isEmptyResult,
    lastRefreshReason,
    storeVersion,
    loadMore,
    refresh,
  };
}
