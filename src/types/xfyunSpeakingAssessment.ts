export interface XfyunTranscriptResult {
  provider: 'xfyun';
  engine: 'rtasr';
  text: string;
  isFinal: boolean;
  startedAt: number;
  endedAt: number;
  latencyMs: number;
}

export interface XfyunPhoneAssessment {
  content: string;
  score: number | null;
  errorType: string | null;
}

export interface XfyunSyllableAssessment {
  content: string;
  score: number | null;
  errorType: string | null;
  phones: XfyunPhoneAssessment[];
}

export interface XfyunWordAssessment {
  word: string;
  score: number | null;
  accuracyScore: number | null;
  errorType: string | null;
  beginMs: number | null;
  endMs: number | null;
  syllables: XfyunSyllableAssessment[];
}

export interface XfyunPronunciationAssessment {
  provider: 'xfyun';
  engine: 'ise';
  transcriptText: string;
  overallScore: number | null;
  accuracyScore: number | null;
  fluencyScore: number | null;
  integrityScore: number | null;
  standardScore: number | null;
  wordsPerMinute: number | null;
  words: XfyunWordAssessment[];
  raw?: unknown;
  usedOverallFallback?: boolean;
}

export interface SpeakingExpressionEvaluation {
  status: 'pending' | 'ready' | 'failed';
  grammarStatus: 'correct' | 'needs_improvement';
  grammarTitle: string | null;
  grammarFeedbackZh: string | null;
  betterExpression: string | null;
  betterExpressionZh: string | null;
  nativeScore: number | null;
  nativeFeedbackZh: string | null;
}

export type ExpressionStyleVariant = 'americanCasual' | 'businessFormal' | 'britishNatural';

export interface ExpressionStyleResult {
  expression: string;
  explanationZh: string;
  score: number | null;
}

export interface SpeakingExpressionStylesState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  americanCasual?: ExpressionStyleResult | null;
  businessFormal?: ExpressionStyleResult | null;
  britishNatural?: ExpressionStyleResult | null;
  errorMessage?: string | null;
}

export interface SpeakingRoundAnalysis {
  roundId: number;
  source: 'mock' | 'api' | 'pcm_dual_stream';
  transcriptText: string;
  grammarStatus: 'correct' | 'needsOptimization' | 'needs_improvement';
  grammarLabel: string;
  grammarTitle?: string | null;
  grammarExplanationZh?: string | null;
  pronunciationScore: number | null;
  naturalnessScore: number | null;
  optimizedSentence: string | null;
  polishedExplanationZh?: string | null;
  explanationZh: string | null;
  suggestions?: string[];
  assessment: XfyunPronunciationAssessment | null;
  expression?: SpeakingExpressionEvaluation | null;
  expressionStyles?: SpeakingExpressionStylesState | null;
}
