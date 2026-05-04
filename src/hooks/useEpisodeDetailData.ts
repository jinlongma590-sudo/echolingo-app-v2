import { useEffect, useState } from 'react';

import { fetchEpisodeDetail } from '@/services/api/episode';
import type { EpisodeDetailSnapshot } from '@/types/echolingo';

// ── Module-level cache ──────────────────────────────────────────────────────
//
// Once we've loaded an episode snapshot, keep it in memory for the lifetime
// of the app session. Re-entering the same episode (or returning via
// back-navigation) is then instant — no network round-trip, no spinner.
//
// We also dedupe IN-FLIGHT fetches: if two callers request the same episode
// simultaneously, they share the same Promise instead of issuing two requests.
const snapshotCache = new Map<string, EpisodeDetailSnapshot>();
const inflightCache = new Map<string, Promise<EpisodeDetailSnapshot>>();

function loadEpisode(id: string): Promise<EpisodeDetailSnapshot> {
  const cached = snapshotCache.get(id);
  if (cached) return Promise.resolve(cached);

  const inflight = inflightCache.get(id);
  if (inflight) return inflight;

  const promise = fetchEpisodeDetail(id)
    .then((data) => {
      snapshotCache.set(id, data);
      inflightCache.delete(id);
      return data;
    })
    .catch((err) => {
      inflightCache.delete(id);
      throw err;
    });

  inflightCache.set(id, promise);
  return promise;
}

/**
 * Fire-and-forget prefetch — call this from list screens (e.g. LibraryScreen)
 * right after data loads, so by the time the user taps a card the snapshot
 * is already warm in cache and the episode page renders instantly.
 *
 * Safe to call repeatedly: no-op if already cached or in-flight.
 */
export function prefetchEpisodeDetail(id: string): void {
  if (!id) return;
  if (snapshotCache.has(id) || inflightCache.has(id)) return;
  // Swallow errors — prefetch is best-effort. The real fetch on navigation
  // will surface any actual error to the user.
  void loadEpisode(id).catch(() => undefined);
}

export function useEpisodeDetailData(id?: string | null) {
  // Initialize synchronously from cache when possible — this is the key to
  // instant render on second visit. No useEffect→setState round-trip means
  // the very first paint already has the data.
  const initial = id ? snapshotCache.get(id) ?? null : null;
  const [snapshot, setSnapshot] = useState<EpisodeDetailSnapshot | null>(initial);
  const [loading, setLoading] = useState(Boolean(id) && !initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Cache hit — sync render; bail without setting loading.
    const cached = snapshotCache.get(id);
    if (cached) {
      setSnapshot(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadEpisode(id)
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setSnapshot(null);
        setError(err instanceof Error ? err.message : 'Episode load failed');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { snapshot, loading, error };
}
