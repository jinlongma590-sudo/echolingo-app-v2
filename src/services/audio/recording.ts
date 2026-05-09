import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

import type { SpeakingRecorderCapability, SpeakingRecordingResult } from '@/types/speaking';

export interface SpeakingRecorderController {
  capability: SpeakingRecorderCapability;
  requestPermissions: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  start: () => Promise<void>;
  stop: () => Promise<SpeakingRecordingResult | null>;
  cleanup: () => Promise<void>;
}

export type SpeakingRecorderConfigId = 'high_quality_m4a' | 'roast_aac_16k_mono' | 'roast_aac_24k_mono';

export type SpeakingRecorderConfig = {
  id: SpeakingRecorderConfigId;
  label: string;
  mimeType: string;
  fileName: string;
  options: RecordingOptions;
};

function withAndroidFallback(options: RecordingOptions): RecordingOptions {
  return {
    ...options,
    android: {
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
      sampleRate: options.sampleRate,
      extension: options.extension,
    },
    web: {
      mimeType: 'audio/mp4',
      bitsPerSecond: options.bitRate,
    },
  };
}

export const SPEAKING_RECORDER_CONFIGS: Record<SpeakingRecorderConfigId, SpeakingRecorderConfig> = {
  high_quality_m4a: {
    id: 'high_quality_m4a',
    label: 'High m4a 44.1k stereo 128k',
    mimeType: 'audio/m4a',
    fileName: 'speaking-recording-high.m4a',
    options: RecordingPresets.HIGH_QUALITY,
  },
  roast_aac_16k_mono: {
    id: 'roast_aac_16k_mono',
    label: 'Roast AAC 16k mono 32k',
    mimeType: 'audio/m4a',
    fileName: 'roast-recording-16k.m4a',
    options: withAndroidFallback({
      extension: '.m4a',
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 32000,
      android: RecordingPresets.HIGH_QUALITY.android,
      ios: {
        extension: '.m4a',
        sampleRate: 16000,
        outputFormat: IOSOutputFormat.MPEG4AAC,
        audioQuality: AudioQuality.LOW,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: RecordingPresets.HIGH_QUALITY.web,
    }),
  },
  roast_aac_24k_mono: {
    id: 'roast_aac_24k_mono',
    label: 'Roast AAC 24k mono 48k',
    mimeType: 'audio/m4a',
    fileName: 'roast-recording-24k.m4a',
    options: withAndroidFallback({
      extension: '.m4a',
      sampleRate: 24000,
      numberOfChannels: 1,
      bitRate: 48000,
      android: RecordingPresets.HIGH_QUALITY.android,
      ios: {
        extension: '.m4a',
        sampleRate: 24000,
        outputFormat: IOSOutputFormat.MPEG4AAC,
        audioQuality: AudioQuality.MEDIUM,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: RecordingPresets.HIGH_QUALITY.web,
    }),
  },
};

const RECORDING_DEBUG_PREFIX = '[V1_RECORDING_DEBUG]';

function debugLog(key: string, value: unknown) {
  let normalized: string;
  if (typeof value === 'string') {
    normalized = value;
  } else {
    try {
      normalized = JSON.stringify(value);
    } catch {
      normalized = String(value);
    }
  }
  console.log(`${RECORDING_DEBUG_PREFIX} ${key} = ${normalized}`);
}

function summarizeRecorderStatus(status: Record<string, unknown> | null | undefined) {
  return {
    canRecord: typeof status?.canRecord === 'boolean' ? status.canRecord : null,
    isRecording: typeof status?.isRecording === 'boolean' ? status.isRecording : null,
    durationMillis: typeof status?.durationMillis === 'number' ? status.durationMillis : null,
    url: typeof status?.url === 'string' ? status.url : null,
    mediaServicesDidReset:
      typeof status?.mediaServicesDidReset === 'boolean' ? status.mediaServicesDidReset : null,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRecordedFile(uri: string, attempts = 3, delayMs = 160) {
  let lastInfo: { exists?: boolean; size?: number | null } | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const info = await FileSystem.getInfoAsync(uri);
    const size = 'size' in info && typeof info.size === 'number' ? info.size : null;
    lastInfo = { exists: info.exists, size };

    debugLog('file_info_attempt', {
      attempt,
      uri,
      exists: info.exists,
      size,
    });

    if (info.exists && (size == null || size > 0)) {
      return lastInfo;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  return lastInfo;
}

function createUnsupportedRecorder(reason: string): SpeakingRecorderController {
  return {
    capability: {
      available: false,
      provider: 'none',
      reason,
    },
    async requestPermissions() {
      return { granted: false, canAskAgain: false };
    },
    async start() {
      throw new Error(reason);
    },
    async stop() {
      return null;
    },
    async cleanup() {
      return;
    },
  };
}

export function createSpeakingRecorder(configId: SpeakingRecorderConfigId = 'high_quality_m4a'): SpeakingRecorderController {
  if (!AudioModule?.AudioRecorder) {
    return createUnsupportedRecorder('当前构建未接通 expo-audio，真机录音不可用。');
  }

  let recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
  let isStarting = false;
  let isStopping = false;
  const config = SPEAKING_RECORDER_CONFIGS[configId] ?? SPEAKING_RECORDER_CONFIGS.high_quality_m4a;

  async function ensureRecorder() {
    if (!recorder) {
      recorder = new AudioModule.AudioRecorder(config.options);
      debugLog('recording_recorder_created', {
        provider: 'expo-audio',
        configId: config.id,
        configLabel: config.label,
      });
    }
    return recorder;
  }

  async function resetAudioMode(allowsRecording: boolean) {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      allowsRecording,
      shouldRouteThroughEarpiece: false,
    });
  }

  return {
    capability: {
      available: true,
      provider: 'expo-audio',
    },
    async requestPermissions() {
      debugLog('permission_check_before', {
        provider: 'expo-audio',
      });
      const current = await getRecordingPermissionsAsync();
      debugLog('permission_check_current', {
        granted: !!current.granted,
        canAskAgain: current.canAskAgain,
        status: current.status ?? null,
      });
      if (current.granted) {
        return {
          granted: true,
          canAskAgain: current.canAskAgain,
        };
      }

      const response = await requestRecordingPermissionsAsync();
      debugLog('permission_check_requested', {
        granted: !!response.granted,
        canAskAgain: response.canAskAgain,
        status: response.status ?? null,
      });
      return {
        granted: !!response.granted,
        canAskAgain: response.canAskAgain,
      };
    },
    async start() {
      if (isStarting) {
        throw new Error('录音正在启动，请稍候。');
      }
      if (isStopping) {
        throw new Error('录音正在停止，请稍候。');
      }

      const activeRecorder = await ensureRecorder();
      const currentStatus = activeRecorder.getStatus();
      debugLog('recording_start_before', {
        timestamp: new Date().toISOString(),
        status: summarizeRecorderStatus(currentStatus as Record<string, unknown>),
      });
      if (currentStatus.isRecording) {
        throw new Error('当前已经在录音中。');
      }

      isStarting = true;
      try {
        await resetAudioMode(true);
        await activeRecorder.prepareToRecordAsync(config.options);
        debugLog('recording_prepared', {
          timestamp: new Date().toISOString(),
          configId: config.id,
          status: summarizeRecorderStatus(activeRecorder.getStatus() as Record<string, unknown>),
        });
        activeRecorder.record();
        debugLog('recording_start_after', {
          timestamp: new Date().toISOString(),
          status: summarizeRecorderStatus(activeRecorder.getStatus() as Record<string, unknown>),
        });
      } finally {
        isStarting = false;
      }
    },
    async stop() {
      if (!recorder) return null;
      if (isStopping) {
        throw new Error('录音正在停止，请稍候。');
      }

      const currentStatus = recorder.getStatus();
      debugLog('recording_stop_before', {
        timestamp: new Date().toISOString(),
        status: summarizeRecorderStatus(currentStatus as Record<string, unknown>),
      });
      if (!currentStatus.isRecording && !currentStatus.url) {
        debugLog('recording_stop_reason', 'not_recording_and_no_url');
        return null;
      }

      isStopping = true;
      try {
        if (currentStatus.isRecording) {
          await recorder.stop();
        }

        const finalStatus = recorder.getStatus();
        debugLog('recording_stop_after', {
          timestamp: new Date().toISOString(),
          status: summarizeRecorderStatus(finalStatus as Record<string, unknown>),
        });
        await resetAudioMode(false);

        const resolvedUri =
          (typeof finalStatus.url === 'string' && finalStatus.url) ||
          (typeof currentStatus.url === 'string' && currentStatus.url) ||
          null;
        const durationMsCandidates = [currentStatus.durationMillis, finalStatus.durationMillis].filter(
          (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
        );
        const durationMs =
          durationMsCandidates.length > 0 ? Math.max(...durationMsCandidates) : null;

        if (!resolvedUri) {
          debugLog('recording_stop_reason', 'missing_url_after_stop');
          return null;
        }

        const fileInfo = await waitForRecordedFile(resolvedUri);
        if (!fileInfo?.exists) {
          debugLog('recording_stop_reason', 'file_missing_after_stop');
          return null;
        }

        if (typeof fileInfo.size === 'number' && fileInfo.size <= 0) {
          debugLog('recording_stop_reason', 'file_empty_after_stop');
          return null;
        }

        debugLog('recording_stop_result', {
          timestamp: new Date().toISOString(),
          uri: resolvedUri,
          durationMs,
          size: fileInfo?.size ?? null,
          mimeType: config.mimeType,
          fileName: config.fileName,
          configId: config.id,
          configLabel: config.label,
        });

        return {
          uri: resolvedUri,
          mimeType: config.mimeType,
          fileName: config.fileName,
          durationMs,
          size: fileInfo?.size ?? null,
          configId: config.id,
        };
      } finally {
        isStopping = false;
      }
    },
    async cleanup() {
      if (!recorder) {
        await resetAudioMode(false).catch(() => undefined);
        return;
      }

      try {
        const currentStatus = recorder.getStatus();
        if (currentStatus.isRecording) {
          await recorder.stop();
        }
      } catch {
        // ignore stop failures during cleanup
      }

      recorder = null;

      await resetAudioMode(false).catch(() => undefined);
    },
  };
}
