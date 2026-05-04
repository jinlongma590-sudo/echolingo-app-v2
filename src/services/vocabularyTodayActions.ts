import type { Href } from 'expo-router';

import type { ReviewMode } from '@/services/api/vocabulary';

export type VocabularyTodayActionType =
  | 'learn_plan'
  | 'learn_extra'
  | 'review_plan'
  | 'review_extra'
  | 'mistake_review'
  | 'analysis';

export type VocabularyTodayActionSource = 'plan' | 'extra' | 'direct';

export type VocabularyTodayActionRouteInput = {
  actionType: VocabularyTodayActionType;
  source: VocabularyTodayActionSource;
  focusBookSlug?: string;
};

export type VocabularyTodayActionContext = {
  dueNowCount: number;
  mistakeCount: number;
  plannedNew: number;
  plannedReview: number;
  plannedMistake: number;
  completedNew: number;
  completedReview: number;
  completedMistake: number;
  remainingNew?: number;
  remainingReview?: number;
  remainingMistake?: number;
  extraDueReviewAvailable?: number;
  focusBookSlug?: string;
  focusBookRemainingWords?: number;
};

export type VocabularyTodayResolvedRoute = {
  actionType: VocabularyTodayActionType;
  title: string;
  subtitle: string;
  chips: string[];
  ctaLabel: string;
  disabled: boolean;
  disabledReason: string;
  href?: Href;
  routeTarget: string | null;
  mode: ReviewMode | null;
  source: VocabularyTodayActionSource | null;
  bookSlug?: string;
  priority: number;
  plannedCount: number;
  completedCount: number;
  remainingCount: number;
  dueCount: number;
  extraAvailableCount: number;
  isPlanTask: boolean;
  isExtraTask: boolean;
};

function toReviewHref(
  mode: ReviewMode,
  options?: {
    bookSlug?: string;
    source?: VocabularyTodayActionSource;
    resume?: boolean;
  },
): Href {
  const params: Record<string, string> = { mode };
  if (options?.bookSlug) params.bookSlug = options.bookSlug;
  if (options?.source) params.source = options.source;
  if (options?.resume ?? true) params.resume = 'true';
  return { pathname: '/words/review', params };
}

function toHrefString(href?: Href) {
  if (!href) return null;
  if (typeof href === 'string') return href;
  const pathname = href.pathname;
  const params = href.params
    ? Object.entries(href.params)
        .filter(([, value]) => value != null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
    : '';
  return params ? `${pathname}?${params}` : pathname;
}

export function getVocabularyTodayRemainingCounts(context: VocabularyTodayActionContext) {
  const remainingNew = Math.max(context.remainingNew ?? context.plannedNew - context.completedNew, 0);
  const remainingReview = Math.max(context.remainingReview ?? context.plannedReview - context.completedReview, 0);
  const remainingMistake = Math.max(context.remainingMistake ?? context.plannedMistake - context.completedMistake, 0);
  const extraDueReviewAvailable = Math.max(
    context.extraDueReviewAvailable ?? context.dueNowCount - remainingReview,
    0,
  );

  return {
    remainingNew,
    remainingReview,
    remainingMistake,
    extraDueReviewAvailable,
  };
}

function createResolvedRoute(
  input: Omit<VocabularyTodayResolvedRoute, 'routeTarget'> & { href?: Href },
): VocabularyTodayResolvedRoute {
  return {
    ...input,
    routeTarget: toHrefString(input.href),
  };
}

export function resolveVocabularyTodayActionRoute(
  input: VocabularyTodayActionRouteInput,
  context: VocabularyTodayActionContext,
): VocabularyTodayResolvedRoute {
  const { remainingNew, remainingReview, remainingMistake, extraDueReviewAvailable } =
    getVocabularyTodayRemainingCounts(context);
  const bookSlug = input.focusBookSlug ?? context.focusBookSlug;

  if (input.actionType === 'learn_plan') {
    if (!bookSlug) {
      return createResolvedRoute({
        actionType: 'learn_plan',
        title: '先选择词书',
        subtitle: '设定主攻词书后，今天的新词任务才会开始生成。',
        chips: ['未设置主攻词书'],
        ctaLabel: '选择词书',
        disabled: false,
        disabledReason: 'focus_book_missing',
        href: '/words/books',
        mode: null,
        source: null,
        priority: 40,
        plannedCount: context.plannedNew,
        completedCount: context.completedNew,
        remainingCount: remainingNew,
        dueCount: context.dueNowCount,
        extraAvailableCount: extraDueReviewAvailable,
        isPlanTask: true,
        isExtraTask: false,
      });
    }

    if (remainingNew <= 0) {
      return createResolvedRoute({
        actionType: 'learn_plan',
        title: '今日新词计划已完成',
        subtitle: '今天计划内的新词已经完成。想继续推进词书，可以去继续训练里再学一轮。',
        chips: [`已完成 ${context.completedNew}`, `计划 ${context.plannedNew}`],
        ctaLabel: '今日新词计划已完成',
        disabled: true,
        disabledReason: 'new_plan_completed',
        mode: 'learn',
        source: 'plan',
        bookSlug,
        priority: 40,
        plannedCount: context.plannedNew,
        completedCount: context.completedNew,
        remainingCount: remainingNew,
        dueCount: context.dueNowCount,
        extraAvailableCount: extraDueReviewAvailable,
        isPlanTask: true,
        isExtraTask: false,
      });
    }

    const href = toReviewHref('learn', { bookSlug, source: 'plan' });
    return createResolvedRoute({
      actionType: 'learn_plan',
      title: '学习今日新词',
      subtitle: `今天还可以学习 ${remainingNew} 个新词，继续稳定推进主攻词书。`,
      chips: [`计划内剩余 ${remainingNew}`, `已完成 ${context.completedNew}`],
      ctaLabel: '学习新词',
      disabled: false,
      disabledReason: 'ready',
      href,
      mode: 'learn',
      source: 'plan',
      bookSlug,
      priority: 40,
      plannedCount: context.plannedNew,
      completedCount: context.completedNew,
      remainingCount: remainingNew,
      dueCount: context.dueNowCount,
      extraAvailableCount: extraDueReviewAvailable,
      isPlanTask: true,
      isExtraTask: false,
    });
  }

  if (input.actionType === 'learn_extra') {
    if (!bookSlug) {
      return createResolvedRoute({
        actionType: 'learn_extra',
        title: '先选择词书',
        subtitle: '设定主攻词书后，才可以继续额外学习新词。',
        chips: ['未设置主攻词书'],
        ctaLabel: '选择词书',
        disabled: false,
        disabledReason: 'focus_book_missing',
        href: '/words/books',
        mode: null,
        source: null,
        priority: 35,
        plannedCount: context.plannedNew,
        completedCount: context.completedNew,
        remainingCount: Math.max(context.focusBookRemainingWords ?? 0, 0),
        dueCount: context.dueNowCount,
        extraAvailableCount: extraDueReviewAvailable,
        isPlanTask: false,
        isExtraTask: true,
      });
    }

    const remainingBookWords = Math.max(context.focusBookRemainingWords ?? 0, 0);
    if (remainingBookWords <= 0) {
      return createResolvedRoute({
        actionType: 'learn_extra',
        title: '当前词书已学完',
        subtitle: '这本主攻词书已经没有可继续学习的新词了，可以切换下一本词书。',
        chips: ['词书剩余 0'],
        ctaLabel: '选择词书',
        disabled: false,
        disabledReason: 'focus_book_completed',
        href: '/words/books',
        mode: null,
        source: null,
        bookSlug,
        priority: 35,
        plannedCount: context.plannedNew,
        completedCount: context.completedNew,
        remainingCount: 0,
        dueCount: context.dueNowCount,
        extraAvailableCount: extraDueReviewAvailable,
        isPlanTask: false,
        isExtraTask: true,
      });
    }

    const href = toReviewHref('learn', { bookSlug, source: 'extra' });
    return createResolvedRoute({
      actionType: 'learn_extra',
      title: '继续学习新词',
      subtitle:
        remainingNew <= 0
          ? '今日新词计划已完成，也可以继续推进主攻词书。'
          : '计划内学完后，也可以继续多学一轮新词。',
      chips: [`词书剩余 ${remainingBookWords}`, `今日已学 ${context.completedNew}`],
      ctaLabel: '继续学习',
      disabled: false,
      disabledReason: 'ready',
      href,
      mode: 'learn',
      source: 'extra',
      bookSlug,
      priority: 34,
      plannedCount: context.plannedNew,
      completedCount: context.completedNew,
      remainingCount: remainingBookWords,
      dueCount: context.dueNowCount,
      extraAvailableCount: extraDueReviewAvailable,
      isPlanTask: false,
      isExtraTask: true,
    });
  }

  if (input.actionType === 'review_plan') {
    if (remainingReview <= 0) {
      return createResolvedRoute({
        actionType: 'review_plan',
        title: '今日复习计划已完成',
        subtitle:
          extraDueReviewAvailable > 0
            ? `今天计划内复习已经完成，还有 ${extraDueReviewAvailable} 个到期词可继续加练。`
            : '今天计划内的到期复习已经完成。',
        chips:
          extraDueReviewAvailable > 0
            ? [`已完成 ${context.completedReview}`, `可加练 ${extraDueReviewAvailable}`]
            : [`已完成 ${context.completedReview}`, `计划 ${context.plannedReview}`],
        ctaLabel: '今日复习计划已完成',
        disabled: true,
        disabledReason: context.dueNowCount <= 0 ? 'no_due_words' : 'review_plan_completed',
        mode: 'review',
        source: 'plan',
        bookSlug,
        priority: 90,
        plannedCount: context.plannedReview,
        completedCount: context.completedReview,
        remainingCount: remainingReview,
        dueCount: context.dueNowCount,
        extraAvailableCount: extraDueReviewAvailable,
        isPlanTask: true,
        isExtraTask: false,
      });
    }

    const href = toReviewHref('review', { bookSlug, source: 'plan' });
    return createResolvedRoute({
      actionType: 'review_plan',
      title: '复习到期词',
      subtitle: `今天计划内还剩 ${remainingReview} 个到期复习，先把记忆曲线接上更稳。`,
      chips: [`到期 ${context.dueNowCount}`, `计划内剩余 ${remainingReview}`, `已完成 ${context.completedReview}`],
      ctaLabel: '去复习',
      disabled: false,
      disabledReason: 'ready',
      href,
      mode: 'review',
      source: 'plan',
      bookSlug,
      priority: 90,
      plannedCount: context.plannedReview,
      completedCount: context.completedReview,
      remainingCount: remainingReview,
      dueCount: context.dueNowCount,
      extraAvailableCount: extraDueReviewAvailable,
      isPlanTask: true,
      isExtraTask: false,
    });
  }

  if (input.actionType === 'review_extra') {
    if (extraDueReviewAvailable <= 0 || context.dueNowCount <= 0) {
      return createResolvedRoute({
        actionType: 'review_extra',
        title: '当前没有可加练的到期词',
        subtitle: '计划内复习之外，当前没有额外到期词需要继续处理。',
        chips: [`到期 ${context.dueNowCount}`],
        ctaLabel: '当前没有可加练的到期词',
        disabled: true,
        disabledReason: 'no_extra_due_review',
        mode: 'review',
        source: 'extra',
        bookSlug,
        priority: 30,
        plannedCount: context.plannedReview,
        completedCount: context.completedReview,
        remainingCount: 0,
        dueCount: context.dueNowCount,
        extraAvailableCount: extraDueReviewAvailable,
        isPlanTask: false,
        isExtraTask: true,
      });
    }

    const href = toReviewHref('review', { bookSlug, source: 'extra' });
    return createResolvedRoute({
      actionType: 'review_extra',
      title: '继续加练到期词',
      subtitle: `今天计划内复习已完成，还有 ${extraDueReviewAvailable} 个到期词可继续巩固。`,
      chips: [`可加练 ${extraDueReviewAvailable}`, `到期 ${context.dueNowCount}`],
      ctaLabel: '继续加练',
      disabled: false,
      disabledReason: 'ready',
      href,
      mode: 'review',
      source: 'extra',
      bookSlug,
      priority: 30,
      plannedCount: context.plannedReview,
      completedCount: context.completedReview,
      remainingCount: 0,
      dueCount: context.dueNowCount,
      extraAvailableCount: extraDueReviewAvailable,
      isPlanTask: false,
      isExtraTask: true,
    });
  }

  if (input.actionType === 'mistake_review') {
    if (remainingMistake <= 0 || context.mistakeCount <= 0) {
      return createResolvedRoute({
        actionType: 'mistake_review',
        title: '错词强化完成',
        subtitle: context.mistakeCount <= 0 ? '当前没有需要处理的错词。' : '今天的错词强化计划已经完成。',
        chips: [`已处理 ${context.completedMistake}`, `计划 ${context.plannedMistake}`],
        ctaLabel: '错词强化完成',
        disabled: true,
        disabledReason: context.mistakeCount <= 0 ? 'no_mistake_words' : 'mistake_plan_completed',
        mode: 'mistake',
        source: input.source,
        bookSlug,
        priority: 70,
        plannedCount: context.plannedMistake,
        completedCount: context.completedMistake,
        remainingCount: remainingMistake,
        dueCount: context.dueNowCount,
        extraAvailableCount: extraDueReviewAvailable,
        isPlanTask: true,
        isExtraTask: false,
      });
    }

    const href = toReviewHref('mistake', { bookSlug, source: input.source });
    return createResolvedRoute({
      actionType: 'mistake_review',
      title: '安排错词强化',
      subtitle: `今天还剩 ${remainingMistake} 个错词强化任务，先压薄弱点更稳。`,
      chips: [`错词 ${context.mistakeCount}`, `计划内剩余 ${remainingMistake}`, `已处理 ${context.completedMistake}`],
      ctaLabel: '去强化',
      disabled: false,
      disabledReason: 'ready',
      href,
      mode: 'mistake',
      source: input.source,
      bookSlug,
      priority: 70,
      plannedCount: context.plannedMistake,
      completedCount: context.completedMistake,
      remainingCount: remainingMistake,
      dueCount: context.dueNowCount,
      extraAvailableCount: extraDueReviewAvailable,
      isPlanTask: true,
      isExtraTask: false,
    });
  }

  return createResolvedRoute({
    actionType: 'analysis',
    title: '查看学习分析',
    subtitle: '回看当前节奏、薄弱项和下一步建议。',
    chips: [],
    ctaLabel: '查看分析',
    disabled: false,
    disabledReason: 'ready',
    href: '/words/analysis',
    mode: null,
    source: null,
    bookSlug,
    priority: 10,
    plannedCount: 0,
    completedCount: 0,
    remainingCount: 0,
    dueCount: context.dueNowCount,
    extraAvailableCount: extraDueReviewAvailable,
    isPlanTask: false,
    isExtraTask: false,
  });
}
