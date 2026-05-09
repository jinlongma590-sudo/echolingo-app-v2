#import "UltraSpeechCaptureInstaller.h"

#import <react-native-webrtc/WebRTCModuleOptions.h>

#import "UltraSpeechTapAudioDevice.h"

@implementation UltraSpeechCaptureInstaller

+ (BOOL)install {
  static BOOL const ENABLE_NATIVE_AUDIO_TAP = NO;
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    return NO;
  }

  static dispatch_once_t onceToken;
  static BOOL installed = NO;
  dispatch_once(&onceToken, ^{
    WebRTCModuleOptions *options = [WebRTCModuleOptions sharedInstance];
    options.audioDevice = [UltraSpeechTapAudioDevice sharedDevice];
    installed = YES;
  });
  return installed;
}

@end
