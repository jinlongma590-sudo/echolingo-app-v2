import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type RoastChunkStreamState = {
  requestId?: string;
  status?: string;
  bytesReceived?: number;
  packetsQueued?: number;
  buffersQueued?: number;
  buffersInFlight?: number;
  playbackStarted?: boolean;
  error?: string | null;
  firstNetworkChunkMs?: number | null;
  firstPacketParsedMs?: number | null;
  audioQueueStartedMs?: number | null;
  playbackEndedMs?: number | null;
  elapsedMs?: number | null;
  audioSessionSetupMs?: number;
  audioQueueStartAttemptMs?: number | null;
  audioQueuePrimeMs?: number;
  bytesQueuedBeforeStart?: number;
  firstBufferByteSize?: number;
  firstPacketCount?: number;
  audioQueueVolume?: number;
  audioQueuePrimeResult?: number;
  audioQueueStartResult?: number;
  audioQueueVolumeSetResult?: number;
  audioSession?: {
    audioSessionCategory?: string;
    audioSessionMode?: string;
    outputRoute?: string;
    outputPortType?: string;
    outputVolume?: number;
    outputs?: Array<{ portType?: string; portName?: string }>;
    inputs?: Array<{ portType?: string; portName?: string }>;
  };
  audioSessionError?: string | null;
};

export type RoastChunkStreamEventName =
  | 'roastChunkStream:requestStart'
  | 'roastChunkStream:firstNetworkChunk'
  | 'roastChunkStream:firstPacketParsed'
  | 'roastChunkStream:audioQueueStarted'
  | 'roastChunkStream:progress'
  | 'roastChunkStream:streamEnd'
  | 'roastChunkStream:playbackEnded'
  | 'roastChunkStream:stopped'
  | 'roastChunkStream:error';

export type RoastChunkStreamEvent = RoastChunkStreamState & {
  type: RoastChunkStreamEventName;
};

type RoastChunkStreamNativeModule = {
  playStream(url: string): Promise<RoastChunkStreamState>;
  playStreamWithOptions?: (url: string, options: RoastChunkStreamPlayOptions) => Promise<RoastChunkStreamState>;
  stop(): Promise<RoastChunkStreamState>;
  getState(): Promise<RoastChunkStreamState>;
  restoreIpadTtsSessionExperiment?: (context: RoastIpadTtsSessionExperimentContext) => Promise<Record<string, unknown>>;
  setManualAudioEnabled?: (enabled: boolean) => Promise<{
    useManualAudio?: boolean;
    isAudioEnabled?: boolean;
    prevUseManualAudio?: boolean;
    prevIsAudioEnabled?: boolean;
  }>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

export type RoastIpadTtsSessionExperimentContext = {
  requestId?: string | null;
  turnId?: string | null;
  isMicMuted?: boolean | null;
  localAudioTrackEnabled?: boolean | null;
};

export type RoastChunkStreamPlayOptions = RoastIpadTtsSessionExperimentContext & {
  forceAudioSessionModeDefault?: boolean;
  playbackSettleDelayMs?: number;
};

const nativeModule = NativeModules.RoastChunkStreamPlayer as RoastChunkStreamNativeModule | undefined;
const eventEmitter = Platform.OS === 'ios' && nativeModule ? new NativeEventEmitter(nativeModule) : null;
const chunkStreamEvents: RoastChunkStreamEventName[] = [
  'roastChunkStream:requestStart',
  'roastChunkStream:firstNetworkChunk',
  'roastChunkStream:firstPacketParsed',
  'roastChunkStream:audioQueueStarted',
  'roastChunkStream:progress',
  'roastChunkStream:streamEnd',
  'roastChunkStream:playbackEnded',
  'roastChunkStream:stopped',
  'roastChunkStream:error',
];

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function urlPathForLog(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return 'invalid_url';
  }
}

function sanitizeOptions(options?: RoastChunkStreamPlayOptions) {
  if (!options || typeof options !== 'object') return null;
  const sanitized: RoastChunkStreamPlayOptions = {};
  if (typeof options.forceAudioSessionModeDefault === 'boolean') {
    sanitized.forceAudioSessionModeDefault = options.forceAudioSessionModeDefault;
  }
  if (typeof options.playbackSettleDelayMs === 'number') {
    sanitized.playbackSettleDelayMs = options.playbackSettleDelayMs;
  }
  if (typeof options.requestId === 'string') sanitized.requestId = options.requestId;
  if (typeof options.turnId === 'string') sanitized.turnId = options.turnId;
  if (typeof options.isMicMuted === 'boolean') sanitized.isMicMuted = options.isMicMuted;
  if (typeof options.localAudioTrackEnabled === 'boolean') {
    sanitized.localAudioTrackEnabled = options.localAudioTrackEnabled;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function logChunkStreamPlayFailed(url: string, options: RoastChunkStreamPlayOptions | null, error: unknown) {
  console.warn('[ROAST_CHUNK_STREAM_PLAY_FAILED]', JSON.stringify({
    source: 'roastChunkStreamNativePlayer',
    nativeModuleAvailable: !!nativeModule?.playStream,
    nativeOptionsMethodAvailable: !!nativeModule?.playStreamWithOptions,
    urlPath: urlPathForLog(url),
    hasOptions: !!options,
    optionsKeys: options ? Object.keys(options) : [],
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown'),
  }));
}

export function isRoastChunkStreamPlayerAvailable() {
  return Platform.OS === 'ios' && !!nativeModule?.playStream;
}

export async function playChunkStream(url: string, options?: RoastChunkStreamPlayOptions): Promise<RoastChunkStreamState> {
  if (!isRoastChunkStreamPlayerAvailable() || !nativeModule) {
    return {
      status: 'unsupported',
      error: Platform.OS === 'ios' ? 'chunk_stream_player_unavailable' : 'chunk_stream_player_unsupported',
      playbackStarted: false,
    };
  }
  const sanitizedOptions = sanitizeOptions(options);
  if (sanitizedOptions && nativeModule.playStreamWithOptions) {
    return nativeModule.playStreamWithOptions(url, sanitizedOptions);
  }
  return nativeModule.playStream(url);
}

export async function stopChunkStream(): Promise<void> {
  if (!nativeModule?.stop) return;
  await nativeModule.stop();
}

export async function getChunkStreamState(): Promise<RoastChunkStreamState | null> {
  if (!nativeModule?.getState) return null;
  return nativeModule.getState().catch(() => null);
}

export function subscribeChunkStreamEvents(listener: (event: RoastChunkStreamEvent) => void) {
  if (!eventEmitter) return () => {};
  const subscriptions = chunkStreamEvents.map((eventName) =>
    eventEmitter.addListener(eventName, (payload: RoastChunkStreamState) => {
      listener({ ...payload, type: eventName });
    }),
  );
  return () => {
    subscriptions.forEach((subscription) => subscription.remove());
  };
}

export async function playRoastChunkStreamUrl(url: string, t0Click = now(), options?: RoastChunkStreamPlayOptions) {
  if (!isRoastChunkStreamPlayerAvailable() || !nativeModule) {
    return {
      supported: false,
      reason: 'chunk_stream_player_unavailable',
      t0Click,
    };
  }

  const t1NativeCall = now();
  const playWithOneRetry = async () => {
    try {
      const first = await playChunkStream(url, options);
      if (first.playbackStarted || first.status === 'playing' || first.status === 'ended') return first;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return playChunkStream(url, options);
    } catch (firstError) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        return await playChunkStream(url, options);
      } catch {
        throw firstError;
      }
    }
  };

  try {
    const state = await playWithOneRetry();
    const t2Resolved = now();
    return {
      supported: true,
      reason: state.status || 'chunk_stream_started',
      state,
      t0Click,
      t1NativeCall,
      t2Resolved,
      clickToResolvedMs: Math.round(t2Resolved - t0Click),
    };
  } catch (error) {
    logChunkStreamPlayFailed(url, sanitizeOptions(options), error);
    return {
      supported: false,
      reason: 'chunk_stream_player_failed',
      error: error instanceof Error ? error.message : 'chunk_stream_failed',
      t0Click,
      t1NativeCall,
    };
  }
}

export async function getRoastChunkStreamState() {
  return getChunkStreamState();
}

export async function stopRoastChunkStreamPlayer() {
  return stopChunkStream().catch(() => null);
}

export async function restoreRoastIpadTtsSessionExperiment(context: RoastIpadTtsSessionExperimentContext) {
  if (Platform.OS !== 'ios' || !nativeModule?.restoreIpadTtsSessionExperiment) return null;
  return nativeModule.restoreIpadTtsSessionExperiment(context).catch(() => null);
}

export async function setRoastWebRtcManualAudioEnabled(enabled: boolean) {
  if (Platform.OS !== 'ios' || !nativeModule?.setManualAudioEnabled) return null;
  try {
    const result = await nativeModule.setManualAudioEnabled(enabled);
    console.log('[ROAST_VPIO_TOGGLE_JS]', JSON.stringify({
      action: 'set_manual_audio',
      requested: enabled,
      useManualAudio: result?.useManualAudio ?? null,
      isAudioEnabled: result?.isAudioEnabled ?? null,
      prevUseManualAudio: result?.prevUseManualAudio ?? null,
      prevIsAudioEnabled: result?.prevIsAudioEnabled ?? null,
    }));
    return result;
  } catch (error) {
    console.warn('[ROAST_VPIO_TOGGLE_JS_FAILED]', JSON.stringify({
      requested: enabled,
      errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown'),
    }));
    return null;
  }
}
