export type EpisodeStub = {
  id: string;
  title: string;
  cover: string;
  duration: string;
  difficulty: string;
  tags?: string[];
  issue_number?: number | null;
  display_issue_number?: number | null;
};

export type Episode = {
  id: string;
  title: string;
  cover: string;
  duration: string;
  difficulty: string;
  tags: string[];
  description?: string;
  accent?: string;
  voice?: string | null;
  issue_number?: number | null;
  display_issue_number?: number | null;
  video_source?: 'supabase' | 'r2' | string | null;
  video_url_r2?: string | null;
};

export type Sentence = {
  id: number;
  start: number;
  end: number;
  en: string;
  zh: string;
  highlight: string[];
  phonetic?: string | null;
};

export type PhraseCard = {
  id: string | number;
  key: string;
  phrase: string;
  tag: string;
  zh: string;
  sentenceId: number;
  type?: string;
  phonetic?: string;
  definition?: string;
  example?: string;
  exampleZh?: string;
  contextEn?: string;
  contextZh?: string;
  start?: number;
  end?: number;
  exam_tags?: string[];
};

export type EpisodeDetailSnapshot = {
  episode: Episode;
  sentences: Sentence[];
  phraseCards: PhraseCard[];
  videoSrc: string;
};
