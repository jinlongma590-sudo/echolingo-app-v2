export type PlaybackResult = 'played' | 'failed' | 'cancelled';

const ABBREV_RE =
  /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|No|St|Ave|Blvd|Inc|Ltd|Corp|Co|Dept|Govt|approx|ca|e\.g|i\.e|p\.m|a\.m)\s*$/i;
const DECIMAL_RE = /\d\s*$/;
const INITIAL_RE = /\b[A-Z]\s*$/;
const COMMA_LOOKAHEAD_MIN = 40;
const HARD_FLUSH_CHARS = 100;

export class SentenceSplitter {
  private buf = '';

  push(delta: string): string[] {
    this.buf += delta;
    return this.extract(false);
  }

  flush(): string[] {
    const result = this.extract(true);
    this.buf = '';
    return result;
  }

  reset() {
    this.buf = '';
  }

  private extract(isFinal: boolean): string[] {
    const out: string[] = [];
    const re = /([.!?]+)\s+/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(this.buf)) !== null) {
      const beforePunct = this.buf.slice(lastIdx, match.index);
      const sentence = `${beforePunct}${match[1]}`.trim();

      if (this.isAbbrev(beforePunct, match[1])) continue;

      const minLen = match[1].startsWith('.') ? 4 : 2;
      if (sentence.length < minLen) {
        lastIdx = match.index + match[0].length;
        continue;
      }

      out.push(sentence);
      lastIdx = match.index + match[0].length;
    }

    if (isFinal) {
      const tail = this.buf.slice(lastIdx).trim();
      if (tail.length >= 2) out.push(tail);
      this.buf = '';
    } else {
      this.buf = this.buf.slice(lastIdx);
      if (this.buf.length >= COMMA_LOOKAHEAD_MIN) {
        out.push(...this.extractOnComma());
      }
    }

    return out;
  }

  private extractOnComma(): string[] {
    const out: string[] = [];
    const commaRe = /,\s+/g;
    let best: { idx: number; end: number } | null = null;
    let match: RegExpExecArray | null;

    while ((match = commaRe.exec(this.buf)) !== null) {
      const beforeComma = this.buf.slice(0, match.index);
      if (beforeComma.length >= 30) {
        best = { idx: match.index, end: match.index + match[0].length };
      }
      if (this.buf.length >= HARD_FLUSH_CHARS && best) break;
    }

    if (best) {
      const segment = this.buf.slice(0, best.idx).trim();
      if (segment.length >= 10) {
        out.push(segment);
        this.buf = this.buf.slice(best.end);
      }
    }

    return out;
  }

  private isAbbrev(before: string, punct: string): boolean {
    if (!punct.startsWith('.')) return false;
    return ABBREV_RE.test(before) || DECIMAL_RE.test(before) || INITIAL_RE.test(before);
  }
}

export interface SentencePipelineCallbacks {
  synthesize: (text: string) => Promise<string>;
  playAudio: (uri: string, text: string) => Promise<PlaybackResult>;
  onPlayStart?: (text: string) => void;
  onPlayEnd?: (result: PlaybackResult, text: string) => void;
  onPlaybackFailed?: (text: string) => void;
  onAllDone?: (result: PlaybackResult | 'completed') => void;
}

interface SentenceEntry {
  id: string;
  text: string;
  uriPromise: Promise<string | null>;
}

export interface SentencePipeline {
  addSentence: (text: string) => void;
  finish: () => void;
  cancel: () => void;
}

export function createSentencePipeline(callbacks: SentencePipelineCallbacks): SentencePipeline {
  const queue: SentenceEntry[] = [];
  let cancelled = false;
  let draining = false;
  let streamFinished = false;
  let entrySeq = 0;

  async function drain() {
    if (draining || cancelled) return;
    draining = true;
    let terminalResult: PlaybackResult | 'completed' = 'completed';

    while (queue.length > 0 && !cancelled) {
      const entry = queue.shift()!;
      let uri: string | null = null;
      try {
        uri = await entry.uriPromise;
      } catch {
        uri = null;
      }

      if (cancelled) break;
      if (!uri) {
        terminalResult = 'failed';
        callbacks.onPlaybackFailed?.(entry.text);
        break;
      }

      callbacks.onPlayStart?.(entry.text);
      const result = await callbacks.playAudio(uri, entry.text);
      callbacks.onPlayEnd?.(result, entry.text);

      if (result !== 'played') {
        terminalResult = result;
        callbacks.onPlaybackFailed?.(entry.text);
        break;
      }
    }

    draining = false;

    if (terminalResult !== 'completed') {
      queue.length = 0;
      callbacks.onAllDone?.(terminalResult);
      return;
    }

    if (streamFinished && !cancelled && queue.length === 0) {
      callbacks.onAllDone?.('completed');
    }
  }

  return {
    addSentence(text: string) {
      if (cancelled || !text.trim()) return;
      entrySeq += 1;
      queue.push({
        id: `sentence-${entrySeq}`,
        text,
        uriPromise: callbacks.synthesize(text.trim()).catch(() => null),
      });
      void drain();
    },
    finish() {
      streamFinished = true;
      if (!draining && queue.length === 0 && !cancelled) {
        callbacks.onAllDone?.('completed');
      }
    },
    cancel() {
      cancelled = true;
      queue.length = 0;
      if (!draining) {
        callbacks.onAllDone?.('cancelled');
      }
    },
  };
}
