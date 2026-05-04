import { useEvent, useEventListener } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoPlayer } from 'expo-video';

import { buildVocabularyPronunciationSources } from '@/lib/vocabularyPronunciation';

export type WordPronunciationInput = {
  wordId?: string;
  word: string;
  staticUrl?: string | null;
  audioUrl?: string | null;
  accent?: 'us' | 'uk';
  playbackKey?: string;
  index?: number;
  hasPhonetic?: boolean;
  hasPronunciationAudio?: boolean;
  fallbackTts?: (word: string, context?: { requestSource: 'auto' | 'manual' }) => Promise<void>;
  requestSource?: 'auto' | 'manual';
};

type PronunciationPhase = 'idle' | 'loading' | 'playing' | 'ready' | 'error';
type PronunciationRemoteSource = ReturnType<typeof buildVocabularyPronunciationSources>[number];
type PlaybackMeta = {
  wordId?: string;
  word: string;
  index?: number;
  playbackKey?: string;
  hasPronunciationAudio: boolean;
  hasPhonetic: boolean;
  requestSource: 'auto' | 'manual';
};

const REMOTE_FAILURE_TTL_MS = 10 * 60 * 1000;

function createIdleLabel() {
  return '';
}

function logWordsReviewAudio(event: string, payload: Record<string, unknown>) {
  console.log(`[words-review][audio] ${event}`, payload);
}

export function useWordPronunciation() {
  const [phase, setPhase] = useState<PronunciationPhase>('idle');
  const [stateLabel, setStateLabel] = useState(createIdleLabel());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const currentWordRef = useRef<string | null>(null);
  const currentSourceRef = useRef<PronunciationRemoteSource | null>(null);
  const currentRequestSourceRef = useRef<'auto' | 'manual'>('manual');
  const currentPlaybackMetaRef = useRef<PlaybackMeta | null>(null);
  const fallbackTtsRef = useRef<WordPronunciationInput['fallbackTts']>(undefined);
  const fallbackAttemptedRef = useRef(false);
  const requestIdRef = useRef(0);
  const remoteFailureCacheRef = useRef(new Map<string, number>());

  const player = useVideoPlayer(null, (instance) => {
    instance.volume = 1;
    instance.muted = false;
    instance.loop = false;
    instance.audioMixingMode = 'doNotMix';
    instance.staysActiveInBackground = false;
    instance.showNowPlayingNotification = false;
  });

  const statusEvent = useEvent(player, 'statusChange', {
    status: player.status,
    oldStatus: undefined,
    error: undefined,
  });
  const playingEvent = useEvent(player, 'playingChange', {
    isPlaying: false,
    oldIsPlaying: undefined,
  });

  const buildAudioLogPayload = useCallback(
    (extra: Record<string, unknown> = {}) => {
      const meta = currentPlaybackMetaRef.current;
      return {
        word: meta?.word ?? currentWordRef.current,
        wordId: meta?.wordId ?? null,
        index: meta?.index ?? null,
        playbackKey: meta?.playbackKey ?? null,
        hasPronunciationAudio: meta?.hasPronunciationAudio ?? false,
        hasPhonetic: meta?.hasPhonetic ?? false,
        source: currentSourceRef.current?.type ?? null,
        requestSource: currentRequestSourceRef.current,
        ...extra,
      };
    },
    [],
  );

  useEventListener(player, 'playToEnd', () => {
    if (!currentWordRef.current) return;
    setPhase('ready');
    setErrorMessage(null);
    setStateLabel('');
    try {
      // 必须先 pause 再 seek：Android ExoPlayer 在「已结束」状态执行 seek(0)
      // 后会自动恢复播放，导致发音反复播放；iOS 无此问题。
      player.pause();
      player.currentTime = 0;
    } catch {
      // Ignore reset failures after playback end.
    }
  });

  const stopPlayer = useCallback(() => {
    try {
      player.pause();
      player.currentTime = 0;
    } catch {
      // Ignore cleanup failures for unloaded audio.
    }
  }, [player]);

  const fallbackToTts = useCallback(
    async (message: string, requestId = requestIdRef.current) => {
      const word = currentWordRef.current;
      const fallbackTts = fallbackTtsRef.current;
      const requestSource = currentRequestSourceRef.current;
      if (!word || !fallbackTts || fallbackAttemptedRef.current) {
        logWordsReviewAudio(
          'skipped_reason',
          buildAudioLogPayload({
            reason: !word ? 'missing_word' : !fallbackTts ? 'missing_tts_fallback' : 'tts_already_attempted',
            message,
            source: 'tts_fallback',
          }),
        );
        if (requestId === requestIdRef.current) {
          setPhase('ready');
          setErrorMessage(null);
          setStateLabel('发音暂时不可用');
        }
        return false;
      }

      fallbackAttemptedRef.current = true;
      logWordsReviewAudio(
        'tts_fallback_play',
        buildAudioLogPayload({
          reason: message,
          source: 'tts_fallback',
        }),
      );
      if (message !== 'auto_fast_tts_path') {
        console.log('vocabulary_audio_remote_failed', { word, message, requestSource });
      }
      console.log('vocabulary_pronunciation_tts_fallback_start', { word, requestSource });
      if (requestSource === 'auto') {
        console.log('vocabulary_auto_pronounce_fallback_tts', { word });
      }
      setPhase('loading');
      setErrorMessage(null);
      setStateLabel('');

      try {
        await fallbackTts(word, { requestSource });
        console.log('vocabulary_audio_fallback_tts', { word, requestSource });
        console.log('vocabulary_pronunciation_tts_fallback_done', { word, requestSource });
        if (requestId === requestIdRef.current) {
          setPhase('ready');
          setErrorMessage(null);
          setStateLabel('');
        }
        return true;
      } catch (error) {
        const nextError = error instanceof Error ? error.message : String(error);
        if (requestId !== requestIdRef.current || /cancel/i.test(nextError)) {
          logWordsReviewAudio(
            'stale_request_ignored',
            buildAudioLogPayload({
              reason: 'tts_cancelled_by_new_word',
              message: nextError,
              source: 'tts_fallback',
            }),
          );
          console.log('vocabulary_auto_pronounce_stop_previous', {
            word,
            requestSource,
            reason: 'tts_cancelled_by_new_word',
          });
          return false;
        }
        logWordsReviewAudio(
          'play_failed',
          buildAudioLogPayload({
            message: nextError,
            source: 'tts_fallback',
          }),
        );
        console.log('vocabulary_audio_fallback_tts_failed', {
          word,
          requestSource,
          message: nextError,
        });
        console.log('vocabulary_pronunciation_all_failed', {
          word,
          requestSource,
          message: nextError,
        });
        if (requestId === requestIdRef.current) {
          setPhase('ready');
          setErrorMessage(null);
          setStateLabel('发音暂时不可用');
        }
        return false;
      }
    },
    [buildAudioLogPayload],
  );

  useEffect(() => {
    if (playingEvent.isPlaying) {
      setPhase('playing');
      setErrorMessage(null);
      setStateLabel('');
      return;
    }

    if (statusEvent.status === 'loading' && currentWordRef.current) {
      setPhase('loading');
      setErrorMessage(null);
      setStateLabel('');
      return;
    }

    if (statusEvent.status === 'error') {
      const nextError = statusEvent.error?.message || '标准发音播放失败';
      const failedSource = currentSourceRef.current;
      if (failedSource) {
        remoteFailureCacheRef.current.set(failedSource.url, Date.now());
        console.log('vocabulary_pronunciation_remote_failed', {
          word: currentWordRef.current,
          sourceType: failedSource.type,
          url: failedSource.url,
          message: nextError,
        });
      }
      logWordsReviewAudio(
        'play_failed',
        buildAudioLogPayload({
          source: failedSource?.type ?? 'remote',
          message: nextError,
        }),
      );
      void fallbackToTts(nextError);
      return;
    }

    if (statusEvent.status === 'readyToPlay' && currentWordRef.current && phase !== 'playing') {
      setPhase('ready');
      setErrorMessage(null);
      setStateLabel('');
    }
  }, [buildAudioLogPayload, fallbackToTts, phase, playingEvent.isPlaying, statusEvent.error?.message, statusEvent.status]);

  const stopCurrentPronunciation = useCallback(
    (reason = 'manual_stop') => {
      requestIdRef.current += 1;
      if (currentWordRef.current) {
        console.log('vocabulary_auto_pronounce_stop_previous', {
          word: currentWordRef.current,
          reason,
        });
      }
      currentWordRef.current = null;
      currentSourceRef.current = null;
      currentPlaybackMetaRef.current = null;
      fallbackTtsRef.current = undefined;
      fallbackAttemptedRef.current = false;
      setPhase('idle');
      setErrorMessage(null);
      setStateLabel('');
      stopPlayer();
    },
    [stopPlayer],
  );

  const reset = useCallback(() => {
    stopCurrentPronunciation('reset');
  }, [stopCurrentPronunciation]);

  const playWordPronunciation = useCallback(
    async (input: WordPronunciationInput) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const requestSource = input.requestSource ?? 'manual';
      if (currentWordRef.current) {
        console.log('vocabulary_auto_pronounce_stop_previous', {
          word: currentWordRef.current,
          reason: `${requestSource}_replace`,
        });
      }

      stopPlayer();

      const sources = buildVocabularyPronunciationSources({
        word: input.word,
        staticUrl: input.staticUrl,
        audioUrl: input.audioUrl,
        accent: input.accent ?? 'us',
      });

      currentWordRef.current = input.word;
      currentSourceRef.current = null;
      currentRequestSourceRef.current = requestSource;
      currentPlaybackMetaRef.current = {
        wordId: input.wordId,
        word: input.word,
        index: input.index,
        playbackKey: input.playbackKey,
        hasPronunciationAudio: Boolean(input.hasPronunciationAudio ?? input.staticUrl ?? input.audioUrl),
        hasPhonetic: Boolean(input.hasPhonetic),
        requestSource,
      };
      fallbackTtsRef.current = input.fallbackTts;
      fallbackAttemptedRef.current = false;
      setPhase('loading');
      setErrorMessage(null);
      setStateLabel('');

      for (const source of sources) {
        const failedAt = remoteFailureCacheRef.current.get(source.url);
        if (failedAt && Date.now() - failedAt < REMOTE_FAILURE_TTL_MS) {
          logWordsReviewAudio(
            'skipped_reason',
            buildAudioLogPayload({
              source: source.type,
              reason: 'recent_remote_failure',
            }),
          );
          console.log('vocabulary_pronunciation_source_selected', {
            word: input.word,
            sourceType: source.type,
            skipped: true,
            reason: 'recent_remote_failure',
          });
          continue;
        }

        currentSourceRef.current = source;
        logWordsReviewAudio(
          'source_selected',
          buildAudioLogPayload({
            source: source.type,
            displayUrl: source.url,
          }),
        );
        console.log('vocabulary_pronunciation_source_selected', {
          word: input.word,
          sourceType: source.type,
          url: source.url,
          requestSource,
        });

        try {
          await player.replaceAsync({
            uri: source.url,
            useCaching: true,
            metadata: { title: input.word },
          });
          if (requestId !== requestIdRef.current) {
            logWordsReviewAudio(
              'stale_request_ignored',
              buildAudioLogPayload({
                source: source.type,
                reason: 'replace_completed_after_newer_request',
              }),
            );
            return false;
          }
          // Android 的 replaceAsync 可能重置 loop 设置，显式确保 loop=false 防止循环播放
          player.loop = false;
          player.play();
          logWordsReviewAudio(
            'native_audio_play',
            buildAudioLogPayload({
              source: source.type,
            }),
          );
          return true;
        } catch (error) {
          const nextError = error instanceof Error ? error.message : '标准发音播放失败';
          remoteFailureCacheRef.current.set(source.url, Date.now());
          logWordsReviewAudio(
            'play_failed',
            buildAudioLogPayload({
              source: source.type,
              message: nextError,
            }),
          );
          console.log('vocabulary_pronunciation_remote_failed', {
            word: input.word,
            sourceType: source.type,
            url: source.url,
            requestSource,
            message: nextError,
          });
        }
      }

      return await fallbackToTts('所有远程发音源均不可用', requestId);
    },
    [buildAudioLogPayload, fallbackToTts, player, stopPlayer],
  );

  const pronounce = playWordPronunciation;

  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // Ignore teardown failures.
      }
    };
  }, [player]);

  return {
    player,
    pronounce,
    playWordPronunciation,
    stopCurrentPronunciation,
    reset,
    phase,
    stateLabel,
    errorMessage,
  };
}
