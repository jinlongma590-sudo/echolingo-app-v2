export type RoastAsrSanityReason =
  | 'meaningless_short_utterance'
  | 'known_chinglish_asr_hallucination'
  | 'suspicious_bite_phrase'
  | 'suspicious_how_phrase'
  | 'repeated_noise'
  | 'symbol_noise';

export type RoastAsrSanityResult = {
  shouldReject: boolean;
  reason?: RoastAsrSanityReason;
  matchedPhrase?: string;
  normalizedText: string;
  preview: string;
};

const PREVIEW_MAX_LENGTH = 80;

const MEANINGLESS_SHORT_UTTERANCES = new Set([
  'ah',
  'er',
  'hm',
  'hmm',
  'mhm',
  'mm',
  'mmm',
  'ok',
  'okay',
  'uh',
  'uhh',
  'um',
]);

const KNOWN_CHINGLISH_ASR_HALLUCINATIONS = [
  'how when you like play',
  'how many like play',
  'i really like play for another bite',
  'i really like play for a bite',
  'play for another bite',
  'play for in the bite',
  'play for a bite',
  'for in the bite',
];

const FOOD_CONTEXT_WORDS = new Set([
  'apple',
  'banana',
  'bread',
  'breakfast',
  'burger',
  'cake',
  'chew',
  'chicken',
  'cookie',
  'delicious',
  'dinner',
  'eat',
  'eating',
  'food',
  'fruit',
  'hungry',
  'lunch',
  'meal',
  'meat',
  'noodle',
  'noodles',
  'pizza',
  'restaurant',
  'rice',
  'sandwich',
  'snack',
  'soup',
  'taste',
  'tasty',
]);

export function previewRoastAsrTranscript(text: string, maxLength = PREVIEW_MAX_LENGTH): string {
  const normalized = normalizeVisibleText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function analyzeRoastAsrTranscript(text: string): RoastAsrSanityResult {
  const normalizedText = normalizeVisibleText(text);
  const normalizedLower = normalizeForMatching(normalizedText);
  const preview = previewRoastAsrTranscript(normalizedText);
  const base = { normalizedText, preview };

  if (!normalizedText) {
    return { ...base, shouldReject: false };
  }

  const alnumChars = (normalizedText.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const visibleChars = (normalizedText.match(/\S/gu) ?? []).length;
  if (visibleChars > 0 && alnumChars / visibleChars < 0.45) {
    return { ...base, shouldReject: true, reason: 'symbol_noise' };
  }

  const tokens = normalizedLower.split(' ').filter(Boolean);
  if (tokens.length === 1 && MEANINGLESS_SHORT_UTTERANCES.has(tokens[0])) {
    return { ...base, shouldReject: true, reason: 'meaningless_short_utterance', matchedPhrase: tokens[0] };
  }

  const hallucination = KNOWN_CHINGLISH_ASR_HALLUCINATIONS.find((phrase) => normalizedLower.includes(phrase));
  if (hallucination) {
    return {
      ...base,
      shouldReject: true,
      reason: 'known_chinglish_asr_hallucination',
      matchedPhrase: hallucination,
    };
  }

  if (hasSuspiciousHowPhrase(normalizedLower)) {
    return {
      ...base,
      shouldReject: true,
      reason: 'suspicious_how_phrase',
      matchedPhrase: normalizedLower.startsWith('how when') ? 'how when' : 'how many like',
    };
  }

  if (hasSuspiciousBitePhrase(normalizedLower, tokens)) {
    return {
      ...base,
      shouldReject: true,
      reason: 'suspicious_bite_phrase',
      matchedPhrase: 'another bite',
    };
  }

  if (hasRepeatedNoise(tokens)) {
    return { ...base, shouldReject: true, reason: 'repeated_noise' };
  }

  return { ...base, shouldReject: false };
}

function normalizeVisibleText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSuspiciousBitePhrase(normalizedLower: string, tokens: string[]): boolean {
  if (
    !normalizedLower.includes('another bite')
    && !normalizedLower.includes('for a bite')
    && !normalizedLower.includes('in the bite')
  ) {
    return false;
  }
  if (/\b(take|taking|took|have|had|get|try|trying)\s+(a\s+|one\s+|another\s+)?bite\b/.test(normalizedLower)) {
    return false;
  }
  const hasFoodContext = tokens.some((token) => FOOD_CONTEXT_WORDS.has(token));
  if (hasFoodContext) {
    return false;
  }
  return (
    normalizedLower === 'another bite'
    || normalizedLower === 'for another bite'
    || normalizedLower === 'for a bite'
    || normalizedLower === 'in the bite'
    || normalizedLower === 'for in the bite'
    || /\b(play|playing|played)\s+for\s+(another\s+)?a?\s*bite\b/.test(normalizedLower)
    || /\b(play|playing|played)\s+for\s+in\s+the\s+bite\b/.test(normalizedLower)
    || normalizedLower.includes(' for another bite')
    || normalizedLower.includes(' for in the bite')
    || (normalizedLower.includes('bite') && /\b(phone|bed)\b/.test(normalizedLower) && /\b(play|like)\b/.test(normalizedLower))
  );
}

function hasSuspiciousHowPhrase(normalizedLower: string): boolean {
  return (
    /^how when\b/.test(normalizedLower)
    || /^how many like\s+(play|playing|played)\b/.test(normalizedLower)
  );
}

function hasRepeatedNoise(tokens: string[]): boolean {
  if (tokens.length < 5) return false;
  let previous = '';
  let streak = 0;
  for (const token of tokens) {
    if (token === previous) {
      streak += 1;
    } else {
      previous = token;
      streak = 1;
    }
    if (streak >= 5 && MEANINGLESS_SHORT_UTTERANCES.has(token)) {
      return true;
    }
  }
  const uniqueTokens = new Set(tokens);
  return tokens.length >= 8 && uniqueTokens.size <= 2 && tokens.every((token) => MEANINGLESS_SHORT_UTTERANCES.has(token));
}
