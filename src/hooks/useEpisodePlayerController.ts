import { useEvent } from 'expo';
import { useVideoPlayer, type VideoPlayerStatus } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Sentence } from '@/types/echolingo';

type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

function parseDurationLabel(label: string) {
  const [m, s] = label.split(':').map(Number);
  if (Number.isNaN(m) || Number.isNaN(s)) return 0;
  return m * 60 + s;
}

function formatTimeSec(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function findSentenceAtTime(sentences: Sentence[], time: number) {
  return sentences.find((sentence) => time >= sentence.start && time < sentence.end) ?? null;
}

export function useEpisodePlayerController({
  videoSrc,
  title,
  artwork,
  durationLabel,
  sentences,
}: {
  videoSrc: string;
  title: string;
  artwork?: string;
  durationLabel: string;
  sentences: Sentence[];
}) {
  const fallbackDuration = Math.max(sentences[sentences.length - 1]?.end ?? 0, parseDurationLabel(durationLabel));
  const [optimisticTime, setOptimisticTime] = useState<number | null>(null);
  const [aPointTime, setAPointTime] = useState<number | null>(null);
  const [bPointTime, setBPointTime] = useState<number | null>(null);
  const [abLoopActive, setAbLoopActive] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [observedPlaying, setObservedPlaying] = useState(false);
  const optimisticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abLoopJumpRef = useRef(0);
  const lastResolvedSentenceIdRef = useRef<number | null>(null);

  const player = useVideoPlayer(
    videoSrc
      ? {
          uri: videoSrc,
          metadata: { title, artwork },
          // useCaching disabled — it caused the audio buffer to activate
          // BEFORE the screen finished its mount/animation, producing the
          // "audio plays before page appears" glitch the user hit.
          useCaching: false,
        }
      : null,
    (instance) => {
      instance.timeUpdateEventInterval = 0.25;
      instance.playbackRate = 1;
      // Belt-and-braces: never autoplay on mount or source-change. Even if
      // expo-video changes its defaults, we explicitly pause so audio only
      // starts when the user taps play.
      instance.pause();
    },
  );

  // expo-video's useVideoPlayer already releases the native player on hook
  // unmount, which pauses + tears down the audio session. We previously
  // called player.pause() in a cleanup effect for belt-and-braces, but it
  // raced with expo-video's own teardown and produced FunctionCallException
  // log spam (NativeSharedObjectNotFoundException). Removing it — the
  // built-in teardown is sufficient.

  const statusEvent = useEvent(player, 'statusChange', {
    status: player.status,
    oldStatus: undefined,
    error: undefined,
  });
  const playingEvent = useEvent(player, 'playingChange', {
    isPlaying: false,
    oldIsPlaying: undefined,
  });
  const timeEvent = useEvent(player, 'timeUpdate', {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const sourceLoadEvent = useEvent(player, 'sourceLoad', {
    videoSource: null,
    duration: fallbackDuration,
    availableVideoTracks: [],
    availableSubtitleTracks: [],
    availableAudioTracks: [],
  });

  useEffect(() => {
    setObservedPlaying(player.playing);
  }, [player]);

  useEffect(() => {
    const syncPlayingState = () => {
      const next = player.playing;
      setObservedPlaying((prev) => (prev === next ? prev : next));
    };

    syncPlayingState();
    const interval = setInterval(syncPlayingState, 200);
    return () => clearInterval(interval);
  }, [player, playingEvent.isPlaying, statusEvent.status, timeEvent.currentTime]);

  const isPlaying = observedPlaying;

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    setAPointTime(null);
    setBPointTime(null);
    setAbLoopActive(false);
    setToastMessage(null);
    abLoopJumpRef.current = 0;
  }, [videoSrc]);

  const isPlaybackPositionReady = useMemo(() => {
    if (optimisticTime !== null) return true;
    if ((timeEvent.currentTime || 0) > 0.01) return true;
    return (
      statusEvent.status === 'readyToPlay' ||
      statusEvent.status === 'loading' ||
      isPlaying ||
      sourceLoadEvent.duration > 0
    );
  }, [optimisticTime, timeEvent.currentTime, statusEvent.status, isPlaying, sourceLoadEvent.duration]);

  const currentTime = useMemo(() => {
    if (optimisticTime !== null) {
      const eventTime = timeEvent.currentTime || 0;
      if (Math.abs(eventTime - optimisticTime) < 0.35) {
        return eventTime;
      }
      return optimisticTime;
    }
    if (!isPlaybackPositionReady) return 0;
    return timeEvent.currentTime || 0;
  }, [isPlaybackPositionReady, optimisticTime, timeEvent.currentTime]);

  const duration = sourceLoadEvent.duration > 0 ? sourceLoadEvent.duration : fallbackDuration;

  const playbackState = useMemo<PlaybackState>(() => {
    const status = statusEvent.status as VideoPlayerStatus;
    if (!videoSrc) return 'idle';
    if (status === 'error') return 'error';
    if (status === 'loading') return 'loading';
    if (isPlaying) return 'playing';
    if (status === 'readyToPlay' && currentTime > 0) return 'paused';
    if (status === 'readyToPlay') return 'ready';
    return 'idle';
  }, [currentTime, isPlaying, statusEvent.status, videoSrc]);

  const currentSentenceId = useMemo(() => {
    if (!isPlaybackPositionReady) {
      lastResolvedSentenceIdRef.current = null;
      return null;
    }

    const hysteresis = 0.08;
    const previousSentence =
      lastResolvedSentenceIdRef.current != null
        ? sentences.find((sentence) => sentence.id === lastResolvedSentenceIdRef.current) ?? null
        : null;

    if (
      previousSentence &&
      currentTime >= previousSentence.start - hysteresis &&
      currentTime < previousSentence.end + hysteresis
    ) {
      return previousSentence.id;
    }

    const nextSentence = findSentenceAtTime(sentences, currentTime) ?? null;
    if (nextSentence) {
      lastResolvedSentenceIdRef.current = nextSentence.id;
      return nextSentence.id;
    }

    const upcomingSentenceIndex = sentences.findIndex((sentence) => currentTime < sentence.start);
    if (upcomingSentenceIndex > 0) {
      const previousSentence = sentences[upcomingSentenceIndex - 1];
      lastResolvedSentenceIdRef.current = previousSentence.id;
      return previousSentence.id;
    }

    const lastSentence = sentences[sentences.length - 1] ?? null;
    if (lastSentence && currentTime >= lastSentence.start) {
      lastResolvedSentenceIdRef.current = lastSentence.id;
      return lastSentence.id;
    }

    lastResolvedSentenceIdRef.current = null;
    return null;
  }, [currentTime, isPlaybackPositionReady, sentences]);

  const handleSeek = useCallback(
    (time: number) => {
      const nextTime = Math.max(0, Math.min(duration, time));
      player.currentTime = nextTime;
      setOptimisticTime(nextTime);
      if (optimisticTimeoutRef.current) {
        clearTimeout(optimisticTimeoutRef.current);
      }
      optimisticTimeoutRef.current = setTimeout(() => {
        setOptimisticTime(null);
        optimisticTimeoutRef.current = null;
      }, 700);
    },
    [duration, player],
  );

  const jumpToSentence = useCallback(
    (sentenceId: number) => {
      const target = sentences.find((sentence) => sentence.id === sentenceId);
      if (!target) return;
      handleSeek(target.start);
      if (player.playing) {
        player.play();
      }
    },
    [handleSeek, player, sentences],
  );

  const jumpToPrev = useCallback(() => {
    const index = sentences.findIndex((sentence) => sentence.id === currentSentenceId);
    if (index > 0) {
      jumpToSentence(sentences[index - 1].id);
    }
  }, [currentSentenceId, jumpToSentence, sentences]);

  const jumpToNext = useCallback(() => {
    const index = sentences.findIndex((sentence) => sentence.id === currentSentenceId);
    if (index >= 0 && index < sentences.length - 1) {
      jumpToSentence(sentences[index + 1].id);
    }
  }, [currentSentenceId, jumpToSentence, sentences]);

  const play = useCallback(() => {
    try {
      player.play();
    } catch {
      return;
    }
  }, [player]);

  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {
      return;
    }
  }, [player]);

  const togglePlayPause = useCallback(() => {
    if (player.playing) {
      pause();
      return;
    }
    play();
  }, [pause, play, player]);

  const cyclePlaybackRate = useCallback(() => {
    const next = player.playbackRate >= 1.5 ? 0.75 : player.playbackRate + 0.25;
    player.playbackRate = Number(next.toFixed(2));
  }, [player]);

  const handleABPoint = useCallback(() => {
    const time = currentTime;

    if (aPointTime === null) {
      setAPointTime(time);
      setToastMessage(`A点已设置：${formatTimeSec(time)}，请设置B点`);
      return;
    }

    if (bPointTime === null) {
      if (time <= aPointTime) {
        setToastMessage('B点必须大于A点');
        return;
      }
      setBPointTime(time);
      setAbLoopActive(true);
      setToastMessage(`AB循环已激活：${formatTimeSec(aPointTime)} - ${formatTimeSec(time)}`);
      return;
    }

    setAPointTime(null);
    setBPointTime(null);
    setAbLoopActive(false);
    setToastMessage('AB循环已取消');
  }, [aPointTime, bPointTime, currentTime]);

  useEffect(() => {
    if (!abLoopActive || aPointTime === null || bPointTime === null) return;
    const time = timeEvent.currentTime || 0;
    if (time < bPointTime - 0.1) return;
    const now = Date.now();
    if (now - abLoopJumpRef.current <= 200) return;
    abLoopJumpRef.current = now;
    handleSeek(aPointTime);
    if (player.playing) {
      player.play();
    }
  }, [aPointTime, abLoopActive, bPointTime, handleSeek, player, timeEvent.currentTime]);

  return {
    player,
    playbackState,
    currentTime,
    duration,
    currentSentenceId,
    isPlaybackPositionReady,
    isPlaying,
    playbackRateLabel: `${player.playbackRate || 1}x`,
    handleSeek,
    jumpToSentence,
    jumpToPrev,
    jumpToNext,
    play,
    pause,
    togglePlayPause,
    cyclePlaybackRate,
    aPointTime,
    bPointTime,
    abLoopActive,
    toastMessage,
    handleABPoint,
  };
}
