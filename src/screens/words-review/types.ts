export type ReviewCounts = {
  known: number;
  unsure: number;
  unknown: number;
};

export type ReviewEntrySource = 'plan' | 'extra' | 'direct';

export type QueueStatus =
  | 'loading'
  | 'slow_loading'
  | 'ready'
  | 'completed'
  | 'load_error'
  | 'auth_required';

export type DisplayAnalysis = {
  contextualMeaning: string;
  confusableWords: Array<{ word: string; difference: string }>;
  collocations: Array<{ phrase: string; meaning: string }>;
  memoryTip: string;
  speakingPhrase: string | null;
  errorReasonSummary: string;
  predictedRetention: string;
  bestReviewWindow: string;
  tier: 'quick' | 'deep';
};
