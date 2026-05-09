#import <Foundation/Foundation.h>
#import <WebRTC/WebRTC.h>

NS_ASSUME_NONNULL_BEGIN

@interface UltraSpeechTapAudioDevice : NSObject <RTCAudioDevice>

+ (instancetype)sharedDevice;
- (NSDictionary *)supportInfo;
- (NSDictionary *)startTurn:(NSString *)turnId error:(NSError * _Nullable __autoreleasing *)error;
- (NSDictionary *)stopTurn:(NSString *)turnId error:(NSError * _Nullable __autoreleasing *)error;
- (NSDictionary *)lastResult;

@end

NS_ASSUME_NONNULL_END
