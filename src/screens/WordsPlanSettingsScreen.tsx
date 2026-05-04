import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ActionButton, ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useVocabularyTodayPlanData } from '@/hooks/useVocabularyTodayPlanData';
import { safeBack } from '@/navigation/safeBack';
import { updateVocabularyTodayPlan, type TodayPlanResponse } from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  COLOR_BLUE,
  COLOR_GREEN,
  COLOR_GREEN_BG,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_TITLE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';

const PAGE_PADDING = 20;
const TABLET_PAGE_MAX_WIDTH = 1180;
const RHYTHM_OPTIONS = [
  {
    key: 'light',
    title: '轻松',
    detail: '少量新词，稳定复习',
  },
  {
    key: 'standard',
    title: '标准',
    detail: '新词和复习均衡',
  },
  {
    key: 'sprint',
    title: '冲刺',
    detail: '更多新词，更高复习压力',
  },
] as const;

const RHYTHM_PRESETS: Record<RhythmKey, { dailyNewTarget: number; dailyReviewTarget: number; dailyMinutesTarget: number; weeklyStudyDays: number }> = {
  light: {
    dailyNewTarget: 10,
    dailyReviewTarget: 30,
    dailyMinutesTarget: 20,
    weeklyStudyDays: 5,
  },
  standard: {
    dailyNewTarget: 20,
    dailyReviewTarget: 50,
    dailyMinutesTarget: 28,
    weeklyStudyDays: 6,
  },
  sprint: {
    dailyNewTarget: 40,
    dailyReviewTarget: 100,
    dailyMinutesTarget: 40,
    weeklyStudyDays: 6,
  },
};

type RhythmKey = (typeof RHYTHM_OPTIONS)[number]['key'];
type PlanForm = TodayPlanResponse['plan'];

function clonePlan(plan: PlanForm): PlanForm {
  return JSON.parse(JSON.stringify(plan)) as PlanForm;
}

function isSamePlan(left: PlanForm | null, right: PlanForm | null) {
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function inferRhythm(plan: PlanForm | null): RhythmKey {
  if (!plan) return 'standard';
  if (plan.dailyNewTarget >= 40 || plan.dailyReviewTarget >= 100 || plan.dailyMinutesTarget >= 40) return 'sprint';
  if (plan.dailyNewTarget <= 10 || plan.dailyReviewTarget <= 30 || plan.dailyMinutesTarget <= 20) return 'light';
  return 'standard';
}

function applyRhythmPreset(plan: PlanForm, rhythm: RhythmKey, prioritizeMistakes: boolean): PlanForm {
  const next = clonePlan(plan);
  const preset = RHYTHM_PRESETS[rhythm];
  next.dailyNewTarget = preset.dailyNewTarget;
  next.dailyReviewTarget = preset.dailyReviewTarget;
  next.dailyMinutesTarget = preset.dailyMinutesTarget;
  next.weeklyStudyDays = preset.weeklyStudyDays;

  next.dailyMistakeTarget = prioritizeMistakes ? Math.max(next.dailyMistakeTarget, Math.ceil(next.dailyReviewTarget * 0.24)) : Math.min(next.dailyMistakeTarget, 8);
  next.learningPreference = prioritizeMistakes ? 'review_first' : 'balanced';
  next.weeklyWordsTarget = next.dailyNewTarget * next.weeklyStudyDays;
  next.weeklyReviewsTarget = next.dailyReviewTarget * next.weeklyStudyDays;
  next.monthlyWordsTarget = next.weeklyWordsTarget * 4;
  next.monthlyStudyDaysTarget = Math.min(next.weeklyStudyDays * 4, 28);

  return next;
}

function buildSavePayload(form: PlanForm, prioritizeMistakes: boolean): Partial<PlanForm> {
  const dailyMistakeTarget = prioritizeMistakes
    ? Math.max(form.dailyMistakeTarget, Math.ceil(form.dailyReviewTarget * 0.24))
    : Math.min(form.dailyMistakeTarget, 8);

  return {
    ...form,
    dailyMistakeTarget,
    learningPreference: prioritizeMistakes ? 'review_first' : 'balanced',
  };
}

function ChoiceRow({
  title,
  detail,
  active,
  onPress,
}: {
  title: string;
  detail: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: active
          ? theme.colorScheme === 'dark'
            ? 'rgba(10,132,255,0.18)'
            : 'rgba(10,132,255,0.10)'
          : theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: active ? 'rgba(10,132,255,0.28)' : theme.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText style={{ fontSize: 15, fontWeight: '700', color: theme.textPrimary }}>{title}</AppText>
          <AppText style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>{detail}</AppText>
        </View>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            backgroundColor: active ? COLOR_BLUE : theme.fillSecondary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {active ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  const { theme } = useAppTheme();

  return (
    <View style={{ gap: detail ? 4 : 0 }}>
      <AppText style={{ fontSize: 18, fontWeight: '700', color: theme.textPrimary }}>{title}</AppText>
      {detail ? <AppText style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>{detail}</AppText> : null}
    </View>
  );
}

function sanitizeDigits(value: string) {
  return value.replace(/[^\d]/g, '');
}

function parseBoundedNumber(value: string, min: number, max: number) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function PlanNumberInputRow({
  title,
  detail,
  value,
  placeholder,
  onChange,
}: {
  title: string;
  detail: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={{
        borderRadius: 22,
        padding: 16,
        backgroundColor: theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: theme.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <AppText style={{ fontSize: 16, fontWeight: '700', color: theme.textPrimary }}>{title}</AppText>
        <AppText style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>{detail}</AppText>
      </View>
      <View
        style={{
          minWidth: 112,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: theme.elevatedCardBackground,
          borderWidth: 1,
          borderColor: theme.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <TextInput
          value={value}
          onChangeText={(next) => onChange(sanitizeDigits(next))}
          placeholder={placeholder}
          placeholderTextColor={theme.textTertiary}
          keyboardType="number-pad"
          textAlign="right"
          style={{
            minWidth: 44,
            padding: 0,
            fontSize: 22,
            lineHeight: 26,
            fontWeight: '700',
            color: theme.textPrimary,
          }}
        />
        <AppText style={{ fontSize: 15, fontWeight: '600', color: theme.textSecondary }}>个</AppText>
      </View>
    </View>
  );
}

export function WordsPlanSettingsScreen() {
  const { theme } = useAppTheme();
  const { isTablet } = useDeviceClass();
  const session = useAppSession();
  const { plan, loading, error, authRequired, refresh } = useVocabularyTodayPlanData();
  const [form, setForm] = useState<PlanForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [rhythm, setRhythm] = useState<RhythmKey>('standard');
  const [prioritizeMistakes, setPrioritizeMistakes] = useState(false);
  const [dailyNewInput, setDailyNewInput] = useState('');
  const [dailyReviewInput, setDailyReviewInput] = useState('');

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh]),
  );

  useEffect(() => {
    if (!plan?.plan) return;
    const nextForm = clonePlan(plan.plan);
    setForm(nextForm);
    setRhythm(inferRhythm(nextForm));
    setPrioritizeMistakes(nextForm.learningPreference === 'review_first' || nextForm.dailyMistakeTarget > 8);
    setDailyNewInput(String(nextForm.dailyNewTarget));
    setDailyReviewInput(String(nextForm.dailyReviewTarget));
  }, [plan]);

  const focusBook = plan?.books.find((item) => item.slug === form?.focusBookSlug) ?? plan?.books.find((item) => item.slug === plan?.summary.focusBook.slug) ?? null;
  const hasChanges = useMemo(() => !isSamePlan(form, plan?.plan ?? null), [form, plan?.plan]);

  const applyLearningPreference = useCallback(
    (nextRhythm: RhythmKey, nextPrioritizeMistakes = prioritizeMistakes) => {
      setRhythm(nextRhythm);
      setForm((current) => {
        if (!current) return current;
        const nextPlan = applyRhythmPreset(current, nextRhythm, nextPrioritizeMistakes);
        setDailyNewInput(String(nextPlan.dailyNewTarget));
        setDailyReviewInput(String(nextPlan.dailyReviewTarget));
        return nextPlan;
      });
      setSaveHint(null);
    },
    [prioritizeMistakes],
  );

  const handleToggleMistakePriority = useCallback(() => {
    setPrioritizeMistakes((current) => {
      const nextValue = !current;
      applyLearningPreference(rhythm, nextValue);
      setSaveHint(null);
      return nextValue;
    });
  }, [applyLearningPreference, rhythm]);

  const handleSave = useCallback(async () => {
    if (!session.session || !form) {
      if (authRequired || session.status !== 'authenticated') {
        router.push('/auth/sign-in');
        return;
      }
      return;
    }

    const nextDailyNewTarget = parseBoundedNumber(dailyNewInput, 1, 300);
    if (nextDailyNewTarget === null) {
      Alert.alert('请输入有效数量', '每日新词需要输入 1 到 300 之间的数字。');
      return;
    }

    const nextDailyReviewTarget = parseBoundedNumber(dailyReviewInput, 1, 1000);
    if (nextDailyReviewTarget === null) {
      Alert.alert('请输入有效数量', '每日复习上限需要输入 1 到 1000 之间的数字。');
      return;
    }

    const nextForm = {
      ...form,
      dailyNewTarget: nextDailyNewTarget,
      dailyReviewTarget: nextDailyReviewTarget,
    };

    setSaving(true);
    setSaveHint(null);
    try {
      const next = await updateVocabularyTodayPlan(session.session, buildSavePayload(nextForm, prioritizeMistakes));
      setForm(clonePlan(next.plan));
      setRhythm(inferRhythm(next.plan));
      setPrioritizeMistakes(next.plan.learningPreference === 'review_first' || next.plan.dailyMistakeTarget > 8);
      setDailyNewInput(String(next.plan.dailyNewTarget));
      setDailyReviewInput(String(next.plan.dailyReviewTarget));
      setSaveHint('学习计划已更新');
      Alert.alert('学习计划已更新');
    } catch (saveError) {
      Alert.alert('保存失败', getVocabularyUserErrorMessage(saveError, 'today_plan_save'));
    } finally {
      setSaving(false);
    }
  }, [authRequired, dailyNewInput, dailyReviewInput, form, prioritizeMistakes, session.session, session.status]);

  if (session.isHydrating || (loading && !form)) {
    return (
      <AppScreenShell scrollable={false} includeBottomInset={false} disableTabletTopInset={isTablet}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={TEXT_SECONDARY} />
        </View>
      </AppScreenShell>
    );
  }

  if (authRequired || session.status !== 'authenticated') {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
          <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        </View>
        <SurfaceCard style={{ marginHorizontal: PAGE_PADDING, padding: 20 }}>
          <View style={{ gap: 12 }}>
            <AppText style={{ fontSize: 24, fontWeight: '700', color: TEXT_PRIMARY }}>登录后同步学习计划</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
              登录后可以同步你的词汇计划，用于生成今日安排、新词数量和复习压力。
            </AppText>
            <ActionButton label="去登录" onPress={() => router.push('/auth/sign-in')} />
          </View>
        </SurfaceCard>
        </View>
      </AppScreenShell>
    );
  }

  if (!form) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
          <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        </View>
        <SurfaceCard style={{ marginHorizontal: PAGE_PADDING, padding: 20 }}>
          <View style={{ gap: 12 }}>
            <AppText style={{ fontSize: 24, fontWeight: '700', color: TEXT_PRIMARY }}>学习计划暂时不可用</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
              {error ?? '当前没有成功读取到学习计划，请稍后重试。'}
            </AppText>
            <ActionButton label="重新加载" onPress={() => void refresh()} />
          </View>
        </SurfaceCard>
        </View>
      </AppScreenShell>
    );
  }

  const focusBookCard = (
    <SurfaceCard style={{ gap: 14 }}>
      <SectionHeader title="主攻词书" detail="今日新词会优先从当前主攻词书生成。" />
      <View
        style={{
          borderRadius: 18,
          padding: 16,
          backgroundColor: theme.secondaryCardBackground,
          borderWidth: 1,
          borderColor: theme.border,
          gap: 4,
        }}
      >
        <AppText style={{ fontSize: 16, fontWeight: '700', color: TEXT_PRIMARY }}>
          {focusBook?.title ?? '请选择主攻词书'}
        </AppText>
        <AppText style={{ fontSize: 13, lineHeight: 19, color: TEXT_SECONDARY }}>
          {focusBook ? `${focusBook.wordCount} 词 · 当前计划会围绕它生成` : '先设定主攻方向，再安排每日新词'}
        </AppText>
      </View>
      <ActionButton label="更换词书" variant="secondary" onPress={() => router.push('/words/books')} />
    </SurfaceCard>
  );
  const dailyNewCard = (
    <SurfaceCard style={{ gap: 14 }}>
      <PlanNumberInputRow
        title="每日新词"
        detail="每天学习多少个新单词"
        value={dailyNewInput}
        placeholder="20"
        onChange={(next) => {
          setDailyNewInput(next);
          const parsed = parseBoundedNumber(next, 1, 300);
          if (parsed !== null) {
            setForm((current) => (current ? { ...current, dailyNewTarget: parsed } : current));
          }
          setSaveHint(null);
        }}
      />
    </SurfaceCard>
  );
  const dailyReviewCard = (
    <SurfaceCard style={{ gap: 14 }}>
      <PlanNumberInputRow
        title="每日复习上限"
        detail="控制每天复习压力"
        value={dailyReviewInput}
        placeholder="120"
        onChange={(next) => {
          setDailyReviewInput(next);
          const parsed = parseBoundedNumber(next, 1, 1000);
          if (parsed !== null) {
            setForm((current) => (current ? { ...current, dailyReviewTarget: parsed } : current));
          }
          setSaveHint(null);
        }}
      />
    </SurfaceCard>
  );
  const prioritizeMistakesCard = (
    <SurfaceCard style={{ gap: 14 }}>
      <SectionHeader title="错词优先" detail="开启后，今日计划会优先安排错词强化和复习。" />
      <ChoiceRow
        title={prioritizeMistakes ? '已开启错词优先' : '按正常节奏推进'}
        detail={prioritizeMistakes ? '当前会优先清理错词和到期词，再安排新词。' : '当前按均衡节奏安排新词、复习和错词。'}
        active={prioritizeMistakes}
        onPress={handleToggleMistakePriority}
      />
    </SurfaceCard>
  );
  const rhythmCard = (
    <SurfaceCard style={{ gap: 14 }}>
      <SectionHeader title="学习节奏" detail="这是对新词、复习时长和学习天数的计划预设。" />
      <View style={{ gap: 10 }}>
        {RHYTHM_OPTIONS.map((option) => (
          <ChoiceRow
            key={option.key}
            title={option.title}
            detail={option.detail}
            active={rhythm === option.key}
            onPress={() => applyLearningPreference(option.key)}
          />
        ))}
      </View>
    </SurfaceCard>
  );
  const rulesCard = (
    <SurfaceCard style={{ gap: 10 }}>
      <SectionHeader title="今日计划生成依据" />
      <AppText style={{ fontSize: FONT_BODY, lineHeight: 22, color: TEXT_SECONDARY }}>
        系统会结合主攻词书、每日新词、每日复习上限、错词优先和学习节奏，生成首页与今日计划页的任务安排。
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.secondaryCardBackground }}>
          <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '700', color: theme.textTertiary }}>{`新词 ${form.dailyNewTarget}`}</AppText>
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.secondaryCardBackground }}>
          <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '700', color: theme.textTertiary }}>{`复习 ${form.dailyReviewTarget}`}</AppText>
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.secondaryCardBackground }}>
          <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '700', color: theme.textTertiary }}>{prioritizeMistakes ? '错词优先' : '均衡安排'}</AppText>
        </View>
      </View>
    </SurfaceCard>
  );

  return (
    <AppScreenShell
      showsVerticalScrollIndicator={false}
      includeBottomInset={false}
      contentContainerStyle={{ paddingBottom: 32, backgroundColor: theme.pageBackground }}
      disableTabletTopInset={isTablet}
    >
      <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
      <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: isTablet ? 8 : 16, paddingBottom: 14, gap: 12 }}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        <View style={{ gap: 6 }}>
          <AppText style={{ fontSize: 32, lineHeight: 38, fontWeight: '700', color: TEXT_PRIMARY }}>学习计划</AppText>
          <AppText style={{ fontSize: 15, lineHeight: 22, color: TEXT_SECONDARY }}>
            控制每天的新词、复习压力、主攻词书和今日安排依据。
          </AppText>
        </View>
        {saveHint ? (
          <View
            style={{
              alignSelf: 'flex-start',
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 7,
              backgroundColor: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.16)' : COLOR_GREEN_BG,
            }}
          >
            <AppText style={{ fontSize: 12, fontWeight: '700', color: COLOR_GREEN }}>{saveHint}</AppText>
          </View>
          ) : null}
      </View>

      {isTablet ? (
        <View style={{ paddingHorizontal: PAGE_PADDING, gap: 16 }}>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0, gap: 14 }}>
              {focusBookCard}
              {dailyNewCard}
              {dailyReviewCard}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 14 }}>
              {prioritizeMistakesCard}
              {rhythmCard}
              {rulesCard}
            </View>
          </View>
        </View>
      ) : (
        <View style={{ paddingHorizontal: PAGE_PADDING, gap: 14 }}>
          {focusBookCard}
          {dailyNewCard}
          {dailyReviewCard}
          {prioritizeMistakesCard}
          {rhythmCard}
          {rulesCard}
        </View>
      )}

      <View
        style={{
          paddingHorizontal: PAGE_PADDING,
          paddingTop: 20,
          alignItems: isTablet ? 'flex-end' : 'stretch',
        }}
      >
        <View style={{ width: isTablet ? 320 : '100%' }}>
          <ActionButton
            label={saving ? '保存中…' : hasChanges ? '保存计划' : '计划已同步'}
            disabled={saving || !hasChanges}
            onPress={() => void handleSave()}
          />
        </View>
      </View>
      </View>
    </AppScreenShell>
  );
}
