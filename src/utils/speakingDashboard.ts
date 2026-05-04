import type { SpeakingSession } from '@/services/api/speakingSessions';

export type NormalizedSpeakingScoreSource = 'v1_flat' | 'v2_review_payload' | 'unknown';
export type SpeakingRadarMetricKey =
  | 'fluency'
  | 'pronunciation'
  | 'vocabulary'
  | 'grammar'
  | 'logic';

export type NormalizedSpeakingScore = {
  sessionId: string;
  scenarioId: string | null;
  startedAt: string | null;
  status: string | null;
  overall: number | null;
  fluency: number | null;
  pronunciation: number | null;
  accuracy: number | null;
  vocabulary: number | null;
  grammar: number | null;
  coherence: number | null;
  logic: number | null;
  suggestion: string | null;
  source: NormalizedSpeakingScoreSource;
};

export type SpeakingDashboardAdviceItem = {
  title: string;
  subtitle: string;
  isFallback: boolean;
};

export type SpeakingDashboardRadarMetric = {
  key: SpeakingRadarMetricKey;
  label: string;
  value: number | null;
};

export type SpeakingAbilityMetricsResult = {
  metrics: SpeakingDashboardRadarMetric[];
  isEmpty: boolean;
  usesFallback: boolean;
  subtitle: string;
  session: SpeakingSession | null;
  normalized: NormalizedSpeakingScore | null;
};

export type SpeakingAdviceResult = {
  items: SpeakingDashboardAdviceItem[];
  isFallback: boolean;
  session: SpeakingSession | null;
};

export type SpeakingPerformanceLabel = {
  title: string;
  subtitle: string;
  scoreText: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function readMetricValue(metrics: Record<string, unknown> | null, key: string): number | null {
  return readNumber(asRecord(metrics?.[key])?.value);
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function normalizeSuggestionCandidate(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return parts.length ? parts.join('。') : null;
  }
  return null;
}

function splitSuggestionText(value: string | null) {
  if (!value) return [];

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentenceParts = normalized
    .split(/[。！？!?；;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const commaParts = normalized
    .split(/[，,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const parts =
    sentenceParts.length >= 2
      ? sentenceParts
      : commaParts.length >= 2
        ? commaParts
        : [normalized];

  return parts.slice(0, 3);
}

function getRadarMetricValue(
  normalized: NormalizedSpeakingScore,
  key: SpeakingRadarMetricKey,
) {
  if (key === 'fluency') {
    return {
      value: normalized.fluency ?? normalized.overall,
      usedFallback: normalized.fluency == null && normalized.overall != null,
    };
  }
  if (key === 'pronunciation') {
    const direct = normalized.pronunciation ?? normalized.accuracy;
    return {
      value: direct ?? normalized.overall,
      usedFallback: direct == null && normalized.overall != null,
    };
  }
  if (key === 'vocabulary') {
    return {
      value: normalized.vocabulary ?? normalized.overall,
      usedFallback: normalized.vocabulary == null && normalized.overall != null,
    };
  }
  if (key === 'grammar') {
    const direct = normalized.grammar ?? normalized.accuracy;
    return {
      value: direct ?? normalized.overall,
      usedFallback: direct == null && normalized.overall != null,
    };
  }

  const direct = normalized.logic ?? normalized.coherence;
  return {
    value: direct ?? normalized.overall,
    usedFallback: direct == null && normalized.overall != null,
  };
}

function emptySpeakingAbilityMetrics(): SpeakingAbilityMetricsResult {
  return {
    metrics: [
      { key: 'fluency', label: '流利度', value: null },
      { key: 'pronunciation', label: '发音', value: null },
      { key: 'vocabulary', label: '词汇', value: null },
      { key: 'grammar', label: '语法', value: null },
      { key: 'logic', label: '逻辑', value: null },
    ],
    isEmpty: true,
    usesFallback: false,
    subtitle: '完成一次练习后生成能力雷达',
    session: null,
    normalized: null,
  };
}

export function normalizeSpeakingScore(
  session: SpeakingSession,
): NormalizedSpeakingScore {
  const payload = asRecord(session.score_json);
  const metrics = asRecord(payload?.metrics);
  const scoreSummary = asRecord(payload?.scoreSummary);
  const summary = asRecord(payload?.summary);
  const hasV2Metrics =
    readMetricValue(metrics, 'overall') != null ||
    readMetricValue(metrics, 'pronunciation') != null ||
    readMetricValue(metrics, 'fluency') != null ||
    readMetricValue(metrics, 'grammar') != null;
  const hasV1Flat =
    readNumber(payload?.overall) != null ||
    readNumber(payload?.fluency) != null ||
    readNumber(payload?.accuracy) != null ||
    readNumber(payload?.vocabulary) != null ||
    readNumber(payload?.grammar) != null ||
    readNumber(payload?.coherence) != null ||
    normalizeSuggestionCandidate(payload?.suggestion) != null;

  const overall =
    readMetricValue(metrics, 'overall') ??
    readNumber(payload?.overall) ??
    readNumber(scoreSummary?.overall) ??
    readNumber(summary?.overall) ??
    readNumber(payload?.finalScore) ??
    readNumber(payload?.score);

  const accuracy =
    readNumber(payload?.accuracy) ??
    readNumber(scoreSummary?.accuracy) ??
    readNumber(summary?.accuracy) ??
    readMetricValue(metrics, 'pronunciation') ??
    overall;

  const pronunciation =
    readMetricValue(metrics, 'pronunciation') ??
    readNumber(payload?.pronunciation) ??
    accuracy ??
    overall;

  const fluency =
    readMetricValue(metrics, 'fluency') ??
    readNumber(payload?.fluency) ??
    readNumber(scoreSummary?.fluency) ??
    readNumber(summary?.fluency) ??
    overall;

  const vocabulary =
    readNumber(payload?.vocabulary) ??
    readNumber(scoreSummary?.vocabulary) ??
    readNumber(summary?.vocabulary) ??
    overall;

  const coherence =
    readNumber(payload?.coherence) ??
    readNumber(payload?.logic) ??
    readNumber(scoreSummary?.coherence) ??
    readNumber(summary?.coherence);

  const logic =
    readNumber(payload?.logic) ??
    readNumber(payload?.coherence) ??
    readNumber(scoreSummary?.logic) ??
    readNumber(summary?.logic);

  const grammar =
    readMetricValue(metrics, 'grammar') ??
    readNumber(payload?.grammar) ??
    accuracy ??
    overall;

  const suggestion =
    normalizeSuggestionCandidate(payload?.aiCoachFeedback) ??
    normalizeSuggestionCandidate(payload?.suggestion) ??
    normalizeSuggestionCandidate(payload?.feedback) ??
    normalizeSuggestionCandidate(payload?.advice);

  return {
    sessionId: session.id,
    scenarioId: session.scenario_id ?? null,
    startedAt: session.started_at ?? null,
    status: session.status ?? null,
    overall,
    fluency,
    pronunciation,
    accuracy,
    vocabulary,
    grammar,
    coherence,
    logic,
    suggestion,
    source: hasV2Metrics ? 'v2_review_payload' : hasV1Flat ? 'v1_flat' : 'unknown',
  };
}

export function getLatestScoredSession(history: SpeakingSession[]) {
  return history.find((session) => normalizeSpeakingScore(session).overall != null) ?? null;
}

export function buildSpeakingAbilityMetrics(
  history: SpeakingSession[],
): SpeakingAbilityMetricsResult {
  const session = getLatestScoredSession(history);
  const normalized = session ? normalizeSpeakingScore(session) : null;

  if (!normalized || normalized.overall == null) {
    return emptySpeakingAbilityMetrics();
  }

  return buildSpeakingAbilityMetricsFromNormalized(normalized, session);
}

export function buildSpeakingAbilityMetricsFromNormalized(
  normalized: NormalizedSpeakingScore | null,
  session: SpeakingSession | null = null,
): SpeakingAbilityMetricsResult {
  if (!normalized || normalized.overall == null) {
    return emptySpeakingAbilityMetrics();
  }

  const fluency = getRadarMetricValue(normalized, 'fluency');
  const pronunciation = getRadarMetricValue(normalized, 'pronunciation');
  const vocabulary = getRadarMetricValue(normalized, 'vocabulary');
  const grammar = getRadarMetricValue(normalized, 'grammar');
  const logic = getRadarMetricValue(normalized, 'logic');
  const usesFallback =
    fluency.usedFallback ||
    pronunciation.usedFallback ||
    vocabulary.usedFallback ||
    grammar.usedFallback ||
    logic.usedFallback;

  return {
    metrics: [
      { key: 'fluency', label: '流利度', value: fluency.value },
      { key: 'pronunciation', label: '发音', value: pronunciation.value },
      { key: 'vocabulary', label: '词汇', value: vocabulary.value },
      { key: 'grammar', label: '语法', value: grammar.value },
      { key: 'logic', label: '逻辑', value: logic.value },
    ],
    isEmpty: false,
    usesFallback,
    subtitle: usesFallback
      ? '基于最近一次可用评分，缺失维度按综合表现补齐'
      : '基于最近一次可用评分',
    session,
    normalized,
  };
}

export function buildSpeakingAdviceFromSuggestion(
  suggestion: string | null,
  session: SpeakingSession | null = null,
): SpeakingAdviceResult {
  const parts = splitSuggestionText(suggestion);
  if (parts.length > 0) {
    return {
      items: parts.map((part) => ({
        title: part,
        subtitle: '来自最近一次可用评分',
        isFallback: false,
      })),
      isFallback: false,
      session,
    };
  }

  return {
    items: [
      {
        title: '完成一次口语练习后，系统会生成个性化建议',
        subtitle: '建议会来自逐句评分或通话复盘',
        isFallback: true,
      },
      {
        title: '查看练习记录中的评分反馈',
        subtitle: '回顾最近一次练习的改进方向',
        isFallback: true,
      },
    ],
    isFallback: true,
    session: null,
  };
}

export function buildSpeakingAdvice(
  history: SpeakingSession[],
): SpeakingAdviceResult {
  const session =
    history.find(
      (item) =>
        item.status === 'completed' && normalizeSpeakingScore(item).suggestion,
    ) ??
    history.find((item) => normalizeSpeakingScore(item).suggestion) ??
    null;

  const suggestion = session ? normalizeSpeakingScore(session).suggestion : null;
  return buildSpeakingAdviceFromSuggestion(suggestion, session);
}

export function deriveSpeakingPerformanceLabel(
  score: number | null,
): SpeakingPerformanceLabel {
  if (score == null) {
    return {
      title: '待生成',
      subtitle: '完成一次练习后生成近期表现',
      scoreText: '--',
    };
  }

  if (score >= 90) {
    return {
      title: '优秀表达',
      subtitle: '基于最近一次可用评分',
      scoreText: String(Math.round(score)),
    };
  }
  if (score >= 80) {
    return {
      title: '稳定进阶',
      subtitle: '基于最近一次可用评分',
      scoreText: String(Math.round(score)),
    };
  }
  if (score >= 70) {
    return {
      title: '基础扎实',
      subtitle: '基于最近一次可用评分',
      scoreText: String(Math.round(score)),
    };
  }
  if (score >= 60) {
    return {
      title: '继续巩固',
      subtitle: '基于最近一次可用评分',
      scoreText: String(Math.round(score)),
    };
  }
  return {
    title: '重点强化',
    subtitle: '基于最近一次可用评分',
    scoreText: String(Math.round(score)),
  };
}
