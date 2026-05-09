#import "PcmCaptureModule.h"

#import <AVFoundation/AVFoundation.h>
#import <math.h>
#import <os/lock.h>

static NSString *const PcmCaptureErrorDomain = @"cn.echolingo.pcmCapture";

@interface PcmCaptureModule ()

@property (nonatomic, strong) AVAudioEngine *audioEngine;
@property (nonatomic, strong) AVAudioConverter *audioConverter;
@property (nonatomic, strong) AVAudioFormat *targetFormat;
@property (nonatomic, strong) NSMutableData *pendingPcmData;
@property (nonatomic, strong) NSMutableData *capturedPcmData;
@property (nonatomic, assign) NSInteger targetSampleRate;
@property (nonatomic, assign) NSInteger targetChannels;
@property (nonatomic, assign) NSInteger chunkMs;
@property (nonatomic, assign) NSUInteger chunkByteLength;
@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, assign) BOOL isCapturing;
@property (nonatomic, assign) NSUInteger sequence;
@property (nonatomic, assign) NSUInteger chunksEmitted;
@property (nonatomic, assign) NSUInteger bytesEmitted;
@property (nonatomic, assign) NSUInteger nativeBufferCount;
@property (nonatomic, assign) CFAbsoluteTime afterPlaybackProbeUntil;
@property (nonatomic, assign) CFAbsoluteTime startedAt;
@property (nonatomic, assign) CFAbsoluteTime lastStatsAt;
@property (nonatomic, assign) os_unfair_lock stateLock;

@end

@implementation PcmCaptureModule

RCT_EXPORT_MODULE();

- (instancetype)init
{
  self = [super init];
  if (self) {
    _stateLock = OS_UNFAIR_LOCK_INIT;
    _pendingPcmData = [NSMutableData data];
    _capturedPcmData = [NSMutableData data];
    _targetSampleRate = 24000;
    _targetChannels = 1;
    _chunkMs = 40;
    _chunkByteLength = (NSUInteger)((_targetSampleRate * _targetChannels * 2 * _chunkMs) / 1000);
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"pcmChunk", @"captureStats" ];
}

- (void)startObserving
{
  self.hasListeners = YES;
}

- (void)stopObserving
{
  self.hasListeners = NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

RCT_REMAP_METHOD(isSupported,
                 isSupportedWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@{
    @"supported": @YES,
    @"platform": @"ios",
  });
}

RCT_REMAP_METHOD(start,
                 startWithInput:(NSDictionary *)input
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSInteger sampleRate = [input[@"sampleRate"] respondsToSelector:@selector(integerValue)] ? [input[@"sampleRate"] integerValue] : 24000;
  NSInteger channels = [input[@"channels"] respondsToSelector:@selector(integerValue)] ? [input[@"channels"] integerValue] : 1;
  NSInteger chunkMs = [input[@"chunkMs"] respondsToSelector:@selector(integerValue)] ? [input[@"chunkMs"] integerValue] : 40;

  if (sampleRate <= 0 || channels <= 0 || chunkMs <= 0) {
    resolve(@{
      @"ok": @NO,
      @"sampleRate": @(MAX(sampleRate, 24000)),
      @"channels": @(MAX(channels, 1)),
      @"chunkMs": @(MAX(chunkMs, 40)),
      @"format": @"pcm16",
      @"reason": @"invalid_capture_config",
    });
    return;
  }

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  AVAudioSessionRecordPermission permission = [[AVAudioSession sharedInstance] recordPermission];
  if (permission == AVAudioSessionRecordPermissionDenied) {
    resolve(@{
      @"ok": @NO,
      @"sampleRate": @(sampleRate),
      @"channels": @(channels),
      @"chunkMs": @(chunkMs),
      @"format": @"pcm16",
      @"reason": @"microphone_permission_denied",
    });
    return;
  }
#pragma clang diagnostic pop

  [self requestPermissionAndStartWithSampleRate:sampleRate
                                       channels:channels
                                        chunkMs:chunkMs
                                       resolver:resolve];
}

RCT_REMAP_METHOD(stop,
                 stopWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self stopCaptureEngine];

  NSData *capturedBytes = nil;
  NSInteger sampleRate = self.targetSampleRate;
  NSInteger channels = self.targetChannels;
  NSInteger chunkMs = self.chunkMs;
  BOOL hadCapture = NO;

  os_unfair_lock_lock(&_stateLock);
  hadCapture = self.capturedPcmData.length > 0;
  capturedBytes = [self.capturedPcmData copy];
  self.pendingPcmData = [NSMutableData data];
  self.capturedPcmData = [NSMutableData data];
  self.isCapturing = NO;
  os_unfair_lock_unlock(&_stateLock);

  NSUInteger capturedLength = capturedBytes.length;
  double bytesPerSecond = (double)sampleRate * (double)channels * 2.0;
  NSInteger durationMs = bytesPerSecond > 0 ? (NSInteger)llround(((double)capturedLength / bytesPerSecond) * 1000.0) : 0;

  resolve(@{
    @"ok": hadCapture ? @YES : @NO,
    @"capturedBytes": @(capturedLength),
    @"sampleRate": @(sampleRate),
    @"channels": @(channels),
    @"chunkMs": @(chunkMs),
    @"format": @"pcm16",
    @"durationMs": @(durationMs),
    @"reason": hadCapture ? [NSNull null] : @"empty_capture",
  });
}

RCT_REMAP_METHOD(getAudioSessionRoute,
                 getAudioSessionRouteWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self currentAudioSessionRoutePayload]);
}

RCT_REMAP_METHOD(forceSpeakerOutput,
                 forceSpeakerOutputWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *sessionError = nil;
  BOOL ok = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&sessionError];
  if (!ok || sessionError) {
    reject(@"pcm_capture_force_speaker_failed",
           sessionError.localizedDescription ?: @"force_speaker_failed",
           sessionError);
    return;
  }

  resolve(@YES);
}

RCT_REMAP_METHOD(prepareSpeakerPlayback,
                 prepareSpeakerPlaybackWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *sessionError = nil;
  [session setCategory:AVAudioSessionCategoryPlayAndRecord
           withOptions:(AVAudioSessionCategoryOptionDefaultToSpeaker |
                        AVAudioSessionCategoryOptionAllowBluetooth |
                        AVAudioSessionCategoryOptionAllowBluetoothA2DP)
                 error:&sessionError];
  if (!sessionError) {
    [session setMode:AVAudioSessionModeDefault error:&sessionError];
  }
  if (!sessionError) {
    [session setActive:YES error:&sessionError];
  }
  if (!sessionError) {
    [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&sessionError];
  }

  if (sessionError) {
    reject(@"pcm_capture_prepare_speaker_playback_failed",
           sessionError.localizedDescription ?: @"prepare_speaker_playback_failed",
           sessionError);
    return;
  }

  resolve([self currentAudioSessionRoutePayload]);
}

RCT_REMAP_METHOD(ensureCaptureActiveAfterPlayback,
                 ensureCaptureActiveAfterPlaybackWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *sessionError = nil;
  NSLog(@"[PcmCaptureModule] pcm_native_route_after_playback %@",
        [self currentAudioSessionRoutePayload]);

  BOOL engineRunning = self.audioEngine != nil && self.audioEngine.isRunning;
  AVAudioInputNode *inputNode = self.audioEngine.inputNode;
  NSDictionary *enginePayload = @{
    @"isCapturing": @(self.isCapturing),
    @"engineRunning": @(engineRunning),
    @"inputNodeInputs": @(inputNode ? inputNode.numberOfInputs : 0),
    @"inputNodeOutputs": @(inputNode ? inputNode.numberOfOutputs : 0),
    @"sampleRate": @(self.targetSampleRate),
    @"channels": @(self.targetChannels),
    @"chunkMs": @(self.chunkMs),
    @"timestamp": @((NSInteger)llround(CFAbsoluteTimeGetCurrent() * 1000.0)),
  };
  NSLog(@"[PcmCaptureModule] pcm_native_engine_state_after_playback %@", enginePayload);

  [session setCategory:AVAudioSessionCategoryPlayAndRecord
           withOptions:(AVAudioSessionCategoryOptionDefaultToSpeaker |
                        AVAudioSessionCategoryOptionAllowBluetooth |
                        AVAudioSessionCategoryOptionAllowBluetoothA2DP)
                 error:&sessionError];
  if (!sessionError) {
    [session setMode:AVAudioSessionModeVoiceChat error:&sessionError];
  }
  if (!sessionError) {
    [session setActive:YES error:&sessionError];
  }
  [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:nil];

  if (sessionError) {
    NSLog(@"[PcmCaptureModule] pcm_native_capture_resume_failed %@",
          @{
            @"reason": sessionError.localizedDescription ?: @"audio_session_resume_failed",
            @"engineRunning": @(engineRunning),
            @"isCapturing": @(self.isCapturing),
            @"route": [self currentAudioSessionRoutePayload],
          });
    resolve(@{
      @"ok": @NO,
      @"restarted": @NO,
      @"reason": sessionError.localizedDescription ?: @"audio_session_resume_failed",
      @"engineRunning": @(engineRunning),
      @"isCapturing": @(self.isCapturing),
    });
    return;
  }

  self.afterPlaybackProbeUntil = CFAbsoluteTimeGetCurrent() + 8.0;

  BOOL shouldRestart = !self.isCapturing || !engineRunning || inputNode == nil || inputNode.numberOfInputs == 0;
  if (!shouldRestart) {
    NSLog(@"[PcmCaptureModule] pcm_native_capture_resume_noop %@",
          @{
            @"engineRunning": @(engineRunning),
            @"isCapturing": @(self.isCapturing),
            @"route": [self currentAudioSessionRoutePayload],
          });
    resolve(@{
      @"ok": @YES,
      @"restarted": @NO,
      @"reason": @"capture_active",
      @"engineRunning": @(engineRunning),
      @"isCapturing": @(self.isCapturing),
      @"route": [self currentAudioSessionRoutePayload],
    });
    return;
  }

  NSError *restartError = nil;
  BOOL restarted = [self startCaptureEngineWithSampleRate:self.targetSampleRate
                                                 channels:self.targetChannels
                                                  chunkMs:self.chunkMs
                                                    error:&restartError];
  self.afterPlaybackProbeUntil = CFAbsoluteTimeGetCurrent() + 8.0;
  if (!restarted || restartError) {
    NSLog(@"[PcmCaptureModule] pcm_native_capture_resume_failed %@",
          @{
            @"reason": restartError.localizedDescription ?: @"capture_restart_failed",
            @"route": [self currentAudioSessionRoutePayload],
          });
    resolve(@{
      @"ok": @NO,
      @"restarted": @NO,
      @"reason": restartError.localizedDescription ?: @"capture_restart_failed",
      @"engineRunning": @(self.audioEngine.isRunning),
      @"isCapturing": @(self.isCapturing),
    });
    return;
  }

  NSLog(@"[PcmCaptureModule] pcm_native_capture_resume_restarted %@",
        @{
          @"engineRunning": @(self.audioEngine.isRunning),
          @"isCapturing": @(self.isCapturing),
          @"route": [self currentAudioSessionRoutePayload],
        });
  resolve(@{
    @"ok": @YES,
    @"restarted": @YES,
    @"reason": @"capture_restarted",
    @"engineRunning": @(self.audioEngine.isRunning),
    @"isCapturing": @(self.isCapturing),
    @"route": [self currentAudioSessionRoutePayload],
  });
}

- (void)requestPermissionAndStartWithSampleRate:(NSInteger)sampleRate
                                       channels:(NSInteger)channels
                                        chunkMs:(NSInteger)chunkMs
                                       resolver:(RCTPromiseResolveBlock)resolve
{
  void (^startBlock)(BOOL granted) = ^(BOOL granted) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!granted) {
        resolve(@{
          @"ok": @NO,
          @"sampleRate": @(sampleRate),
          @"channels": @(channels),
          @"chunkMs": @(chunkMs),
          @"format": @"pcm16",
          @"reason": @"microphone_permission_denied",
        });
        return;
      }

      NSError *error = nil;
      BOOL started = [self startCaptureEngineWithSampleRate:sampleRate
                                                   channels:channels
                                                    chunkMs:chunkMs
                                                      error:&error];
      if (!started) {
        resolve(@{
          @"ok": @NO,
          @"sampleRate": @(sampleRate),
          @"channels": @(channels),
          @"chunkMs": @(chunkMs),
          @"format": @"pcm16",
          @"reason": error.localizedDescription ?: @"pcm_capture_start_failed",
        });
        return;
      }

      resolve(@{
        @"ok": @YES,
        @"sampleRate": @(sampleRate),
        @"channels": @(channels),
        @"chunkMs": @(chunkMs),
        @"format": @"pcm16",
      });
    });
  };

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [[AVAudioSession sharedInstance] requestRecordPermission:startBlock];
#pragma clang diagnostic pop
}

- (BOOL)startCaptureEngineWithSampleRate:(NSInteger)sampleRate
                                channels:(NSInteger)channels
                                 chunkMs:(NSInteger)chunkMs
                                   error:(NSError * _Nullable __autoreleasing *)error
{
  [self stopCaptureEngine];

  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *sessionError = nil;
  [session setCategory:AVAudioSessionCategoryPlayAndRecord
           withOptions:(AVAudioSessionCategoryOptionDefaultToSpeaker |
                        AVAudioSessionCategoryOptionAllowBluetooth |
                        AVAudioSessionCategoryOptionAllowBluetoothA2DP)
                 error:&sessionError];
  if (sessionError) {
    if (error) *error = sessionError;
    return NO;
  }

  [session setMode:AVAudioSessionModeVoiceChat error:&sessionError];
  if (sessionError) {
    if (error) *error = sessionError;
    return NO;
  }

  [session setPreferredSampleRate:48000 error:nil];
  [session setActive:YES error:&sessionError];
  if (sessionError) {
    if (error) *error = sessionError;
    return NO;
  }

  [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:nil];

  self.audioEngine = [[AVAudioEngine alloc] init];
  AVAudioInputNode *inputNode = self.audioEngine.inputNode;
  if (!inputNode) {
    if (error) {
      *error = [NSError errorWithDomain:PcmCaptureErrorDomain
                                   code:1001
                               userInfo:@{NSLocalizedDescriptionKey: @"missing_input_node"}];
    }
    return NO;
  }

  AVAudioFormat *inputFormat = [inputNode outputFormatForBus:0];
  self.targetFormat = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                                       sampleRate:sampleRate
                                                         channels:(AVAudioChannelCount)channels
                                                      interleaved:YES];
  self.audioConverter = [[AVAudioConverter alloc] initFromFormat:inputFormat toFormat:self.targetFormat];
  if (!self.audioConverter || !self.targetFormat) {
    if (error) {
      *error = [NSError errorWithDomain:PcmCaptureErrorDomain
                                   code:1002
                               userInfo:@{NSLocalizedDescriptionKey: @"audio_converter_unavailable"}];
    }
    return NO;
  }

  self.targetSampleRate = sampleRate;
  self.targetChannels = channels;
  self.chunkMs = chunkMs;
  self.chunkByteLength = (NSUInteger)((sampleRate * channels * 2 * chunkMs) / 1000);
  self.sequence = 0;
  self.chunksEmitted = 0;
  self.bytesEmitted = 0;
  self.nativeBufferCount = 0;
  self.startedAt = CFAbsoluteTimeGetCurrent();
  self.lastStatsAt = self.startedAt;

  os_unfair_lock_lock(&_stateLock);
  self.pendingPcmData = [NSMutableData data];
  self.capturedPcmData = [NSMutableData data];
  self.isCapturing = YES;
  os_unfair_lock_unlock(&_stateLock);

  __weak typeof(self) weakSelf = self;
  AVAudioFrameCount tapBufferSize = (AVAudioFrameCount)MAX(1024, llround(inputFormat.sampleRate * ((double)chunkMs / 1000.0)));
  [inputNode removeTapOnBus:0];
  [inputNode installTapOnBus:0
                  bufferSize:tapBufferSize
                      format:nil
                       block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
    [weakSelf handleCapturedBuffer:buffer];
  }];

  NSError *startError = nil;
  [self.audioEngine prepare];
  if (![self.audioEngine startAndReturnError:&startError]) {
    [inputNode removeTapOnBus:0];
    self.audioConverter = nil;
    self.targetFormat = nil;
    self.audioEngine = nil;
    os_unfair_lock_lock(&_stateLock);
    self.isCapturing = NO;
    os_unfair_lock_unlock(&_stateLock);
    if (error) *error = startError;
    return NO;
  }

  return YES;
}

- (void)stopCaptureEngine
{
  AVAudioInputNode *inputNode = self.audioEngine.inputNode;
  [inputNode removeTapOnBus:0];
  [self.audioEngine stop];
  self.audioConverter = nil;
  self.targetFormat = nil;
  self.audioEngine = nil;

  NSError *sessionError = nil;
  [[AVAudioSession sharedInstance] setActive:NO
                                 withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                       error:&sessionError];
}

- (void)handleCapturedBuffer:(AVAudioPCMBuffer *)buffer
{
  if (!buffer || !self.audioConverter || !self.targetFormat) {
    return;
  }

  BOOL currentlyCapturing = NO;
  os_unfair_lock_lock(&_stateLock);
  currentlyCapturing = self.isCapturing;
  os_unfair_lock_unlock(&_stateLock);
  if (!currentlyCapturing) {
    return;
  }

  AVAudioFrameCount outputCapacity = (AVAudioFrameCount)ceil((double)buffer.frameLength * ((double)self.targetSampleRate / buffer.format.sampleRate)) + 64;
  AVAudioPCMBuffer *convertedBuffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:self.targetFormat frameCapacity:outputCapacity];
  if (!convertedBuffer) {
    return;
  }

  __block BOOL consumed = NO;
  NSError *convertError = nil;
  AVAudioConverterOutputStatus status = [self.audioConverter convertToBuffer:convertedBuffer
                                                                      error:&convertError
                                                             withInputFromBlock:^AVAudioBuffer * _Nullable(AVAudioPacketCount inNumPackets, AVAudioConverterInputStatus *outStatus) {
    if (consumed) {
      *outStatus = AVAudioConverterInputStatus_NoDataNow;
      return nil;
    }
    consumed = YES;
    *outStatus = AVAudioConverterInputStatus_HaveData;
    return buffer;
  }];

  if (status == AVAudioConverterOutputStatus_Error || convertError || convertedBuffer.frameLength == 0) {
    return;
  }

  AudioBufferList *audioBufferList = convertedBuffer.audioBufferList;
  if (audioBufferList->mNumberBuffers == 0) {
    return;
  }

  AudioBuffer audioBuffer = audioBufferList->mBuffers[0];
  if (audioBuffer.mData == NULL || audioBuffer.mDataByteSize == 0) {
    return;
  }

  NSData *pcmData = [NSData dataWithBytes:audioBuffer.mData length:audioBuffer.mDataByteSize];
  NSMutableArray<NSData *> *chunksToEmit = [NSMutableArray array];
  NSDictionary *statsPayload = nil;
  NSUInteger nativeBufferCount = 0;

  os_unfair_lock_lock(&_stateLock);
  self.nativeBufferCount += 1;
  nativeBufferCount = self.nativeBufferCount;
  [self.pendingPcmData appendData:pcmData];
  [self.capturedPcmData appendData:pcmData];

  while (self.pendingPcmData.length >= self.chunkByteLength && self.chunkByteLength > 0) {
    NSData *chunk = [self.pendingPcmData subdataWithRange:NSMakeRange(0, self.chunkByteLength)];
    [chunksToEmit addObject:chunk];
    [self.pendingPcmData replaceBytesInRange:NSMakeRange(0, self.chunkByteLength) withBytes:NULL length:0];
    self.sequence += 1;
    self.chunksEmitted += 1;
    self.bytesEmitted += chunk.length;
  }

  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if ((now - self.lastStatsAt) >= 1.0) {
    statsPayload = @{
      @"elapsedMs": @((NSInteger)llround((now - self.startedAt) * 1000.0)),
      @"chunksEmitted": @(self.chunksEmitted),
      @"bytesEmitted": @(self.bytesEmitted),
      @"sampleRate": @(self.targetSampleRate),
      @"channels": @(self.targetChannels),
      @"chunkMs": @(self.chunkMs),
    };
    self.lastStatsAt = now;
  }
  os_unfair_lock_unlock(&_stateLock);

  BOOL shouldLogAfterPlaybackProbe =
    self.afterPlaybackProbeUntil > 0 &&
    CFAbsoluteTimeGetCurrent() <= self.afterPlaybackProbeUntil &&
    nativeBufferCount % 10 == 0;
  if (nativeBufferCount == 1 || nativeBufferCount % 25 == 0 || shouldLogAfterPlaybackProbe) {
    NSDictionary *signalPayload = [self signalPayloadForPCMData:pcmData];
    AVAudioSession *session = [AVAudioSession sharedInstance];
    NSDictionary *routePayload = [self currentAudioSessionRoutePayload];
    NSLog(@"[PcmCaptureModule] pcm_native_buffer_alive %@",
          @{
            @"bufferCount": @(nativeBufferCount),
            @"sampleRate": @(self.targetSampleRate),
            @"channelCount": @(self.targetChannels),
            @"frameLength": @(convertedBuffer.frameLength),
            @"rms": signalPayload[@"rms"] ?: @0,
            @"peak": signalPayload[@"peak"] ?: @0,
            @"zeroRatio": signalPayload[@"zeroRatio"] ?: @1,
            @"isCapturing": @(currentlyCapturing),
            @"engineRunning": @(self.audioEngine.isRunning),
            @"category": session.category ?: [NSNull null],
            @"mode": session.mode ?: [NSNull null],
            @"route": routePayload,
          });
    if (shouldLogAfterPlaybackProbe) {
      AVAudioInputNode *inputNode = self.audioEngine.inputNode;
      NSDictionary *probePayload = @{
        @"bufferCount": @(nativeBufferCount),
        @"sampleRate": @(self.targetSampleRate),
        @"channelCount": @(self.targetChannels),
        @"frameLength": @(convertedBuffer.frameLength),
        @"rms": signalPayload[@"rms"] ?: @0,
        @"peak": signalPayload[@"peak"] ?: @0,
        @"zeroRatio": signalPayload[@"zeroRatio"] ?: @1,
        @"isCapturing": @(currentlyCapturing),
        @"engineRunning": @(self.audioEngine.isRunning),
        @"inputNodeInputs": @(inputNode ? inputNode.numberOfInputs : 0),
        @"inputNodeOutputs": @(inputNode ? inputNode.numberOfOutputs : 0),
        @"category": session.category ?: [NSNull null],
        @"mode": session.mode ?: [NSNull null],
        @"route": routePayload,
        @"timestamp": @((NSInteger)llround(CFAbsoluteTimeGetCurrent() * 1000.0)),
      };
      NSLog(@"[PcmCaptureModule] pcm_native_after_playback_probe %@", probePayload);
      NSInteger rmsValue = [signalPayload[@"rms"] respondsToSelector:@selector(integerValue)] ? [signalPayload[@"rms"] integerValue] : 0;
      NSInteger peakValue = [signalPayload[@"peak"] respondsToSelector:@selector(integerValue)] ? [signalPayload[@"peak"] integerValue] : 0;
      if (rmsValue > 180 || peakValue > 1200) {
        NSLog(@"[PcmCaptureModule] pcm_native_high_level_detected %@", probePayload);
      }
    }
  }

  for (NSData *chunk in chunksToEmit) {
    [self emitChunkData:chunk];
  }

  if (statsPayload) {
    [self emitStats:statsPayload];
  }
}

- (void)emitChunkData:(NSData *)chunk
{
  if (!self.hasListeners || chunk.length == 0) {
    return;
  }

  NSUInteger sequence = 0;
  os_unfair_lock_lock(&_stateLock);
  sequence = self.sequence;
  os_unfair_lock_unlock(&_stateLock);

  NSString *base64 = [chunk base64EncodedStringWithOptions:0] ?: @"";
  NSDictionary *payload = @{
    @"sequence": @(sequence),
    @"sampleRate": @(self.targetSampleRate),
    @"channels": @(self.targetChannels),
    @"chunkMs": @(self.chunkMs),
    @"bytes": @(chunk.length),
    @"pcmBase64": base64,
  };
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"pcmChunk" body:payload];
  });
}

- (void)emitStats:(NSDictionary *)payload
{
  if (!self.hasListeners) {
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"captureStats" body:payload];
  });
}

- (NSDictionary *)currentAudioSessionRoutePayload
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionRouteDescription *route = session.currentRoute;

  NSMutableArray *outputs = [NSMutableArray array];
  for (AVAudioSessionPortDescription *port in route.outputs) {
    [outputs addObject:@{
      @"portType": port.portType ?: [NSNull null],
      @"portName": port.portName ?: [NSNull null],
      @"uid": port.UID ?: [NSNull null],
    }];
  }

  NSMutableArray *inputs = [NSMutableArray array];
  for (AVAudioSessionPortDescription *port in route.inputs) {
    [inputs addObject:@{
      @"portType": port.portType ?: [NSNull null],
      @"portName": port.portName ?: [NSNull null],
      @"uid": port.UID ?: [NSNull null],
    }];
  }

  return @{
    @"category": session.category ?: [NSNull null],
    @"mode": session.mode ?: [NSNull null],
    @"isOtherAudioPlaying": @(session.otherAudioPlaying),
    @"outputVolume": @(session.outputVolume),
    @"outputs": outputs,
    @"inputs": inputs,
  };
}

- (NSDictionary *)signalPayloadForPCMData:(NSData *)pcmData
{
  if (!pcmData || pcmData.length < 2) {
    return @{
      @"rms": @0,
      @"peak": @0,
      @"zeroRatio": @1,
    };
  }

  const int16_t *samples = (const int16_t *)pcmData.bytes;
  NSUInteger sampleCount = pcmData.length / sizeof(int16_t);
  if (sampleCount == 0) {
    return @{
      @"rms": @0,
      @"peak": @0,
      @"zeroRatio": @1,
    };
  }

  double sumSquares = 0;
  int16_t peak = 0;
  NSUInteger zeroCount = 0;
  for (NSUInteger index = 0; index < sampleCount; index += 1) {
    int16_t sample = samples[index];
    int16_t magnitude = (int16_t)abs(sample);
    sumSquares += (double)sample * (double)sample;
    if (magnitude > peak) {
      peak = magnitude;
    }
    if (sample == 0) {
      zeroCount += 1;
    }
  }

  double rms = sqrt(sumSquares / (double)sampleCount);
  double zeroRatio = (double)zeroCount / (double)sampleCount;
  return @{
    @"rms": @((NSInteger)llround(rms)),
    @"peak": @((NSInteger)peak),
    @"zeroRatio": @(((double)llround(zeroRatio * 1000.0)) / 1000.0),
  };
}

@end
