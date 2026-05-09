#import "UltraSpeechCaptureModule.h"

#import "UltraSpeechTapAudioDevice.h"

static BOOL const ENABLE_NATIVE_AUDIO_TAP = NO;
static NSString *const UltraSpeechCaptureDisabledReason = @"native_audio_tap_disabled_to_protect_realtime_audio";

@implementation UltraSpeechCaptureModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_REMAP_METHOD(isSupported,
                 isSupportedWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    resolve(@{
      @"supported": @NO,
      @"platform": @"ios",
      @"reason": UltraSpeechCaptureDisabledReason,
    });
    return;
  }
  resolve([[UltraSpeechTapAudioDevice sharedDevice] supportInfo]);
}

RCT_REMAP_METHOD(startTurn,
                 startTurnWithInput:(NSDictionary *)input
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *turnId = [input[@"turnId"] isKindOfClass:[NSString class]] ? input[@"turnId"] : @"";
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    resolve(@{
      @"ok": @NO,
      @"turnId": turnId,
      @"reason": @"native_audio_tap_disabled",
    });
    return;
  }
  NSError *error = nil;
  NSDictionary *result = [[UltraSpeechTapAudioDevice sharedDevice] startTurn:turnId error:&error];
  if ([result[@"ok"] boolValue]) {
    resolve(result);
    return;
  }
  reject(@"ULTRA_SPEECH_START_FAILED", error.localizedDescription ?: @"start_failed", error);
}

RCT_REMAP_METHOD(stopTurn,
                 stopTurnWithInput:(NSDictionary *)input
                 stopResolver:(RCTPromiseResolveBlock)resolve
                 stopRejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *turnId = [input[@"turnId"] isKindOfClass:[NSString class]] ? input[@"turnId"] : @"";
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    resolve(@{
      @"ok": @NO,
      @"turnId": turnId,
      @"reason": @"native_audio_tap_disabled",
    });
    return;
  }
  NSError *error = nil;
  NSDictionary *result = [[UltraSpeechTapAudioDevice sharedDevice] stopTurn:turnId error:&error];
  if ([result[@"ok"] boolValue]) {
    resolve(result);
    return;
  }
  reject(@"ULTRA_SPEECH_STOP_FAILED", error.localizedDescription ?: @"stop_failed", error);
}

RCT_REMAP_METHOD(getLastResult,
                 getLastResultWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    resolve(@{
      @"ok": @NO,
      @"reason": @"native_audio_tap_disabled",
    });
    return;
  }
  resolve([[UltraSpeechTapAudioDevice sharedDevice] lastResult]);
}

@end
