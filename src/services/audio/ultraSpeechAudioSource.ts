export type UltraSpeechAudioSource =
  | { type: 'none'; reason: string }
  | {
      type: 'native_tap';
      supported: boolean;
      uri?: string;
      mimeType?: string;
      durationMs?: number;
      size?: number;
      sampleRate?: number;
      channels?: number;
    }
  | {
      type: 'uploaded_file';
      uri: string;
      mimeType?: string;
      durationMs?: number;
      size?: number;
      sampleRate?: number;
      channels?: number;
    }
  | { type: 'mock_audio'; uri?: string };

export async function getUltraSpeechAudioSourceForTurn(_turnId: string): Promise<UltraSpeechAudioSource> {
  return {
    type: 'none',
    reason: 'native_audio_tap_disabled_to_protect_realtime_audio',
  };
}
