import {
  fetchUserLearningRecordsBundle,
  type LearningActivity,
  type LearningRecord,
} from '@/services/api/learning';
import { retryWithSessionRefresh } from '@/services/auth/retryWithSessionRefresh';
import type { StoredSession } from '@/types/auth';

export const LEARNING_RECORDS_CACHE_TTL_MS = 60_000;

export type LearningRecordsSnapshot = {
  records: LearningRecord[];
  activities: LearningActivity[];
  fetchedAt: number | null;
  error: string | null;
  isLoading: boolean;
  userKey: string | null;
  revision: number;
  staleReason: string | null;
};

type FetchSharedLearningRecordsOptions = {
  force?: boolean;
  session: StoredSession | null;
  refreshSession?: () => Promise<StoredSession | null>;
  keepPreviousOnError?: boolean;
};

type LearningRecordsListener = (snapshot: LearningRecordsSnapshot) => void;

const EMPTY_SNAPSHOT: LearningRecordsSnapshot = {
  records: [],
  activities: [],
  fetchedAt: null,
  error: null,
  isLoading: false,
  userKey: null,
  revision: 0,
  staleReason: null,
};

let snapshot: LearningRecordsSnapshot = EMPTY_SNAPSHOT;
let inflight: Promise<LearningRecordsSnapshot> | null = null;
let inflightUserKey: string | null = null;
const listeners = new Set<LearningRecordsListener>();

export function getLearningRecordsUserKey(session?: StoredSession | null) {
  return session?.user?.id ?? null;
}

function cloneSnapshot(value: LearningRecordsSnapshot): LearningRecordsSnapshot {
  return {
    ...value,
    records: value.records,
    activities: value.activities,
  };
}

function publish(patch: Partial<LearningRecordsSnapshot>) {
  snapshot = {
    ...snapshot,
    ...patch,
    revision: snapshot.revision + 1,
  };
  const nextSnapshot = cloneSnapshot(snapshot);
  listeners.forEach((listener) => listener(nextSnapshot));
  return nextSnapshot;
}

function createEmptySnapshotForUser(userKey: string | null): LearningRecordsSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    userKey,
    revision: snapshot.revision,
  };
}

export function getCachedLearningRecords(session?: StoredSession | null): LearningRecordsSnapshot {
  if (typeof session === 'undefined') {
    return cloneSnapshot(snapshot);
  }

  const userKey = getLearningRecordsUserKey(session);
  if (!userKey || snapshot.userKey !== userKey) {
    return createEmptySnapshotForUser(userKey);
  }

  return cloneSnapshot(snapshot);
}

export function isLearningRecordsCacheStale(session?: StoredSession | null, now = Date.now()) {
  const current = getCachedLearningRecords(session);
  return !current.fetchedAt || now - current.fetchedAt >= LEARNING_RECORDS_CACHE_TTL_MS;
}

export function subscribeLearningRecords(listener: LearningRecordsListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function invalidateLearningRecords(reason = 'manual') {
  publish({
    fetchedAt: null,
    staleReason: reason,
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? '学习记录加载失败');
}

function isUnauthorizedLearningError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('401') ||
    message.includes('unauthorized') ||
    message.includes('unauthenticated') ||
    message.includes('jwt expired') ||
    message.includes('invalid jwt') ||
    message.includes('pgrst301') ||
    message.includes('pgrst303')
  );
}

export async function fetchSharedLearningRecords(
  options: FetchSharedLearningRecordsOptions,
): Promise<LearningRecordsSnapshot> {
  const { session, refreshSession, force = false, keepPreviousOnError = true } = options;
  const userKey = getLearningRecordsUserKey(session);

  if (!session || !userKey) {
    throw new Error('未登录');
  }

  const current = getCachedLearningRecords(session);
  if (!force && current.fetchedAt && !current.error && !isLearningRecordsCacheStale(session)) {
    return current;
  }

  if (inflight && inflightUserKey === userKey) {
    return inflight;
  }

  if (snapshot.userKey !== userKey) {
    publish({
      ...EMPTY_SNAPSHOT,
      userKey,
    });
  }

  publish({
    isLoading: true,
    userKey,
    error: keepPreviousOnError ? snapshot.error : null,
  });

  const task = (async () => {
    try {
      const bundle = refreshSession
        ? await retryWithSessionRefresh({
            request: (nextSession) => fetchUserLearningRecordsBundle(nextSession),
            refreshSession,
            getSession: () => session,
            isUnauthorizedError: isUnauthorizedLearningError,
          })
        : await fetchUserLearningRecordsBundle(session);

      return publish({
        records: bundle.records,
        activities: bundle.activities,
        fetchedAt: Date.now(),
        error: null,
        isLoading: false,
        userKey,
        staleReason: null,
      });
    } catch (error) {
      const latest = getCachedLearningRecords(session);
      const canKeepPrevious = keepPreviousOnError && latest.records.length > 0;
      const nextSnapshot = publish({
        records: canKeepPrevious ? latest.records : [],
        activities: canKeepPrevious ? latest.activities : [],
        fetchedAt: canKeepPrevious ? latest.fetchedAt : null,
        error: errorMessage(error),
        isLoading: false,
        userKey,
      });

      if (canKeepPrevious) {
        return nextSnapshot;
      }
      throw error;
    } finally {
      inflight = null;
      inflightUserKey = null;
    }
  })();

  inflight = task;
  inflightUserKey = userKey;
  return task;
}
