import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { SectionCard } from '@/components/SectionCard';
import { BackLink } from '@/components/ui/BackLink';
import { ActionButton, SegmentButton, StatusPill } from '@/components/ui/ApplePrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { LEVEL_COLOR, LEVEL_TEXT_COLOR, SCENARIOS, type Level } from '@/data/scenarios';
import { useAiDataConsent } from '@/services/privacy/AiDataConsentProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { FONT_CALLOUT, FONT_CAPTION } from '@/theme/tokens';

const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

export function SpeakingScenesScreen() {
  const { theme } = useAppTheme();
  const params = useLocalSearchParams<{ scenarioId?: string; entry?: string }>();
  const scenarioIdParam = Array.isArray(params.scenarioId) ? params.scenarioId[0] : params.scenarioId;
  const entryParam = Array.isArray(params.entry) ? params.entry[0] : params.entry;
  const [selectedLevel, setSelectedLevel] = useState<Level>('B1');
  const aiConsent = useAiDataConsent();

  const recommendedScenario = SCENARIOS.find((item) => item.id === scenarioIdParam) ?? null;
  const targetEntry = entryParam === 'v2' ? 'v2' : 'v1';

  const episodeScenarios = useMemo(() => SCENARIOS.filter((s) => s.category === 'episode' && (s.level === selectedLevel || s.level === 'B1')), [selectedLevel]);
  const generalScenarios = useMemo(() => SCENARIOS.filter((s) => s.category === 'general' && s.level === selectedLevel), [selectedLevel]);
  const freeChat = SCENARIOS.find((s) => s.id === 'free-chat');
  const openWithConsent = async (
    pathname: '/speaking/v1' | '/speaking/v1/practice' | '/speaking/v2',
    scenarioId: string,
  ) => {
    const consented = await aiConsent.requestConsent();
    if (!consented) return;
    router.push({ pathname, params: { scenarioId } });
  };

  return (
    <AppScreenShell contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false} includeBottomInset={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}><BackLink label="口语" onPress={() => router.back()} /></View>
        <PageHeader title="场景页" subtitle="按难度和主题挑选适合你的口语练习场景。" />

        <View style={{ paddingHorizontal: 20, gap: 20 }}>
          <SectionCard title="场景进入关系" subtitle="选择场景后，可以进入对应的口语练习模式。">
            <View style={{ gap: 10 }}>
              <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
                {targetEntry === 'v1' ? '当前会优先进入标准口语练习，也可以查看实时口语入口。' : '你可以从这里继续进入实时口语练习。'}
              </AppText>
              {recommendedScenario ? <StatusPill label={`推荐：${recommendedScenario.name}`} tone="blue" /> : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <ActionButton label="去 V1" variant="dark" onPress={() => void openWithConsent('/speaking/v1', recommendedScenario?.id ?? SCENARIOS[0].id)} />
                <ActionButton label="看 V2 状态" variant="secondary" onPress={() => void openWithConsent('/speaking/v2', recommendedScenario?.id ?? SCENARIOS[0].id)} />
              </View>
            </View>
          </SectionCard>

          <SectionCard title="难度筛选" subtitle="按当前水平筛选更适合的练习场景。">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {LEVELS.map((lv) => (
                <SegmentButton key={lv} label={lv} active={selectedLevel === lv} onPress={() => setSelectedLevel(lv)} />
              ))}
            </View>
          </SectionCard>

          {episodeScenarios.length > 0 ? (
            <SectionCard title="基于视频场景" subtitle="围绕真实内容整理的情境练习场景。">
              <View style={{ gap: 12 }}>{episodeScenarios.map((scenario) => <ScenarioCard key={scenario.id} scenario={scenario} recommended={recommendedScenario?.id === scenario.id} openWithConsent={openWithConsent} />)}</View>
            </SectionCard>
          ) : null}

          {generalScenarios.length > 0 ? (
            <SectionCard title="精选通用场景" subtitle="按等级收精选练习场景，不再只是静态展示。">
              <View style={{ gap: 12 }}>{generalScenarios.map((scenario) => <ScenarioCard key={scenario.id} scenario={scenario} recommended={recommendedScenario?.id === scenario.id} openWithConsent={openWithConsent} />)}</View>
            </SectionCard>
          ) : null}

          {freeChat ? (
            <SectionCard title="自由对话" subtitle="和场景练习分开收口，但仍承接到当前可用入口。">
              <ScenarioCard scenario={freeChat} recommended={recommendedScenario?.id === freeChat.id} openWithConsent={openWithConsent} />
            </SectionCard>
          ) : null}
        </View>
    </AppScreenShell>
  );
}

function ScenarioCard({
  scenario,
  recommended,
  openWithConsent,
}: {
  scenario: (typeof SCENARIOS)[number];
  recommended?: boolean;
  openWithConsent: (pathname: '/speaking/v1' | '/speaking/v1/practice' | '/speaking/v2', scenarioId: string) => Promise<void>;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <AppText style={{ fontSize: 28 }}>{scenario.icon}</AppText>
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <AppText style={{ fontSize: 15, fontWeight: '700', color: theme.textPrimary }}>{scenario.name}</AppText>
            <View style={{ borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: LEVEL_COLOR[scenario.level] }}>
              <AppText style={{ fontSize: 10, fontWeight: '700', color: LEVEL_TEXT_COLOR[scenario.level] }}>{scenario.level}</AppText>
            </View>
            {scenario.episodeRef ? <StatusPill label={scenario.episodeRef} tone="amber" /> : null}
            {recommended ? <StatusPill label="推荐" tone="blue" /> : null}
          </View>
          <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: theme.textSecondary }}>{scenario.description}</AppText>
          <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: theme.textSecondary }}>角色：{scenario.aiName} / {scenario.aiRole}</AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {scenario.targetPhrases.slice(0, 4).map((phrase) => <StatusPill key={phrase} label={phrase} tone="neutral" />)}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <ActionButton label="用 V1 开始" variant="dark" onPress={() => void openWithConsent('/speaking/v1/practice', scenario.id)} />
        <ActionButton label="V2 承接位" variant="secondary" onPress={() => void openWithConsent('/speaking/v2', scenario.id)} />
      </View>
    </View>
  );
}
