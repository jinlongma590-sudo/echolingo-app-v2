import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_DAILY_GOAL_MINUTES = 20;
const DAILY_GOAL_OPTIONS = [10, 15, 20, 30, 45, 60] as const;
const STORAGE_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}echolingo-daily-goal.json`
  : null;

type DailyGoalStore = {
  goalByUserId?: Record<string, number>;
  dailyGoalMinutes?: number;
};

export type DailyGoalSource = 'localDefault' | 'localUser';

function resolveUserKey(userId?: string | null) {
  return userId?.trim() || 'guest';
}

function normalizeGoalMinutes(value: unknown) {
  const normalized = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : NaN;
  return DAILY_GOAL_OPTIONS.includes(normalized as (typeof DAILY_GOAL_OPTIONS)[number])
    ? normalized
    : DEFAULT_DAILY_GOAL_MINUTES;
}

async function readStore(): Promise<DailyGoalStore> {
  if (!STORAGE_FILE) {
    return { goalByUserId: {} };
  }

  try {
    const info = await FileSystem.getInfoAsync(STORAGE_FILE);
    if (!info.exists) {
      return { goalByUserId: {} };
    }

    const raw = await FileSystem.readAsStringAsync(STORAGE_FILE);
    const parsed = JSON.parse(raw) as DailyGoalStore;
    return {
      goalByUserId:
        parsed.goalByUserId && typeof parsed.goalByUserId === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.goalByUserId).map(([key, minutes]) => [key, normalizeGoalMinutes(minutes)]),
            )
          : {},
      dailyGoalMinutes: normalizeGoalMinutes(parsed.dailyGoalMinutes),
    };
  } catch {
    return { goalByUserId: {} };
  }
}

async function writeStore(store: DailyGoalStore) {
  if (!STORAGE_FILE) return;
  await FileSystem.writeAsStringAsync(STORAGE_FILE, JSON.stringify(store));
}

export function useDailyGoalTracker(userId?: string | null) {
  const userKey = resolveUserKey(userId);
  const [dailyGoalMinutes, setDailyGoalMinutesState] = useState(DEFAULT_DAILY_GOAL_MINUTES);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<DailyGoalSource>('localDefault');
  const storeRef = useRef<DailyGoalStore>({ goalByUserId: {} });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const store = await readStore();
      if (cancelled) return;

      storeRef.current = store;
      const perUserGoal = store.goalByUserId?.[userKey];
      const fallbackGoal =
        typeof perUserGoal === 'number'
          ? perUserGoal
          : normalizeGoalMinutes(store.dailyGoalMinutes);
      setDailyGoalMinutesState(fallbackGoal);
      setSource(typeof perUserGoal === 'number' ? 'localUser' : 'localDefault');
      setLoaded(true);
    }

    setLoaded(false);
    void load();

    return () => {
      cancelled = true;
    };
  }, [userKey]);

  const setDailyGoalMinutes = useCallback(async (minutes: number) => {
    const nextGoal = normalizeGoalMinutes(minutes);
    const nextStore: DailyGoalStore = {
      ...storeRef.current,
      goalByUserId: {
        ...(storeRef.current.goalByUserId ?? {}),
        [userKey]: nextGoal,
      },
      dailyGoalMinutes: nextGoal,
    };

    storeRef.current = nextStore;
    setDailyGoalMinutesState(nextGoal);
    setSource('localUser');
    await writeStore(nextStore);
  }, [userKey]);

  return {
    dailyGoalMinutes,
    loaded,
    source,
    setDailyGoalMinutes,
  };
}
