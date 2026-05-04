import type { SpeakingRecorderCapability, SpeakingRecordingResult } from '@/types/speaking';

function getDynamicRequire(): ((moduleName: string) => any) | null {
  try {
    // Keep the import dynamic so TypeScript/Metro don't require the module at build time.
    return Function('return typeof require !== "undefined" ? require : null;')() as
      | ((moduleName: string) => any)
      | null;
  } catch {
    return null;
  }
}

export interface SpeakingRecorderController {
  capability: SpeakingRecorderCapability;
  requestPermissions: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  start: () => Promise<void>;
  stop: () => Promise<SpeakingRecordingResult | null>;
  cleanup: () => Promise<void>;
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

export function createSpeakingRecorder(): SpeakingRecorderController {
  const dynamicRequire = getDynamicRequire();
  if (!dynamicRequire) {
    return createUnsupportedRecorder('当前运行环境不支持动态加载录音模块。');
  }

  try {
    const expoAv = dynamicRequire('expo-av');
    const Audio = expoAv?.Audio;

    if (!Audio?.Recording) {
      return createUnsupportedRecorder('当前构建未安装 expo-av，真机录音未接通。');
    }

    let recording: any = null;

    return {
      capability: {
        available: true,
        provider: 'expo-av',
      },
      async requestPermissions() {
        const response = await Audio.requestPermissionsAsync();
        return {
          granted: !!response.granted,
          canAskAgain: response.canAskAgain,
        };
      },
      async start() {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        recording = new Audio.Recording();
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await recording.startAsync();
      },
      async stop() {
        if (!recording) return null;

        await recording.stopAndUnloadAsync();
        const uri = recording.getURI?.();
        const status = await recording.getStatusAsync?.();

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        recording = null;

        if (!uri) return null;

        return {
          uri,
          mimeType: 'audio/m4a',
          fileName: 'speaking-recording.m4a',
          durationMs: typeof status?.durationMillis === 'number' ? status.durationMillis : null,
          size: null,
        };
      },
      async cleanup() {
        if (!recording) return;
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          // ignore
        }
        recording = null;
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
          });
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return createUnsupportedRecorder('当前构建未安装 expo-av，真机录音未接通。');
  }
}
