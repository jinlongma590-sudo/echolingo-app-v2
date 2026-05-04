# Native Audio Tap Diagnosis

## Current safety state

- `ENABLE_NATIVE_AUDIO_TAP=false`
- `AppDelegate` does not install a custom WebRTC audio device by default
- Formal V1 remains on the original OpenAI Realtime audio path
- XFYUN transcript / scoring stays in dev mock mode until a safe user-audio copy path exists

## Why the previous iOS PoC broke AI playback

The previous iOS PoC replaced the entire WebRTC `RTCAudioDevice` through
`WebRTCModuleOptions.sharedInstance.audioDevice`.

That means the custom device did not just "observe microphone PCM". It fully
replaced the default WebRTC audio backend responsible for both:

- audio recording
- audio playout

So once we installed `UltraSpeechTapAudioDevice`, it became responsible for the
full `RTCAudioDevice` contract, not only microphone capture.

The main risks observed in the PoC implementation:

1. Input and output were forced to share the same channel count and stream
   format.
   The implementation used `_numberOfChannels` from `AVAudioSession.inputNumberOfChannels`
   for both input and output buses.

2. Output parameters were not managed independently from input parameters.
   A real production `RTCAudioDevice` usually needs separate, route-aware
   handling for input/output sample rate, buffer duration, latency, and channel
   count.

3. The AudioUnit contract was treated like a thin pipe, but replacing the
   default WebRTC device requires complete ownership of playout behavior.

4. No dedicated playout health diagnostics existed.
   We had no callback-level logging proving:
   - playout initialized
   - playout started
   - output callback fired continuously
   - `getPlayoutData` was receiving valid frames

Because the full device was replaced, any playout mismatch could directly break
OpenAI Realtime AI voice output.

## Why `durationMs` looked too short

Observed PoC result:

- `size=283244`
- `sampleRate=48000`
- `channels=4`
- `durationMs=738`

The `durationMs` calculation used:

`pcmBytes / (channels * 2 bytes * sampleRate)`

If `channels=4` is wrong metadata, the computed duration is underreported.

Example:

- `283244 / (4 * 2 * 48000) ~= 0.737s`
- `283244 / (1 * 2 * 48000) ~= 2.95s`

So the short duration is very likely at least partly a metadata problem,
not only a capture-length problem.

## Why `channels=4` is a red flag

For downstream ASR / pronunciation scoring, this is not a usable final format.

Expected downstream normalization:

- 16 kHz
- mono
- 16-bit PCM
- WAV container

Even if capture succeeds, the file still needs:

- channel selection / downmix
- resample from 48 kHz to 16 kHz
- final WAV normalization

## iOS path assessment

### Path A: Replace the whole `RTCAudioDevice`

Verdict: high risk

Pros:

- Can theoretically duplicate mic PCM inside the same WebRTC recording path

Cons:

- Replaces the default WebRTC backend
- Must fully own playout and recording
- Easy to break OpenAI Realtime AI voice playback
- Requires full contract compliance and detailed callback diagnostics

Recommendation:

- Do not enable by default in formal V1
- Only use behind an explicit hidden diagnostic/probe switch

### Path B: Lightweight iOS tap without replacing `audioDevice`

Verdict: currently unproven

In the current local iOS headers and wrapper surface, we did not find an
official lightweight local-track PCM sink/observer exposed through:

- `RTCAudioTrack`
- `RTCAudioSource`
- `react-native-webrtc` iOS wrapper

That means there is no confirmed "just observe local mic PCM" hook available in
the current app surface.

### Path C: AVAudioEngine input tap

Verdict: possible research path, still risky

Potential upside:

- Does not necessarily require replacing the full WebRTC `RTCAudioDevice`

Main risk:

- Could still interfere with the same `AVAudioSession`
- Must be verified against Realtime voice playback and echo-cancel path

Recommendation:

- Only test in an isolated hidden probe
- Never default-enable in formal V1 before playback health is proven

## Android path assessment

The local Android wrapper already imports:

- `AudioDeviceModule`
- `JavaAudioDeviceModule`

and builds the default ADM with:

- `JavaAudioDeviceModule.builder(reactContext)...createAudioDeviceModule()`

This suggests a safer investigation path on Android because WebRTC Android
commonly supports `setSamplesReadyCallback(...)` on `JavaAudioDeviceModule.Builder`.

In the current local package, that callback is not wired yet, but the Android
architecture looks more promising than the current iOS whole-device replacement.

## Recommended next-step levels

### Level 1: Safest

- Keep formal V1 on original Realtime audio device
- Keep iOS native tap disabled
- Review / PoC Android `SamplesReadyCallback`
- Keep iOS in mock or separate non-Realtime evaluation mode

### Level 2: Medium risk

- Add a hidden iOS diagnostic route / explicit probe-only switch
- Test a non-default iOS tap path
- Require callback-level playback health logs
- Never affect formal V1 by default

### Level 3: High risk

- Continue full custom iOS `RTCAudioDevice`
- Implement full playout + recording parity
- Add deep callback diagnostics
- Only consider wider use after isolated probe stability

## Diagnostic logs for the next isolated probe

Prefix:

- `[NATIVE_AUDIO_TAP_DIAG]`

Events to add:

- `install_attempted`
- `install_skipped_disabled`
- `audio_device_contract_check`
- `playout_init`
- `playout_start`
- `playout_stop`
- `recording_init`
- `recording_start`
- `recording_stop`
- `input_callback_received`
- `output_callback_received`
- `recorded_buffer_stats`
- `wav_write_success`
- `realtime_audio_health_check`

`realtime_audio_health_check` should explicitly include:

- whether `assistant_audio_started` appeared
- whether `output_audio_buffer.started` appeared
- whether `response.output_audio.done` appeared
- a marker saying "human audible confirmation required"
