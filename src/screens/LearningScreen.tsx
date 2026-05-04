import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { SectionCard } from '@/components/SectionCard';
import { BackLink } from '@/components/ui/BackLink';
import { ActionButton, MetricTile, ProgressBar, StatusPill } from '@/components/ui/ApplePrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { fetchUserLearningRecords, type LearningRecord } from '@/services/api/learning';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { COLOR_RED, FONT_CALLOUT, FONT_CAPTION, TEXT_PRIMARY, TEXT_SECONDARY } from '@/theme/tokens';

function statusTone(status: LearningRecord['status']) {
  if (status === 'mastered') return 'green' as const;
  if (status === 'learning') return 'blue' as const;
  if (status === 'reviewed') return 'amber' as const;
  return 'neutral' as const;
}

function statusLabel(status: LearningRecord['status']) {
  if (status === 'mastered') return '已掌握';
  if (status === 'learning') return '进行中';
  if (status === 'reviewed') return '已学习';
  return '未开始';
}

function openEpisodeTarget(episodeId: string, sentenceId?: number | null) {
  router.push({ pathname: '/episode/[id]', params: sentenceId ? { id: episodeId, sentence: String(sentenceId) } : { id: episodeId } });
}

export function LearningScreen() {
  const session = useAppSession();
  const [records, setRecords] = useState<LearningRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLoggedIn = session.status === 'authenticated';

  const load = useCallback(async () => {
    if (!session.session) return;
    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchUserLearningRecords(session.session));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载学习记录失败');
    } finally {
      setLoading(false);
    }
  }, [session.session]);

  useEffect(() => {
    if (isLoggedIn) void load();
    else setLoading(false);
  }, [isLoggedIn, load]);

  const stats = useMemo(() => {
    const inProgress = records.filter((item) => item.status === 'learning' || item.status === 'reviewed').length;
    const mastered = records.filter((item) => item.status === 'mastered').length;
    const totalReviewedSentences = records.reduce((sum, item) => sum + item.reviewedSentences, 0);
    return { inProgress, mastered, totalReviewedSentences };
  }, [records]);

  return (
    <AppScreenShell contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false} includeBottomInset={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}><BackLink label="我的" onPress={() => router.back()} /></View>
        <PageHeader title="学习记录" subtitle="把学到哪一集、学到哪一句、最近什么时候学过，收成可继续学习的页面。" />

        <View style={{ paddingHorizontal: 20, gap: 20 }}>
          {!isLoggedIn ? (
            <SectionCard title="学习记录需要登录" subtitle="登录后可以同步你的学习进度和继续学习入口。">
              <ActionButton label="去登录" variant="dark" onPress={() => router.push('/auth/sign-in')} />
            </SectionCard>
          ) : (
            <>
              <SectionCard title="学习总览" subtitle="这里会汇总你的学习进度，方便继续上次的学习。">
                {loading ? <ActivityIndicator color={TEXT_SECONDARY} /> : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    <MetricTile label="涉及单集" value={records.length} note="当前有学习记录的单集数" tone="blue" />
                    <MetricTile label="进行中" value={stats.inProgress} note="仍可直接继续的学习内容" tone="amber" />
                    <MetricTile label="已学句子" value={stats.totalReviewedSentences} note={`已掌握 ${stats.mastered} 个单集`} tone="green" />
                  </View>
                )}
              </SectionCard>

              <SectionCard title="继续学习" subtitle="每条记录都尽量回到最近学习位置，而不是只回到单集首页。">
                {loading ? <ActivityIndicator color={TEXT_SECONDARY} /> : records.length > 0 ? (
                  <View style={{ gap: 12 }}>
                    {records.map((record) => {
                      const progressPercentage = record.totalSentences > 0 ? Math.round((record.reviewedSentences / record.totalSentences) * 100) : 0;
                      return (
                        <View key={record.episode.id} style={{ gap: 12 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, gap: 4 }}>
                              <AppText style={{ fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY }}>{record.episode.title}</AppText>
                              <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{record.episode.difficulty} · {record.episode.duration} · 最近学习 {record.lastReviewedAt ? new Date(record.lastReviewedAt).toLocaleString('zh-CN') : '暂无时间'}</AppText>
                            </View>
                            <StatusPill label={statusLabel(record.status)} tone={statusTone(record.status)} />
                          </View>

                          {record.totalSentences > 0 ? (
                            <View style={{ gap: 6 }}>
                              <ProgressBar progress={progressPercentage} />
                              <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>已完成 {record.reviewedSentences} / {record.totalSentences} 句 · 进度 {progressPercentage}%</AppText>
                            </View>
                          ) : (
                            <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>当前还没拿到完整句子总数，先保留继续学习入口。</AppText>
                          )}

                          <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 19, color: TEXT_SECONDARY }}>{record.lastSentenceId ? `继续学习会优先回到上次学到的句子 #${record.lastSentenceId}。` : '当前没有记录到具体句子，会回到该单集继续学习。'}</AppText>

                          <View style={{ flexDirection: 'row', gap: 10 }}>
                            <ActionButton label={record.status === 'mastered' ? '再次学习' : '继续学习'} variant="dark" onPress={() => openEpisodeTarget(record.episode.id, record.lastSentenceId)} />
                            <ActionButton label={record.lastSentenceId ? '回到上次位置' : '进入单集'} variant="secondary" onPress={() => openEpisodeTarget(record.episode.id, record.lastSentenceId)} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>还没有学习记录</AppText>
                    <ActionButton label="进入精听库" variant="dark" onPress={() => router.push('/library')} />
                  </View>
                )}
              </SectionCard>
            </>
          )}
          {error ? <AppText style={{ fontSize: FONT_CAPTION, color: COLOR_RED }}>{error}</AppText> : null}
        </View>
    </AppScreenShell>
  );
}
