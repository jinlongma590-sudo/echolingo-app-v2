import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

function ensureAudioRoutingAvailable() {
  if (Platform.OS === 'web') {
    throw new Error('Web 端不支持实时通话音频路由切换。');
  }

  if (!AudioModule?.setAudioModeAsync) {
    throw new Error('当前构建未接通 expo-audio，无法切换实时通话音频路由。');
  }
}

export async function applySpeakingRealtimeAudioRoute(enabledSpeaker: boolean) {
  ensureAudioRoutingAvailable();

  console.log(
    '[V2][audio] v2_audio_mode_config_start',
    JSON.stringify({
      enabledSpeaker,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      allowsRecording: true,
      shouldRouteThroughEarpiece: !enabledSpeaker,
    }),
  );

  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: false,
    allowsRecording: true,
    shouldRouteThroughEarpiece: !enabledSpeaker,
    allowsBackgroundRecording: false,
  });

  console.log(
    '[V2][audio] v2_audio_mode_config_done',
    JSON.stringify({
      enabledSpeaker,
      route: enabledSpeaker ? 'speaker' : 'earpiece',
    }),
  );
}

export async function resetSpeakingRealtimeAudioRoute() {
  if (Platform.OS === 'web' || !AudioModule?.setAudioModeAsync) {
    return;
  }

  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    allowsRecording: false,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: false,
  });
}
