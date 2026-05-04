import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { SectionCard } from '@/components/SectionCard';
import { BackLink } from '@/components/ui/BackLink';
import { ActionButton, BulletRow, MetricTile, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { FONT_CALLOUT, TEXT_PRIMARY, TEXT_SECONDARY } from '@/theme/tokens';

type EntrySection = {
  title: string;
  description?: string;
  items: string[];
};

export function EntryDetailScreen({
  title,
  subtitle,
  sections,
  eyebrow,
  status,
  primaryActionLabel,
  primaryAction,
  secondaryActionLabel,
  secondaryAction,
}: {
  title: string;
  subtitle: string;
  sections: EntrySection[];
  eyebrow?: string;
  status?: string;
  primaryActionLabel?: string;
  primaryAction?: () => void;
  secondaryActionLabel?: string;
  secondaryAction?: () => void;
}) {
  return (
    <AppScreenShell contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false} includeBottomInset={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <BackLink label="返回" onPress={() => router.back()} />
        </View>

        <PageHeader title={title} subtitle={subtitle} eyebrow={eyebrow} />

        <SurfaceCard>
          <View style={{ gap: 14 }}>
            <View style={{ gap: 8 }}>
              {status ? <StatusPill label={status} tone="blue" /> : null}
              <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>{title}</AppText>
              <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>{subtitle}</AppText>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <MetricTile label="入口状态" value="已接通" note="当前页面可直接进入" tone="green" />
              <MetricTile label="当前阶段" value="承接位" note="优先保证路径可达与状态清楚" tone="blue" />
              <MetricTile label="实现策略" value="克制" note="不伪装未完成能力" tone="amber" />
            </View>
            {(primaryAction || secondaryAction) ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {secondaryAction && secondaryActionLabel ? (
                  <ActionButton label={secondaryActionLabel} variant="secondary" onPress={secondaryAction} />
                ) : null}
                {primaryAction && primaryActionLabel ? (
                  <ActionButton label={primaryActionLabel} variant="dark" onPress={primaryAction} />
                ) : null}
              </View>
            ) : null}
          </View>
        </SurfaceCard>

        <View style={{ paddingHorizontal: 20, gap: 20 }}>
          {sections.map((section) => (
            <SectionCard key={section.title} title={section.title} subtitle={section.description}>
              <View style={{ gap: 10 }}>
                {section.items.map((item, index) => (
                  <BulletRow key={`${section.title}-${index}`} title={`要点 ${index + 1}`} detail={item} tone={index === 0 ? 'blue' : index === 1 ? 'amber' : 'green'} />
                ))}
              </View>
            </SectionCard>
          ))}
        </View>
    </AppScreenShell>
  );
}
