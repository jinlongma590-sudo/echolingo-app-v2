import { useGlobalSearchParams } from 'expo-router';
import React, { createContext, useContext, useMemo } from 'react';

import { SCENARIOS } from '@/data/scenarios';
import { useSpeakingV2Runtime } from '@/hooks/speaking/useSpeakingV2Runtime';
import { useAppSession } from '@/services/auth/AppSessionProvider';

type SpeakingV2Scenario = (typeof SCENARIOS)[number];

export type SpeakingV2RuntimeContextValue = {
  isLoggedIn: boolean;
  runtime: ReturnType<typeof useSpeakingV2Runtime>;
  scenario: SpeakingV2Scenario;
};

const SpeakingV2RuntimeContext = createContext<SpeakingV2RuntimeContextValue | null>(null);

function resolveScenario(scenarioId?: string): SpeakingV2Scenario {
  return (
    SCENARIOS.find((item) => item.id === scenarioId) ??
    SCENARIOS.find((item) => item.id === 'free-chat') ??
    SCENARIOS[0]
  );
}

export function SpeakingV2RuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useGlobalSearchParams<{ scenarioId?: string }>();
  const appSession = useAppSession();

  const scenarioId = Array.isArray(params.scenarioId)
    ? params.scenarioId[0]
    : params.scenarioId;

  const scenario = useMemo(() => resolveScenario(scenarioId), [scenarioId]);
  const runtime = useSpeakingV2Runtime({
    session: appSession.session,
    scenario,
  });

  const value = useMemo<SpeakingV2RuntimeContextValue>(
    () => ({
      isLoggedIn: appSession.status === 'authenticated',
      runtime,
      scenario,
    }),
    [appSession.status, runtime, scenario],
  );

  return (
    <SpeakingV2RuntimeContext.Provider value={value}>
      {children}
    </SpeakingV2RuntimeContext.Provider>
  );
}

export function useSpeakingV2RuntimeContext() {
  const context = useContext(SpeakingV2RuntimeContext);

  if (!context) {
    throw new Error('useSpeakingV2RuntimeContext must be used within SpeakingV2RuntimeProvider');
  }

  return context;
}
