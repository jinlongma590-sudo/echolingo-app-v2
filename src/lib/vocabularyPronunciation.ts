export type VocabularyPronunciationAccent = 'us' | 'uk';

export type VocabularyPronunciationLocator = {
  word: string;
  accent?: VocabularyPronunciationAccent;
  extension?: 'mp3';
  baseUrl?: string;
  version?: `v${number}`;
  staticUrl?: string | null;
  audioUrl?: string | null;
};

const DEFAULT_AUDIO_BASE_URL = 'https://static.echolingo.cn';
const DEFAULT_AUDIO_VERSION = 'v1';

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function normalizeVocabularyPronunciationWord(word: string) {
  return String(word || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ');
}

function encodeWordToken(word: string) {
  return Array.from(word)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

function buildReadableSlug(word: string) {
  const slug = word
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || 'word';
}

function buildShard(slug: string) {
  const shard = slug.replace(/[^a-z0-9]/g, '').slice(0, 2);
  return shard.padEnd(2, 'x');
}

export function buildVocabularyPronunciationStorageKey(locator: VocabularyPronunciationLocator) {
  const accent = locator.accent ?? 'us';
  const extension = locator.extension ?? 'mp3';
  const version = locator.version ?? DEFAULT_AUDIO_VERSION;
  const normalizedWord = normalizeVocabularyPronunciationWord(locator.word);
  const readableSlug = buildReadableSlug(normalizedWord);
  const token = encodeWordToken(normalizedWord);
  const shard = buildShard(readableSlug);

  return `vocabulary-audio/${version}/${accent}/${shard}/${readableSlug}--${token}.${extension}`;
}

export function buildVocabularyPronunciationPublicUrl(locator: VocabularyPronunciationLocator) {
  if (locator.staticUrl) return locator.staticUrl;
  if (locator.audioUrl) return locator.audioUrl;

  const baseUrl = locator.baseUrl || DEFAULT_AUDIO_BASE_URL;
  return `${stripTrailingSlash(baseUrl)}/${buildVocabularyPronunciationStorageKey(locator)}`;
}

export function buildVocabularyPronunciationSources(locator: VocabularyPronunciationLocator) {
  const sources: Array<{ type: 'staticUrl' | 'audioUrl' | 'generatedStatic'; url: string }> = [];
  if (locator.staticUrl) {
    sources.push({ type: 'staticUrl', url: locator.staticUrl });
  }
  if (locator.audioUrl && locator.audioUrl !== locator.staticUrl) {
    sources.push({ type: 'audioUrl', url: locator.audioUrl });
  }

  const generatedStaticUrl = `${stripTrailingSlash(locator.baseUrl || DEFAULT_AUDIO_BASE_URL)}/${buildVocabularyPronunciationStorageKey(locator)}`;
  if (!sources.some((source) => source.url === generatedStaticUrl)) {
    sources.push({ type: 'generatedStatic', url: generatedStaticUrl });
  }
  return sources;
}
