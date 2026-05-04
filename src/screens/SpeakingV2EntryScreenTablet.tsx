import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { COACH_PROFILES, type CoachProfileId } from '@/data/coachProfiles';
import type { Scenario } from '@/data/scenarios';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  resolveSpeakingPreparationHeroPalette,
  type SpeakingPreparationHeroPalette,
} from '@/theme/tokens';

const PAGE_PADDING = 24;
const PAGE_MAX_WIDTH = 1400;
const COLUMN_GAP = 16;
const HEADER_HEIGHT = 56;
const SCENARIO_ROW_HEIGHT = 86;
const SCENARIO_ROW_GAP = 10;

type SpeakingV2EntryScreenTabletProps = {
  availableScenarios: Scenario[];
  activeScenario: Scenario;
  selectedScenarioId: string;
  focusGoals: string[];
  estimatedDuration: number;
  primaryLabel: string;
  entitlementBusy: boolean;
  isLoggedIn: boolean;
  selectedCoachId: CoachProfileId;
  onSelectScenario: (scenarioId: string) => void;
  onSelectCoach: (coachId: CoachProfileId) => void;
  onPressBack: () => void;
  onPressMore: () => void;
  onPressPrimary: () => void;
};

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.16 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 3,
  } as const;
}

function MetricCard({
  icon,
  iconTint,
  iconBackground,
  value,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconTint: string;
  iconBackground: string;
  value: string;
  label: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.metricCard,
        {
          backgroundColor: theme.cardBackground,
          borderColor: 'rgba(15,23,42,0.06)',
          ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
        },
      ]}
    >
      <View style={[styles.metricIconWrap, { backgroundColor: iconBackground }]}>
        <Ionicons name={icon} size={22} color={iconTint} />
      </View>
      <View style={styles.metricTextWrap}>
        <AppText
          style={[styles.metricValue, { color: theme.textPrimary }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {value}
        </AppText>
        <AppText style={[styles.metricLabel, { color: theme.textSecondary }]} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </View>
  );
}

export function SpeakingV2EntryScreenTablet({
  availableScenarios,
  activeScenario,
  selectedScenarioId,
  focusGoals,
  estimatedDuration,
  primaryLabel,
  entitlementBusy,
  isLoggedIn,
  selectedCoachId,
  onSelectScenario,
  onSelectCoach,
  onPressBack,
  onPressMore,
  onPressPrimary,
}: SpeakingV2EntryScreenTabletProps) {
  const { theme } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const floatingInsets = useFloatingTabInsets();

  const topPadding = Math.max(floatingInsets.top - 42, 52);
  const contentWidth = Math.min(width - PAGE_PADDING * 2, PAGE_MAX_WIDTH);
  const leftWidth = Math.round((contentWidth - COLUMN_GAP) * 0.33);
  const rightWidth = contentWidth - COLUMN_GAP - leftWidth;
  const bodyHeight = Math.max(height - topPadding - 24 - HEADER_HEIGHT, 540);
  const palette: SpeakingPreparationHeroPalette = useMemo(
    () => resolveSpeakingPreparationHeroPalette(activeScenario.id, theme.colorScheme),
    [activeScenario.id, theme.colorScheme],
  );
  const consumptionValue = '实时结算';
  const consumptionLabel = '按通话时长消耗 Credits';
  const heroSubtitle = '低延迟 AI 通话，训练自然交流';

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
      <View style={[styles.page, { paddingTop: topPadding, paddingHorizontal: PAGE_PADDING }]}>
        <View style={[styles.pageInner, { width: contentWidth }]}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Pressable
                accessibilityRole="button"
                onPress={onPressBack}
                style={({ pressed }) => [
                  styles.chromeButton,
                  {
                    backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.92)',
                    borderColor: 'rgba(15,23,42,0.06)',
                    ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                  },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
              </Pressable>
              <AppText style={[styles.pageTitle, { color: theme.textPrimary }]}>实时语音通话</AppText>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onPressMore}
              style={({ pressed }) => [
                styles.chromeButton,
                {
                  backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.92)',
                  borderColor: 'rgba(15,23,42,0.06)',
                  ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                },
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="ellipsis-horizontal" size={24} color={theme.textPrimary} />
            </Pressable>
          </View>

          <View style={[styles.contentRow, { height: bodyHeight }]}>
            <View
              style={[
                styles.leftShell,
                {
                  width: leftWidth,
                  backgroundColor: theme.cardBackground,
                  borderColor: 'rgba(15,23,42,0.06)',
                  ...cardShadow(theme.colorScheme, theme.shadowColor, 0.05),
                },
              ]}
            >
              <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>切换练习场景</AppText>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.sceneListContent}
              >
                {availableScenarios.map((item) => {
                  const selected = item.id === selectedScenarioId;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => onSelectScenario(item.id)}
                      style={({ pressed }) => [
                        styles.sceneRow,
                        {
                          backgroundColor: selected
                            ? theme.colorScheme === 'dark'
                              ? 'rgba(10,132,255,0.16)'
                              : '#EFF6FF'
                            : theme.cardBackground,
                          borderColor: selected ? 'rgba(10,132,255,0.28)' : 'rgba(15,23,42,0.06)',
                        },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.sceneIconWrap,
                          {
                            backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : '#F4F7FB',
                          },
                        ]}
                      >
                        <AppText style={styles.sceneIcon}>{item.icon}</AppText>
                      </View>

                      <View style={styles.sceneCopy}>
                        <AppText
                          style={[styles.sceneTitle, { color: selected ? '#0A84FF' : theme.textPrimary }]}
                          numberOfLines={1}
                        >
                          {item.name}
                        </AppText>
                        <AppText style={[styles.sceneSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                          {item.description}
                        </AppText>
                      </View>

                      {selected ? (
                        <View style={styles.sceneSelectedMark}>
                          <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                        </View>
                      ) : (
                        <View style={styles.sceneDot} />
                      )}
                    </Pressable>
                  );
                })}

                <View style={styles.coachSection}>
                  <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>AI Coach</AppText>
                  {COACH_PROFILES.map((profile) => {
                    const selected = profile.id === selectedCoachId;
                    return (
                      <Pressable
                        key={profile.id}
                        accessibilityRole="button"
                        onPress={() => onSelectCoach(profile.id)}
                        style={({ pressed }) => [
                          styles.coachRow,
                          {
                            backgroundColor: selected
                              ? theme.colorScheme === 'dark'
                                ? 'rgba(10,132,255,0.16)'
                                : '#EFF6FF'
                              : theme.cardBackground,
                            borderColor: selected ? 'rgba(10,132,255,0.28)' : 'rgba(15,23,42,0.06)',
                          },
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <View style={styles.coachCopy}>
                          <AppText style={[styles.coachTitle, { color: selected ? '#0A84FF' : theme.textPrimary }]}>
                            {profile.name}
                          </AppText>
                          <AppText style={[styles.coachSubtitle, { color: theme.textSecondary }]} numberOfLines={2}>
                            {profile.description}
                          </AppText>
                        </View>
                        <Ionicons
                          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={selected ? '#0A84FF' : theme.textSecondary}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            <View style={[styles.rightShell, { width: rightWidth }]}>
              <ScrollView
                style={styles.detailScroll}
                contentContainerStyle={styles.detailContent}
                showsVerticalScrollIndicator={false}
              >
                <View
                  style={[
                    styles.heroCard,
                    {
                      backgroundColor: palette.panel,
                      borderColor: palette.border,
                      ...cardShadow(theme.colorScheme, theme.shadowColor, 0.06),
                    },
                  ]}
                >
                  <View style={[styles.heroGlow, styles.heroGlowA, { backgroundColor: palette.start }]} />
                  <View style={[styles.heroGlow, styles.heroGlowB, { backgroundColor: palette.end }]} />
                  <View style={[styles.heroGlow, styles.heroGlowC, { backgroundColor: palette.washA }]} />

                  <View style={[styles.heroBadge, { backgroundColor: 'rgba(255,255,255,0.78)' }]}>
                    <AppText style={styles.heroBadgeText}>OpenAI Realtime 驱动</AppText>
                  </View>

                  <View style={[styles.heroIconBox, { backgroundColor: 'rgba(255,255,255,0.78)' }]}>
                    <AppText style={styles.heroIcon}>{activeScenario.icon}</AppText>
                  </View>

                  <AppText
                    style={[styles.heroTitle, { color: palette.title }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                  >
                    {activeScenario.name}
                  </AppText>
                  <AppText style={[styles.heroSubtitle, { color: palette.subtitle }]} numberOfLines={1}>
                    {heroSubtitle}
                  </AppText>
                </View>

                <View style={styles.metricRow}>
                  <MetricCard
                    icon="time-outline"
                    iconTint="#2563EB"
                    iconBackground="rgba(59,130,246,0.12)"
                    value={`${estimatedDuration} 分钟`}
                    label="建议时长"
                  />
                  <MetricCard
                    icon="sparkles-outline"
                    iconTint="#7C3AED"
                    iconBackground="rgba(168,85,247,0.12)"
                    value={consumptionValue}
                    label={consumptionLabel}
                  />
                </View>

                <View
                  style={[
                    styles.goalCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: 'rgba(15,23,42,0.06)',
                      ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                    },
                  ]}
                >
                  <AppText style={[styles.goalHeader, { color: theme.textSecondary }]}>通话目标</AppText>
                  {focusGoals.map((goal, index) => (
                    <View
                      key={`${activeScenario.id}-goal-${index}`}
                      style={[
                        styles.goalRow,
                        index < focusGoals.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: theme.separator,
                        },
                      ]}
                    >
                      <View style={styles.goalEmojiWrap}>
                        <AppText style={styles.goalEmoji}>
                          {index === 0 ? '🎙️' : index === 1 ? '💬' : '✅'}
                        </AppText>
                      </View>
                      <AppText style={[styles.goalText, { color: theme.textPrimary }]}>{goal}</AppText>
                    </View>
                  ))}
                </View>
              </ScrollView>

              <View style={styles.footerArea}>
                {entitlementBusy ? (
                  <AppText style={[styles.footerText, { color: theme.textSecondary }]}>正在读取账号权益</AppText>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={entitlementBusy}
                  onPress={onPressPrimary}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.primaryBlue },
                    entitlementBusy && styles.primaryButtonDisabled,
                    pressed && !entitlementBusy && styles.buttonPressed,
                  ]}
                >
                  <Ionicons name="call" size={18} color="#FFFFFF" />
                  <AppText style={styles.primaryButtonText}>开始实时通话</AppText>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { flex: 1 },
  pageInner: { flex: 1, alignSelf: 'center' },
  headerRow: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  chromeButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    marginLeft: 18,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  contentRow: { flexDirection: 'row', gap: COLUMN_GAP },
  leftShell: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    overflow: 'hidden',
  },
  rightShell: { minHeight: 0 },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', marginBottom: 18 },
  sceneListContent: { paddingBottom: 8 },
  sceneRow: {
    height: SCENARIO_ROW_HEIGHT,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SCENARIO_ROW_GAP,
    borderWidth: 1,
  },
  sceneIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  sceneIcon: { fontSize: 26 },
  sceneCopy: { flex: 1, gap: 2 },
  sceneTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  sceneSubtitle: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  sceneSelectedMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  sceneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(107,114,128,0.55)',
    marginLeft: 12,
  },
  coachSection: { marginTop: 16 },
  coachRow: {
    minHeight: 76,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
  },
  coachCopy: { flex: 1, minWidth: 0, marginRight: 12 },
  coachTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  coachSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  detailScroll: { flex: 1 },
  detailContent: { paddingBottom: 12 },
  heroCard: {
    height: 278,
    borderRadius: 26,
    padding: 30,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  heroGlow: { position: 'absolute', borderRadius: 999 },
  heroGlowA: { width: 280, height: 280, top: -84, right: -26, opacity: 0.32 },
  heroGlowB: { width: 240, height: 240, bottom: -74, left: 140, opacity: 0.24 },
  heroGlowC: { width: 180, height: 180, bottom: 24, right: 36, opacity: 0.18 },
  heroBadge: {
    position: 'absolute',
    left: 30,
    top: 24,
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#0A84FF' },
  heroIconBox: {
    width: 66,
    height: 66,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 42,
  },
  heroIcon: { fontSize: 34 },
  heroTitle: {
    marginTop: 26,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '500',
    maxWidth: '78%',
  },
  metricRow: { flexDirection: 'row', gap: 14, marginTop: 14 },
  metricCard: {
    flex: 1,
    height: 96,
    borderRadius: 20,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  metricTextWrap: { flex: 1, minWidth: 0 },
  metricValue: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.35 },
  metricLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  goalCard: {
    marginTop: 14,
    borderRadius: 22,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  goalHeader: { fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 6 },
  goalRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  goalEmojiWrap: {
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  goalEmoji: { fontSize: 18 },
  goalText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  footerArea: { marginTop: 14, gap: 10 },
  footerText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  primaryButton: {
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#0A84FF',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  primaryButtonText: { fontSize: 16, lineHeight: 20, fontWeight: '800', color: '#FFFFFF' },
  primaryButtonDisabled: { opacity: 0.56 },
  buttonPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
});
