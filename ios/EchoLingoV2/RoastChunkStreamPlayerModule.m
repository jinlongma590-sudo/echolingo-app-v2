#import "RoastChunkStreamPlayerModule.h"

#import <AudioToolbox/AudioToolbox.h>
#import <AVFoundation/AVFoundation.h>
#import <React/RCTLog.h>
#import <UIKit/UIKit.h>
#import <WebRTC/RTCAudioSession.h>

static const NSTimeInterval kRoastChunkProgressIntervalSeconds = 0.4;
static const long long kRoastChunkStartMinBuffers = 2;
static const long long kRoastChunkStartMinBytes = 24 * 1024;
static const long long kRoastIpadVpioTailGuardMs = 1500;
static const long long kRoastIpadPlaybackSettleDefaultMs = 200;

@interface RoastChunkStreamPlayerModule () <NSURLSessionDataDelegate>
@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, strong) NSURLSessionDataTask *task;
@property (nonatomic, assign) AudioFileStreamID audioFileStream;
@property (nonatomic, assign) AudioQueueRef audioQueue;
@property (nonatomic, assign) AudioStreamBasicDescription audioFormat;
@property (nonatomic, assign) BOOL audioFormatReady;
@property (nonatomic, assign) BOOL playbackStarted;
@property (nonatomic, assign) BOOL streamEnded;
@property (nonatomic, assign) BOOL stopped;
@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, assign) long long bytesReceived;
@property (nonatomic, assign) long long packetsQueued;
@property (nonatomic, assign) long long buffersQueued;
@property (nonatomic, assign) long long buffersInFlight;
@property (nonatomic, assign) long long bytesQueuedBeforeStart;
@property (nonatomic, assign) long long firstBufferByteSize;
@property (nonatomic, assign) long long firstPacketCount;
@property (nonatomic, assign) OSStatus lastAudioQueuePrimeResult;
@property (nonatomic, assign) OSStatus lastAudioQueueStartResult;
@property (nonatomic, assign) OSStatus lastAudioQueueVolumeSetResult;
@property (nonatomic, assign) Float32 audioQueueVolume;
@property (nonatomic, copy) NSString *lastAudioSessionError;
@property (nonatomic, assign) long long lastAudioSessionSetupMs;
@property (nonatomic, assign) long long lastAudioQueuePrimeMs;
@property (nonatomic, assign) CFTimeInterval requestStartAt;
@property (nonatomic, assign) CFTimeInterval firstNetworkChunkAt;
@property (nonatomic, assign) CFTimeInterval firstPacketParsedAt;
@property (nonatomic, assign) CFTimeInterval audioQueueStartAttemptAt;
@property (nonatomic, assign) CFTimeInterval audioQueueStartedAt;
@property (nonatomic, assign) CFTimeInterval playbackEndedAt;
@property (nonatomic, assign) CFTimeInterval streamEndedAt;
@property (nonatomic, assign) CFTimeInterval lastProgressEventAt;
@property (nonatomic, copy) NSString *status;
@property (nonatomic, copy) NSString *lastError;
@property (nonatomic, copy) NSString *requestId;
@property (nonatomic, copy) NSString *turnId;
@property (nonatomic, assign) BOOL forceAudioSessionModeDefault;
@property (nonatomic, assign) BOOL audioSessionConfiguredForCurrentRequest;
@property (nonatomic, assign) BOOL vpioPausedForCurrentRequest;
@property (nonatomic, assign) NSInteger audioSessionRetryCount;
@property (nonatomic, assign) BOOL audioSessionRetryScheduled;
@property (nonatomic, assign) BOOL playbackSettleScheduled;
@property (nonatomic, assign) BOOL playbackSettleCompleted;
@property (nonatomic, assign) long long playbackSettleDelayMs;
@property (nonatomic, assign) NSInteger playbackSettleToken;
@property (nonatomic, assign) BOOL startGateBlockedLogged;
@property (nonatomic, assign) BOOL startGateFirstAllowLogged;
@property (nonatomic, assign) BOOL startGateFinalStartLogged;
@property (nonatomic, assign) BOOL firstPacketProbeLogged;
@property (nonatomic, assign) NSInteger tailGuardToken;
@property (nonatomic, assign) BOOL tailGuardPending;
@property (nonatomic, copy) NSString *tailGuardRequestId;
@property (nonatomic, copy) NSString *tailGuardTurnId;
@property (nonatomic, strong) NSDictionary *ttsSessionExperimentContext;
@property (nonatomic, copy) RCTPromiseResolveBlock pendingResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock pendingReject;
@property (nonatomic, strong) dispatch_queue_t workQueue;
@end

static void RoastAudioFileStreamPropertyListener(void *inClientData,
                                                 AudioFileStreamID inAudioFileStream,
                                                 AudioFileStreamPropertyID inPropertyID,
                                                 UInt32 *ioFlags);
static void RoastAudioFileStreamPacketsListener(void *inClientData,
                                                UInt32 inNumberBytes,
                                                UInt32 inNumberPackets,
                                                const void *inInputData,
                                                AudioStreamPacketDescription *inPacketDescriptions);
static void RoastAudioQueueOutputCallback(void *inUserData, AudioQueueRef inAQ, AudioQueueBufferRef inBuffer);

@implementation RoastChunkStreamPlayerModule

RCT_EXPORT_MODULE(RoastChunkStreamPlayer)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _status = @"idle";
    _workQueue = dispatch_queue_create("cn.echolingo.roast.chunk-stream-player", DISPATCH_QUEUE_SERIAL);
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleAppDidEnterBackground)
                                                 name:UIApplicationDidEnterBackgroundNotification
                                               object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [self stopInternal];
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[
    @"roastChunkStream:requestStart",
    @"roastChunkStream:firstNetworkChunk",
    @"roastChunkStream:firstPacketParsed",
    @"roastChunkStream:audioQueueStarted",
    @"roastChunkStream:progress",
    @"roastChunkStream:streamEnd",
    @"roastChunkStream:playbackEnded",
    @"roastChunkStream:stopped",
    @"roastChunkStream:error"
  ];
}

- (void)startObserving
{
  self.hasListeners = YES;
}

- (void)stopObserving
{
  self.hasListeners = NO;
}

- (void)handleAppDidEnterBackground
{
  dispatch_async(self.workQueue, ^{
    if (![self.status isEqualToString:@"idle"] && ![self.status isEqualToString:@"stopped"]) {
      [self stopInternalKeepingStatus:NO emitStopped:YES];
    }
  });
}

RCT_EXPORT_METHOD(playStream:(NSString *)urlString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self startStreamWithUrlString:urlString options:@{} resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(playStreamWithOptions:(NSString *)urlString
                  options:(NSDictionary *)rawOptions
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *options = [rawOptions isKindOfClass:NSDictionary.class] ? rawOptions : @{};
  [self startStreamWithUrlString:urlString options:options resolver:resolve rejecter:reject];
}

- (void)startStreamWithUrlString:(NSString *)urlString
                         options:(NSDictionary *)rawOptions
                        resolver:(RCTPromiseResolveBlock)resolve
                        rejecter:(RCTPromiseRejectBlock)reject
{
  NSURL *url = [NSURL URLWithString:urlString ?: @""];
  if (!url || !url.scheme || !url.host) {
    reject(@"invalid_url", @"Invalid stream URL.", nil);
    return;
  }
  NSDictionary *options = [rawOptions isKindOfClass:NSDictionary.class] ? rawOptions : @{};

  dispatch_async(self.workQueue, ^{
    [self stopInternalKeepingStatus:NO emitStopped:YES];

    self.pendingResolve = resolve;
    self.pendingReject = reject;
    self.status = @"loading";
    self.lastError = nil;
    self.requestId = [NSUUID UUID].UUIDString;
    self.turnId = [options[@"turnId"] isKindOfClass:NSString.class] ? options[@"turnId"] : @"";
    id forceModeValue = options[@"forceAudioSessionModeDefault"];
    self.forceAudioSessionModeDefault = [forceModeValue respondsToSelector:@selector(boolValue)] ? [forceModeValue boolValue] : NO;
    id playbackSettleDelayValue = options[@"playbackSettleDelayMs"];
    self.playbackSettleDelayMs = [playbackSettleDelayValue respondsToSelector:@selector(longLongValue)]
      ? MAX(0, [playbackSettleDelayValue longLongValue])
      : kRoastIpadPlaybackSettleDefaultMs;
    self.audioSessionConfiguredForCurrentRequest = NO;
    self.audioSessionRetryCount = 0;
    self.audioSessionRetryScheduled = NO;
    self.playbackSettleScheduled = NO;
    self.playbackSettleCompleted = NO;
    self.startGateBlockedLogged = NO;
    self.startGateFirstAllowLogged = NO;
    self.startGateFinalStartLogged = NO;
    self.firstPacketProbeLogged = NO;
    self.vpioPausedForCurrentRequest = NO;
    self.ttsSessionExperimentContext = @{
      @"requestId": self.requestId ?: @"",
      @"turnId": self.turnId ?: @"",
      @"forceAudioSessionModeDefault": @(self.forceAudioSessionModeDefault),
      @"playbackSettleDelayMs": @(self.playbackSettleDelayMs),
      @"isMicMuted": options[@"isMicMuted"] ?: [NSNull null],
      @"localAudioTrackEnabled": options[@"localAudioTrackEnabled"] ?: [NSNull null],
    };
    self.stopped = NO;
    self.playbackStarted = NO;
    self.audioFormatReady = NO;
    self.streamEnded = NO;
    self.bytesReceived = 0;
    self.packetsQueued = 0;
    self.buffersQueued = 0;
    self.buffersInFlight = 0;
    self.bytesQueuedBeforeStart = 0;
    self.firstBufferByteSize = 0;
    self.firstPacketCount = 0;
    self.lastAudioQueuePrimeResult = 0;
    self.lastAudioQueueStartResult = 0;
    self.lastAudioQueueVolumeSetResult = 0;
    self.audioQueueVolume = 1.0;
    self.lastAudioSessionError = nil;
    self.lastAudioSessionSetupMs = 0;
    self.lastAudioQueuePrimeMs = 0;
    self.requestStartAt = CACurrentMediaTime();
    self.firstNetworkChunkAt = 0;
    self.firstPacketParsedAt = 0;
    self.audioQueueStartAttemptAt = 0;
    self.audioQueueStartedAt = 0;
    self.playbackEndedAt = 0;
    self.streamEndedAt = 0;
    self.lastProgressEventAt = 0;
    if (self.forceAudioSessionModeDefault) {
      RCTLogInfo(@"[ROAST_IOS_IPAD_TTS_SESSION_EXPERIMENT] %@", [self ttsSessionExperimentPayloadForPhase:@"playback_config_requested" context:self.ttsSessionExperimentContext errorText:nil]);
    }
    [self emitEvent:@"roastChunkStream:requestStart"];

    [self logAudioSessionCompareForPhase:@"before_config"];
    [self applyAudioSessionForTtsPlayback];

    OSStatus openStatus = AudioFileStreamOpen((__bridge void *)self,
                                              RoastAudioFileStreamPropertyListener,
                                              RoastAudioFileStreamPacketsListener,
                                              kAudioFileMP3Type,
                                              &_audioFileStream);
    if (openStatus != noErr) {
      [self failWithCode:@"audio_file_stream_open_failed"
                 message:[NSString stringWithFormat:@"AudioFileStreamOpen failed: %d", (int)openStatus]];
      return;
    }

    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.timeoutIntervalForRequest = 15;
    configuration.timeoutIntervalForResource = 30;
    self.session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"GET";
    [request setValue:@"audio/mpeg" forHTTPHeaderField:@"Accept"];
    self.task = [self.session dataTaskWithRequest:request];
    RCTLogInfo(@"[RoastChunkStreamPlayer] playStream called scheme=%@ host=%@ path=%@", url.scheme, url.host, url.path);
    [self.task resume];
  });
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.workQueue, ^{
    [self stopInternalKeepingStatus:NO emitStopped:YES];
    self.status = @"stopped";
    resolve([self stateDictionary]);
  });
}

RCT_EXPORT_METHOD(getState:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.workQueue, ^{
    resolve([self stateDictionary]);
  });
}

RCT_EXPORT_METHOD(restoreIpadTtsSessionExperiment:(NSDictionary *)context
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.workQueue, ^{
    resolve([self restoreIpadTtsSessionExperimentInternal:context ?: @{}]);
  });
}

RCT_EXPORT_METHOD(setManualAudioEnabled:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!enabled) {
    dispatch_sync(self.workQueue, ^{
      [self cancelTailGuardForReason:@"unmount"];
      [self resumeWebRtcVpioAfterPlaybackIfNeeded];
    });
  }
  RTCAudioSession *rtcSession = [RTCAudioSession sharedInstance];
  BOOL prevManualAudio = rtcSession.useManualAudio;
  BOOL prevAudioEnabled = rtcSession.isAudioEnabled;
  if (enabled) {
    rtcSession.useManualAudio = YES;
    rtcSession.isAudioEnabled = YES;
  } else {
    rtcSession.isAudioEnabled = YES;
    rtcSession.useManualAudio = NO;
  }
  RCTLogInfo(@"[ROAST_VPIO_TOGGLE] action=set_manual_audio enabled=%d prevManualAudio=%d prevAudioEnabled=%d nowManualAudio=%d nowAudioEnabled=%d",
             (int)enabled, (int)prevManualAudio, (int)prevAudioEnabled,
             (int)rtcSession.useManualAudio, (int)rtcSession.isAudioEnabled);
  resolve(@{
    @"useManualAudio": @(rtcSession.useManualAudio),
    @"isAudioEnabled": @(rtcSession.isAudioEnabled),
    @"prevUseManualAudio": @(prevManualAudio),
    @"prevIsAudioEnabled": @(prevAudioEnabled),
  });
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition disposition))completionHandler
{
  NSHTTPURLResponse *httpResponse = [response isKindOfClass:NSHTTPURLResponse.class] ? (NSHTTPURLResponse *)response : nil;
  NSInteger statusCode = httpResponse ? httpResponse.statusCode : 200;
  if (httpResponse && (statusCode < 200 || statusCode >= 300)) {
    dispatch_async(self.workQueue, ^{
      if (dataTask != self.task || self.stopped) return;
      [self failWithCode:@"stream_http_failed"
                 message:[NSString stringWithFormat:@"Stream request failed with HTTP %ld.", (long)statusCode]];
    });
    completionHandler(NSURLSessionResponseCancel);
    return;
  }

  NSString *mimeType = response.MIMEType.lowercaseString ?: @"";
  if (mimeType.length > 0 && ![mimeType containsString:@"audio"] && ![mimeType containsString:@"mpeg"]) {
    dispatch_async(self.workQueue, ^{
      if (dataTask != self.task || self.stopped) return;
      [self failWithCode:@"stream_unsupported_mime"
                 message:[NSString stringWithFormat:@"Unsupported stream MIME type: %@.", mimeType]];
    });
    completionHandler(NSURLSessionResponseCancel);
    return;
  }

  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data
{
  dispatch_async(self.workQueue, ^{
    if (dataTask != self.task) return;
    if (self.stopped) return;
    if (self.firstNetworkChunkAt <= 0) {
      self.firstNetworkChunkAt = CACurrentMediaTime();
      RCTLogInfo(@"[RoastChunkStreamPlayer] first_network_chunk elapsedMs=%lld bytes=%lu",
                 [self elapsedMs:self.firstNetworkChunkAt],
                 (unsigned long)data.length);
      [self emitEvent:@"roastChunkStream:firstNetworkChunk"];
    }
    self.bytesReceived += data.length;
    [self emitProgressIfNeeded];
    if (!self.audioFileStream) return;
    OSStatus parseStatus = AudioFileStreamParseBytes(self.audioFileStream,
                                                     (UInt32)data.length,
                                                     data.bytes,
                                                     0);
    if (parseStatus != noErr) {
      [self failWithCode:@"audio_file_stream_parse_failed"
                 message:[NSString stringWithFormat:@"AudioFileStreamParseBytes failed: %d", (int)parseStatus]];
    }
  });
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error
{
  dispatch_async(self.workQueue, ^{
    if (task != self.task && self.task != nil) return;
    if (self.stopped) return;
    if (error) {
      [self failWithCode:@"stream_request_failed" message:error.localizedDescription];
      return;
    }
    self.streamEnded = YES;
    self.streamEndedAt = CACurrentMediaTime();
    BOOL hasQueuedParsedAudio = !self.playbackStarted
      && self.firstPacketParsedAt > 0
      && (self.packetsQueued > 0 || self.buffersQueued > 0);
    self.status = self.playbackStarted || hasQueuedParsedAudio ? @"streamEnded" : @"endedWithoutPlayback";
    RCTLogInfo(@"[RoastChunkStreamPlayer] stream_end elapsedMs=%lld bytesReceived=%lld packetsQueued=%lld playbackStarted=%d",
               [self elapsedMs:CACurrentMediaTime()],
               self.bytesReceived,
               self.packetsQueued,
               self.playbackStarted);
    [self logAudioDiagEvent:@"stream_end" extra:@{
      @"streamEndMs": @([self elapsedMs:CACurrentMediaTime()]),
    }];
    [self emitEvent:@"roastChunkStream:streamEnd"];
    if (!self.playbackStarted && hasQueuedParsedAudio) {
      [self logAudioDiagEvent:@"stream_end_force_start_with_queued_packets" extra:@{
        @"packetsQueued": @(self.packetsQueued),
        @"buffersQueued": @(self.buffersQueued),
        @"bytesBeforeStart": @(self.bytesQueuedBeforeStart),
        @"firstPacketParsedMs": @([self elapsedMs:self.firstPacketParsedAt]),
        @"streamEndMs": @([self elapsedMs:self.streamEndedAt]),
      }];
      if (self.playbackSettleScheduled && !self.playbackSettleCompleted) {
        [self cancelPlaybackSettleForReason:@"stream_end_with_queued_packets"];
      }
      self.playbackSettleCompleted = YES;
      [self tryStartAudioQueueForReason:@"stream_end_with_queued_packets" force:YES];
      if (!self.playbackStarted) {
        [self finishPlaybackIfDrained];
        return;
      }
    }
    if (self.pendingReject && !self.playbackStarted) {
      [self tryStartAudioQueueForReason:@"stream_end" force:YES];
      if (!self.playbackStarted) {
        [self failWithCode:@"stream_ended_without_playback" message:@"Stream ended before AudioQueue started."];
        return;
      }
    }
    [self finishPlaybackIfDrained];
  });
}

- (void)handleProperty:(AudioFileStreamPropertyID)propertyID flags:(UInt32 *)flags
{
  if (propertyID == kAudioFileStreamProperty_DataFormat) {
    UInt32 size = sizeof(self.audioFormat);
    OSStatus status = AudioFileStreamGetProperty(self.audioFileStream,
                                                 kAudioFileStreamProperty_DataFormat,
                                                 &size,
                                                 &_audioFormat);
    if (status != noErr) {
      [self failWithCode:@"audio_format_read_failed"
                 message:[NSString stringWithFormat:@"AudioFileStreamGetProperty(DataFormat) failed: %d", (int)status]];
      return;
    }

    OSStatus queueStatus = AudioQueueNewOutput(&_audioFormat,
                                               RoastAudioQueueOutputCallback,
                                               (__bridge void *)self,
                                               NULL,
                                               NULL,
                                               0,
                                               &_audioQueue);
    if (queueStatus != noErr) {
      [self failWithCode:@"audio_queue_create_failed"
                 message:[NSString stringWithFormat:@"AudioQueueNewOutput failed: %d", (int)queueStatus]];
      return;
    }
    self.audioQueueVolume = 1.0;
    self.lastAudioQueueVolumeSetResult = AudioQueueSetParameter(self.audioQueue, kAudioQueueParam_Volume, self.audioQueueVolume);
    Float32 currentVolume = 0;
    OSStatus readVolumeStatus = AudioQueueGetParameter(self.audioQueue, kAudioQueueParam_Volume, &currentVolume);
    if (readVolumeStatus == noErr) {
      self.audioQueueVolume = currentVolume;
    }
    self.audioFormatReady = YES;
    self.status = @"formatReady";
    RCTLogInfo(@"[RoastChunkStreamPlayer] format_ready sampleRate=%.0f channels=%u formatId=%u",
               self.audioFormat.mSampleRate,
               (unsigned int)self.audioFormat.mChannelsPerFrame,
               (unsigned int)self.audioFormat.mFormatID);
    [self logAudioDiagEvent:@"audio_queue_created" extra:@{
      @"audioQueueVolumeSetResult": @((int)self.lastAudioQueueVolumeSetResult),
      @"audioQueueVolumeReadResult": @((int)readVolumeStatus),
      @"audioQueueVolume": @(self.audioQueueVolume),
      @"sampleRate": @(self.audioFormat.mSampleRate),
      @"channels": @((unsigned int)self.audioFormat.mChannelsPerFrame),
      @"formatId": @((unsigned int)self.audioFormat.mFormatID),
    }];
    [self applyMagicCookieIfAvailable];
  } else if (propertyID == kAudioFileStreamProperty_ReadyToProducePackets) {
    self.status = @"readyToProducePackets";
    RCTLogInfo(@"[RoastChunkStreamPlayer] ready_to_produce_packets elapsedMs=%lld", [self elapsedMs:CACurrentMediaTime()]);
  }
}

- (void)handlePacketsWithBytes:(UInt32)numberBytes
                       packets:(UInt32)numberPackets
                          data:(const void *)inputData
            packetDescriptions:(AudioStreamPacketDescription *)packetDescriptions
{
  if (!self.audioQueue || !self.audioFormatReady || numberBytes == 0 || numberPackets == 0) return;

  if (self.firstPacketParsedAt <= 0) {
    self.firstPacketParsedAt = CACurrentMediaTime();
    RCTLogInfo(@"[RoastChunkStreamPlayer] first_packet_parsed elapsedMs=%lld packets=%u bytes=%u",
               [self elapsedMs:self.firstPacketParsedAt],
               (unsigned int)numberPackets,
               (unsigned int)numberBytes);
    [self emitEvent:@"roastChunkStream:firstPacketParsed"];
  }

  AudioQueueBufferRef buffer = NULL;
  OSStatus allocStatus = packetDescriptions
    ? AudioQueueAllocateBufferWithPacketDescriptions(self.audioQueue,
                                                     MAX(numberBytes, 1),
                                                     numberPackets,
                                                     &buffer)
    : AudioQueueAllocateBuffer(self.audioQueue, MAX(numberBytes, 1), &buffer);
  if (allocStatus != noErr || !buffer) {
    [self failWithCode:@"audio_queue_buffer_alloc_failed"
               message:[NSString stringWithFormat:@"AudioQueueAllocateBuffer failed: %d", (int)allocStatus]];
    return;
  }

  memcpy(buffer->mAudioData, inputData, numberBytes);
  buffer->mAudioDataByteSize = numberBytes;

  if (packetDescriptions) {
    if (!buffer->mPacketDescriptions || buffer->mPacketDescriptionCapacity < numberPackets) {
      AudioQueueFreeBuffer(self.audioQueue, buffer);
      [self failWithCode:@"packet_description_alloc_failed" message:@"AudioQueueBuffer did not allocate enough packet description storage."];
      return;
    }
    for (UInt32 index = 0; index < numberPackets; index++) {
      buffer->mPacketDescriptions[index] = packetDescriptions[index];
    }
    buffer->mPacketDescriptionCount = numberPackets;
  }

  OSStatus enqueueStatus = AudioQueueEnqueueBuffer(self.audioQueue,
                                                   buffer,
                                                   packetDescriptions ? numberPackets : 0,
                                                   packetDescriptions ? buffer->mPacketDescriptions : NULL);
  if (enqueueStatus != noErr) {
    AudioQueueFreeBuffer(self.audioQueue, buffer);
    [self failWithCode:@"audio_queue_enqueue_failed"
               message:[NSString stringWithFormat:@"AudioQueueEnqueueBuffer failed: %d", (int)enqueueStatus]];
    return;
  }

  self.packetsQueued += numberPackets;
  self.buffersQueued += 1;
  self.buffersInFlight += 1;
  if (!self.playbackStarted) {
    self.bytesQueuedBeforeStart += numberBytes;
    if (self.firstBufferByteSize <= 0) {
      self.firstBufferByteSize = numberBytes;
      self.firstPacketCount = numberPackets;
    }
  }
  [self emitProgressIfNeeded];
  [self tryStartAudioQueueForReason:@"buffer_threshold" force:NO];
}

- (BOOL)shouldStartAudioQueueWithForce:(BOOL)force
{
  if (self.playbackStarted || !self.audioQueue || !self.audioFormatReady) return NO;
  if (force) return self.buffersQueued > 0;
  if (self.forceAudioSessionModeDefault && [self isTabletIdiom] && self.playbackSettleDelayMs <= 50) {
    return self.buffersQueued >= 1;
  }
  return self.buffersQueued >= kRoastChunkStartMinBuffers || self.bytesQueuedBeforeStart >= kRoastChunkStartMinBytes;
}

- (void)pauseWebRtcVpioForPlaybackIfNeeded
{
  if (!self.forceAudioSessionModeDefault || self.vpioPausedForCurrentRequest) return;
  RTCAudioSession *rtcSession = [RTCAudioSession sharedInstance];
  BOOL manualAudio = rtcSession.useManualAudio;
  BOOL wasEnabled = rtcSession.isAudioEnabled;
  CFTimeInterval startedAt = CACurrentMediaTime();
  if (manualAudio && wasEnabled) {
    rtcSession.isAudioEnabled = NO;
    self.vpioPausedForCurrentRequest = YES;
  }
  long long elapsedMicros = llround((CACurrentMediaTime() - startedAt) * 1000000.0);
  RCTLogInfo(@"[ROAST_VPIO_TOGGLE] action=disable manualAudio=%d wasEnabled=%d paused=%d elapsedMicros=%lld",
             (int)manualAudio, (int)wasEnabled, (int)self.vpioPausedForCurrentRequest, elapsedMicros);
  [self logIpadOutputVolumeProbeForPhase:@"after_vpio_pause"];
}

- (void)resumeWebRtcVpioAfterPlaybackIfNeeded
{
  if (!self.vpioPausedForCurrentRequest) return;
  RTCAudioSession *rtcSession = [RTCAudioSession sharedInstance];
  BOOL manualAudio = rtcSession.useManualAudio;
  CFTimeInterval startedAt = CACurrentMediaTime();
  if (manualAudio) {
    rtcSession.isAudioEnabled = YES;
  }
  self.vpioPausedForCurrentRequest = NO;
  long long elapsedMicros = llround((CACurrentMediaTime() - startedAt) * 1000000.0);
  RCTLogInfo(@"[ROAST_VPIO_TOGGLE] action=enable manualAudio=%d elapsedMicros=%lld",
             (int)manualAudio, elapsedMicros);
}

- (void)tryStartAudioQueueForReason:(NSString *)reason force:(BOOL)force
{
  if (self.forceAudioSessionModeDefault && !self.audioSessionConfiguredForCurrentRequest) {
    [self applyAudioSessionForTtsPlayback];
  }
  if (self.forceAudioSessionModeDefault && !self.audioSessionConfiguredForCurrentRequest) {
    if (!self.startGateBlockedLogged) {
      self.startGateBlockedLogged = YES;
      [self logIpadTtsStartGateAllow:NO categoryOk:NO phase:@"blocked_waiting_audio_session"];
    }
    return;
  }
  if (![self shouldStartAudioQueueWithForce:force]) return;

  [self pauseWebRtcVpioForPlaybackIfNeeded];
  BOOL gateCategoryOk = !self.forceAudioSessionModeDefault || self.audioSessionConfiguredForCurrentRequest;
  BOOL willAttemptStartNow = !self.isPlaybackSettleEligible || self.playbackSettleCompleted;
  if (!self.startGateFirstAllowLogged) {
    self.startGateFirstAllowLogged = YES;
    [self logIpadTtsStartGateAllow:YES categoryOk:gateCategoryOk phase:@"first_allow"];
    [self logIpadOutputVolumeProbeForPhase:@"start_gate_first_allow"];
  } else if (willAttemptStartNow && !self.startGateFinalStartLogged) {
    self.startGateFinalStartLogged = YES;
    [self logIpadTtsStartGateAllow:YES categoryOk:gateCategoryOk phase:@"final_before_audio_queue_start"];
    [self logIpadOutputVolumeProbeForPhase:@"start_gate_final_before_audio_queue_start"];
  }

  if ([self schedulePlaybackSettleIfNeeded]) {
    return;
  }

  UInt32 primeFrames = 0;
  self.audioQueueStartAttemptAt = CACurrentMediaTime();
  [self applyAudioSessionForTtsPlayback];
  [self ensureSpeakerRouteBeforeAudioQueueStart];
  [self logAudioSessionCompareForPhase:@"before_audio_queue_start"];
  CFTimeInterval primeStartAt = CACurrentMediaTime();
  self.lastAudioQueuePrimeResult = AudioQueuePrime(self.audioQueue, 0, &primeFrames);
  self.lastAudioQueuePrimeMs = llround((CACurrentMediaTime() - primeStartAt) * 1000.0);
  self.lastAudioQueueStartResult = AudioQueueStart(self.audioQueue, NULL);
  [self ensureSpeakerRouteForEvent:@"speaker_route_checked_after_start"];
  [self logAudioSessionCompareForPhase:@"after_audio_queue_start"];
  [self logAudioDiagEvent:@"audio_queue_start_attempt" extra:@{
    @"reason": reason ?: @"unknown",
    @"force": @(force),
    @"packetsBeforeStart": @(self.packetsQueued),
    @"buffersBeforeStart": @(self.buffersQueued),
    @"bytesBeforeStart": @(self.bytesQueuedBeforeStart),
    @"firstBufferByteSize": @(self.firstBufferByteSize),
    @"firstPacketCount": @(self.firstPacketCount),
    @"audioQueuePrimeResult": @((int)self.lastAudioQueuePrimeResult),
    @"audioQueuePrimeMs": @(self.lastAudioQueuePrimeMs),
    @"audioQueuePrimeFrames": @(primeFrames),
    @"audioQueueStartResult": @((int)self.lastAudioQueueStartResult),
    @"audioQueueVolume": @(self.audioQueueVolume),
    @"playbackSettleDelayMs": @(self.playbackSettleDelayMs),
  }];
  if (self.lastAudioQueueStartResult != noErr) {
    [self failWithCode:@"audio_queue_start_failed"
               message:[NSString stringWithFormat:@"AudioQueueStart failed: %d", (int)self.lastAudioQueueStartResult]];
    return;
  }

  self.playbackStarted = YES;
  self.audioQueueStartedAt = CACurrentMediaTime();
  self.status = @"playing";
  RCTLogInfo(@"[RoastChunkStreamPlayer] audio_queue_started elapsedMs=%lld audioQueueStartedMs=%lld playbackSettleDelayMs=%lld bytesReceived=%lld packetsQueued=%lld buffersQueued=%lld bytesBeforeStart=%lld primeResult=%d startResult=%d",
             [self elapsedMs:self.audioQueueStartedAt],
             [self elapsedMs:self.audioQueueStartedAt],
             self.playbackSettleDelayMs,
             self.bytesReceived,
             self.packetsQueued,
             self.buffersQueued,
             self.bytesQueuedBeforeStart,
             (int)self.lastAudioQueuePrimeResult,
             (int)self.lastAudioQueueStartResult);
  [self emitEvent:@"roastChunkStream:audioQueueStarted"];
  [self resolveStartedIfNeeded];

  if (self.forceAudioSessionModeDefault) {
    NSInteger settleToken = self.playbackSettleToken;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)300 * NSEC_PER_MSEC), self.workQueue, ^{
      __strong typeof(weakSelf) strongSelf = weakSelf;
      if (!strongSelf) return;
      if (strongSelf.stopped) return;
      if (strongSelf.playbackSettleToken != settleToken) return;
      [strongSelf logIpadOutputVolumeProbeForPhase:@"audio_queue_started_plus_300ms"];
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)700 * NSEC_PER_MSEC), self.workQueue, ^{
      __strong typeof(weakSelf) strongSelf = weakSelf;
      if (!strongSelf) return;
      if (strongSelf.stopped) return;
      if (strongSelf.playbackSettleToken != settleToken) return;
      [strongSelf logIpadOutputVolumeProbeForPhase:@"audio_queue_started_plus_700ms"];
    });
  }
}

- (void)applyAudioSessionForTtsPlayback
{
  if (self.forceAudioSessionModeDefault && self.audioSessionConfiguredForCurrentRequest) {
    [self ensureSpeakerRouteForEvent:@"speaker_route_checked_after_default_mode_config"];
    return;
  }
  if (self.forceAudioSessionModeDefault) {
    // Pause WebRTC VPIO BEFORE attempting setCategory so RTCAudioSession won't
    // race the AVAudioSession back to PlayAndRecord while we switch.
    [self pauseWebRtcVpioForPlaybackIfNeeded];
  }
  [self configureRecordSessionForSpeakerPlaybackWithEvent:@"audio_session_configured"];
  if (self.forceAudioSessionModeDefault && !self.audioSessionConfiguredForCurrentRequest) {
    [self scheduleAudioSessionConfigRetryIfNeeded];
  }
}

- (void)scheduleAudioSessionConfigRetryIfNeeded
{
  if (!self.forceAudioSessionModeDefault) return;
  if (self.audioSessionConfiguredForCurrentRequest) return;
  if (self.audioSessionRetryScheduled) return;
  if (self.audioSessionRetryCount >= 2) {
    RCTLogWarn(@"[ROAST_IPAD_TTS_CONFIG_RETRY] exhausted attempts=%ld", (long)self.audioSessionRetryCount);
    return;
  }
  self.audioSessionRetryCount += 1;
  NSInteger attempt = self.audioSessionRetryCount;
  self.audioSessionRetryScheduled = YES;
  RCTLogInfo(@"[ROAST_IPAD_TTS_CONFIG_RETRY] schedule attempt=%ld delayMs=100 requestId=%@",
             (long)attempt, self.requestId ?: @"");
  __weak typeof(self) weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)100 * NSEC_PER_MSEC), self.workQueue, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) return;
    strongSelf.audioSessionRetryScheduled = NO;
    if (strongSelf.stopped) return;
    if (!strongSelf.forceAudioSessionModeDefault) return;
    if (strongSelf.audioSessionConfiguredForCurrentRequest) return;
    RCTLogInfo(@"[ROAST_IPAD_TTS_CONFIG_RETRY] fire attempt=%ld requestId=%@",
               (long)attempt, strongSelf.requestId ?: @"");
    [strongSelf applyAudioSessionForTtsPlayback];
    if (strongSelf.audioSessionConfiguredForCurrentRequest && !strongSelf.playbackStarted) {
      [strongSelf tryStartAudioQueueForReason:@"config_retry_success" force:NO];
    }
  });
}

- (void)logIpadTtsStartGateAllow:(BOOL)allow categoryOk:(BOOL)categoryOk phase:(NSString *)phase
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  long long audioQueueStartedMs = self.audioQueueStartedAt > 0 ? [self elapsedMs:self.audioQueueStartedAt] : -1;
  RCTLogInfo(@"[ROAST_IPAD_TTS_START_GATE] phase=%@ requestId=%@ turnId=%@ forceAudioSessionModeDefault=%d category=%@ mode=%@ vpioPaused=%d categoryOk=%d allowStart=%d playbackSettleDelayMs=%lld audioQueueStartedMs=%lld",
             phase ?: @"unknown",
             self.requestId ?: @"",
             self.turnId ?: @"",
             (int)self.forceAudioSessionModeDefault,
             session.category ?: @"",
             session.mode ?: @"",
             (int)self.vpioPausedForCurrentRequest,
             (int)categoryOk,
             (int)allow,
             self.playbackSettleDelayMs,
             audioQueueStartedMs);
}

- (BOOL)isTabletIdiom
{
  return UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad;
}

- (void)logIpadOutputVolumeProbeForPhase:(NSString *)phase
{
  if (!self.forceAudioSessionModeDefault) return;
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionPortDescription *firstOutput = session.currentRoute.outputs.firstObject;
  RCTLogInfo(@"[ROAST_IPAD_TTS_OUTPUT_VOLUME_PROBE] phase=%@ requestId=%@ turnId=%@ category=%@ mode=%@ outputVolume=%.3f outputPortType=%@ vpioPaused=%d",
             phase ?: @"unknown",
             self.requestId ?: @"",
             self.turnId ?: @"",
             session.category ?: @"",
             session.mode ?: @"",
             session.outputVolume,
             firstOutput.portType ?: @"",
             (int)self.vpioPausedForCurrentRequest);
}

- (BOOL)isPlaybackSettleEligible
{
  return self.forceAudioSessionModeDefault
    && [self isTabletIdiom]
    && self.audioSessionConfiguredForCurrentRequest
    && self.vpioPausedForCurrentRequest;
}

- (void)cancelPlaybackSettleForReason:(NSString *)reason
{
  if (!self.playbackSettleScheduled) return;
  self.playbackSettleToken += 1;
  self.playbackSettleScheduled = NO;
  RCTLogInfo(@"[ROAST_IPAD_TTS_PLAYBACK_SETTLE] action=cancel reason=%@ requestId=%@ turnId=%@",
             reason ?: @"unknown",
             self.requestId ?: @"",
             self.turnId ?: @"");
}

- (BOOL)schedulePlaybackSettleIfNeeded
{
  if (!self.isPlaybackSettleEligible) return NO;
  if (self.playbackSettleCompleted) return NO;
  if (self.playbackSettleScheduled) return YES;

  self.playbackSettleToken += 1;
  NSInteger token = self.playbackSettleToken;
  self.playbackSettleScheduled = YES;
  long long playbackSettleDelayMs = self.playbackSettleDelayMs > 0
    ? self.playbackSettleDelayMs
    : kRoastIpadPlaybackSettleDefaultMs;
  CFTimeInterval scheduledAt = CACurrentMediaTime();

  AVAudioSession *session = [AVAudioSession sharedInstance];
  RCTLogInfo(@"[ROAST_IPAD_TTS_PLAYBACK_SETTLE] action=schedule delayMs=%lld playbackSettleDelayMs=%lld requestId=%@ turnId=%@ category=%@ mode=%@ outputVolume=%.3f vpioPaused=%d",
             playbackSettleDelayMs,
             playbackSettleDelayMs,
             self.requestId ?: @"",
             self.turnId ?: @"",
             session.category ?: @"",
             session.mode ?: @"",
             session.outputVolume,
             (int)self.vpioPausedForCurrentRequest);

  __weak typeof(self) weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)playbackSettleDelayMs * NSEC_PER_MSEC),
                 self.workQueue, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) return;
    if (strongSelf.playbackSettleToken != token) return;
    if (!strongSelf.playbackSettleScheduled) return;
    if (strongSelf.stopped || strongSelf.playbackStarted) return;
    if (!strongSelf.forceAudioSessionModeDefault || !strongSelf.audioSessionConfiguredForCurrentRequest) return;

    strongSelf.playbackSettleScheduled = NO;
    strongSelf.playbackSettleCompleted = YES;
    AVAudioSession *fireSession = [AVAudioSession sharedInstance];
    long long elapsedMs = llround((CACurrentMediaTime() - scheduledAt) * 1000.0);
    RCTLogInfo(@"[ROAST_IPAD_TTS_PLAYBACK_SETTLE] action=fire elapsedMs=%lld playbackSettleDelayMs=%lld requestId=%@ turnId=%@ category=%@ mode=%@ outputVolume=%.3f vpioPaused=%d",
               elapsedMs,
               playbackSettleDelayMs,
               strongSelf.requestId ?: @"",
               strongSelf.turnId ?: @"",
               fireSession.category ?: @"",
               fireSession.mode ?: @"",
               fireSession.outputVolume,
               (int)strongSelf.vpioPausedForCurrentRequest);
    [strongSelf logIpadOutputVolumeProbeForPhase:@"playback_settle_fire"];
    [strongSelf tryStartAudioQueueForReason:@"playback_settle_done" force:NO];
  });
  return YES;
}

- (void)configureRecordSessionForSpeakerPlaybackWithEvent:(NSString *)eventName
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  CFTimeInterval setupStartAt = CACurrentMediaTime();
  NSError *categoryError = nil;
  NSError *activeError = nil;
  NSError *overrideError = nil;
  AVAudioSessionCategoryOptions playRecordOptions =
    AVAudioSessionCategoryOptionDefaultToSpeaker |
    AVAudioSessionCategoryOptionAllowBluetooth |
    AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  NSArray *routeBeforeOverride = [self routeOutputsPayload];
  AVAudioSessionPortDescription *beforeOutput = session.currentRoute.outputs.firstObject;
  NSString *beforeOutputPortType = beforeOutput.portType ?: @"";

  BOOL usePlaybackBranch = self.forceAudioSessionModeDefault;
  BOOL categoryOk = NO;
  BOOL activeOk = NO;
  BOOL overrideOk = YES;
  BOOL overrideAttempted = NO;
  NSString *appliedCategory = @"";
  NSString *appliedMode = @"";

  if (usePlaybackBranch) {
    appliedCategory = AVAudioSessionCategoryPlayback;
    appliedMode = AVAudioSessionModeDefault;
    categoryOk = [session setCategory:AVAudioSessionCategoryPlayback
                                 mode:AVAudioSessionModeDefault
                              options:0
                                error:&categoryError];
    activeOk = [session setActive:YES error:&activeError];
  } else {
    appliedCategory = AVAudioSessionCategoryPlayAndRecord;
    appliedMode = AVAudioSessionModeVoiceChat;
    categoryOk = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                 mode:AVAudioSessionModeVoiceChat
                              options:playRecordOptions
                                error:&categoryError];
    activeOk = [session setActive:YES error:&activeError];
    overrideAttempted = YES;
    overrideOk = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&overrideError];
  }
  self.lastAudioSessionSetupMs = llround((CACurrentMediaTime() - setupStartAt) * 1000.0);
  NSArray *routeAfterOverride = [self routeOutputsPayload];
  AVAudioSessionPortDescription *afterOutput = session.currentRoute.outputs.firstObject;
  NSString *afterOutputPortType = afterOutput.portType ?: @"";

  NSMutableArray<NSString *> *errors = [NSMutableArray array];
  if (categoryError) [errors addObject:[NSString stringWithFormat:@"category:%@", categoryError.localizedDescription]];
  if (activeError) [errors addObject:[NSString stringWithFormat:@"active:%@", activeError.localizedDescription]];
  if (overrideError) [errors addObject:[NSString stringWithFormat:@"override:%@", overrideError.localizedDescription]];
  self.lastAudioSessionError = errors.count > 0 ? [errors componentsJoinedByString:@" | "] : nil;

  if (self.lastAudioSessionError) {
    RCTLogWarn(@"[RoastChunkStreamPlayer] audio_session_warning %@", self.lastAudioSessionError);
  }

  if (usePlaybackBranch) {
    BOOL configOk = categoryOk && activeOk;
    NSString *phase = configOk ? @"native_config_playback_mode" : @"switch_failed";
    RCTLogInfo(@"[ROAST_IOS_IPAD_TTS_SESSION_EXPERIMENT] %@", [self ttsSessionExperimentPayloadForPhase:phase context:self.ttsSessionExperimentContext ?: @{} errorText:self.lastAudioSessionError]);
    RCTLogInfo(@"[ROAST_IPAD_TTS_PLAYBACK_BRANCH] hit=1 categoryOk=%d activeOk=%d category=%@ mode=%@ outputPortType=%@",
               (int)categoryOk, (int)activeOk, session.category ?: @"", session.mode ?: @"", afterOutputPortType);
    if (configOk) {
      self.audioSessionConfiguredForCurrentRequest = YES;
      [self logIpadOutputVolumeProbeForPhase:@"after_playback_config"];
    }
  } else {
    RCTLogInfo(@"[ROAST_IOS_IPAD_TTS_SESSION_EXPERIMENT] %@", [self ttsSessionExperimentPayloadForPhase:@"native_config_voicechat_mode" context:self.ttsSessionExperimentContext ?: @{} errorText:self.lastAudioSessionError]);
  }

  [self logAudioDiagEvent:eventName ?: @"audio_session_configured" extra:@{
    @"categoryOk": @(categoryOk),
    @"activeOk": @(activeOk),
    @"overrideSpeakerOk": @(overrideOk),
    @"overrideResult": @(overrideOk),
    @"overrideAttempted": @(overrideAttempted),
    @"appliedCategory": appliedCategory ?: @"",
    @"appliedMode": appliedMode ?: @"",
    @"playbackBranchHit": @(usePlaybackBranch),
    @"beforeOutputPortType": beforeOutputPortType ?: @"",
    @"afterOutputPortType": afterOutputPortType ?: @"",
    @"routeBeforeOverride": routeBeforeOverride,
    @"routeAfterOverride": routeAfterOverride,
    @"audioSessionSetupMs": @(self.lastAudioSessionSetupMs),
    @"sessionError": self.lastAudioSessionError ?: [NSNull null],
  }];
  [self logAudioSessionCompareForPhase:@"after_config"];
}

- (void)cancelTailGuardForReason:(NSString *)reason
{
  if (!self.tailGuardPending) return;
  self.tailGuardToken += 1;
  self.tailGuardPending = NO;
  RCTLogInfo(@"[ROAST_VPIO_TAIL_GUARD] action=cancel reason=%@ requestId=%@ turnId=%@",
             reason ?: @"unknown",
             self.tailGuardRequestId ?: @"",
             self.tailGuardTurnId ?: @"");
  self.tailGuardRequestId = nil;
  self.tailGuardTurnId = nil;
}

- (void)scheduleTailGuardRestoreForReason:(NSString *)reason
{
  BOOL guardEligible = self.forceAudioSessionModeDefault && self.vpioPausedForCurrentRequest;
  if (!guardEligible) {
    [self restoreRecordSessionAfterPlaybackIfNeeded];
    return;
  }
  [self cancelTailGuardForReason:@"resched_overlap"];
  self.tailGuardToken += 1;
  NSInteger token = self.tailGuardToken;
  self.tailGuardPending = YES;
  self.tailGuardRequestId = self.requestId ?: @"";
  self.tailGuardTurnId = self.turnId ?: @"";
  CFTimeInterval scheduledAt = CACurrentMediaTime();
  long long audioQueueStartedMs = self.audioQueueStartedAt > 0 ? [self elapsedMs:self.audioQueueStartedAt] : -1;
  long long playbackEndedMs = self.playbackEndedAt > 0 ? [self elapsedMs:self.playbackEndedAt] : -1;
  long long streamEndMs = self.streamEndedAt > 0 ? [self elapsedMs:self.streamEndedAt] : -1;
  RCTLogInfo(@"[ROAST_VPIO_TAIL_GUARD] action=schedule delayMs=%lld reason=%@ requestId=%@ turnId=%@ audioQueueStartedMs=%lld playbackEndedMs=%lld streamEndMs=%lld",
             kRoastIpadVpioTailGuardMs,
             reason ?: @"playback_ended",
             self.tailGuardRequestId ?: @"",
             self.tailGuardTurnId ?: @"",
             audioQueueStartedMs,
             playbackEndedMs,
             streamEndMs);
  __weak typeof(self) weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)kRoastIpadVpioTailGuardMs * NSEC_PER_MSEC),
                 self.workQueue, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) return;
    if (strongSelf.tailGuardToken != token) return;
    if (!strongSelf.tailGuardPending) return;
    NSString *reqId = strongSelf.tailGuardRequestId ?: @"";
    NSString *trnId = strongSelf.tailGuardTurnId ?: @"";
    strongSelf.tailGuardPending = NO;
    strongSelf.tailGuardRequestId = nil;
    strongSelf.tailGuardTurnId = nil;
    long long elapsedSincePlaybackEndedMs = llround((CACurrentMediaTime() - scheduledAt) * 1000.0);
    RCTLogInfo(@"[ROAST_VPIO_TAIL_GUARD] action=fire requestId=%@ turnId=%@ elapsedSincePlaybackEndedMs=%lld",
               reqId, trnId, elapsedSincePlaybackEndedMs);
    [strongSelf restoreRecordSessionAfterPlaybackIfNeeded];
  });
}

- (void)restoreRecordSessionAfterPlaybackIfNeeded
{
  [self cancelTailGuardForReason:@"immediate_restore"];
  [self resumeWebRtcVpioAfterPlaybackIfNeeded];
  if (!self.forceAudioSessionModeDefault) return;
  [self restoreIpadTtsSessionExperimentInternal:self.ttsSessionExperimentContext ?: @{}];
  self.forceAudioSessionModeDefault = NO;
  self.audioSessionConfiguredForCurrentRequest = NO;
  self.ttsSessionExperimentContext = nil;
}

- (NSDictionary *)ttsSessionExperimentPayloadForPhase:(NSString *)phase
                                              context:(NSDictionary *)context
                                             errorText:(NSString *)errorText
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionPortDescription *firstOutput = session.currentRoute.outputs.firstObject;
  return @{
    @"requestId": context[@"requestId"] ?: self.requestId ?: @"",
    @"turnId": context[@"turnId"] ?: @"",
    @"phase": phase ?: @"unknown",
    @"forceAudioSessionModeDefault": context[@"forceAudioSessionModeDefault"] ?: @(self.forceAudioSessionModeDefault),
    @"category": session.category ?: @"",
    @"mode": session.mode ?: @"",
    @"options": @((NSUInteger)session.categoryOptions),
    @"outputPortType": firstOutput.portType ?: @"",
    @"outputVolume": @(session.outputVolume),
    @"inputCount": @(session.currentRoute.inputs.count),
    @"outputCount": @(session.currentRoute.outputs.count),
    @"elapsedMs": self.requestStartAt > 0 ? @([self elapsedMs:CACurrentMediaTime()]) : [NSNull null],
    @"packetsQueued": @(self.packetsQueued),
    @"bytesQueuedBeforeStart": @(self.bytesQueuedBeforeStart),
    @"buffersQueued": @(self.buffersQueued),
    @"audioQueueVolume": @(self.audioQueueVolume),
    @"vpioPaused": @(self.vpioPausedForCurrentRequest),
    @"isMicMuted": context[@"isMicMuted"] ?: [NSNull null],
    @"localAudioTrackEnabled": context[@"localAudioTrackEnabled"] ?: [NSNull null],
    @"errorMessage": errorText ?: [NSNull null],
  };
}

- (NSDictionary *)restoreIpadTtsSessionExperimentInternal:(NSDictionary *)context
{
  RCTLogInfo(@"[ROAST_IOS_IPAD_TTS_SESSION_EXPERIMENT] %@", [self ttsSessionExperimentPayloadForPhase:@"before_restore" context:context errorText:nil]);

  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *categoryError = nil;
  NSError *activeError = nil;
  NSError *overrideError = nil;
  AVAudioSessionCategoryOptions options =
    AVAudioSessionCategoryOptionDefaultToSpeaker |
    AVAudioSessionCategoryOptionAllowBluetooth |
    AVAudioSessionCategoryOptionAllowBluetoothA2DP;

  BOOL categoryOk = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                    mode:AVAudioSessionModeVoiceChat
                                 options:options
                                   error:&categoryError];
  BOOL activeOk = [session setActive:YES error:&activeError];
  BOOL overrideOk = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&overrideError];
  NSMutableArray<NSString *> *errors = [NSMutableArray array];
  if (categoryError) [errors addObject:[NSString stringWithFormat:@"category:%@", categoryError.localizedDescription]];
  if (activeError) [errors addObject:[NSString stringWithFormat:@"active:%@", activeError.localizedDescription]];
  if (overrideError) [errors addObject:[NSString stringWithFormat:@"override:%@", overrideError.localizedDescription]];
  NSString *errorText = errors.count > 0 ? [errors componentsJoinedByString:@" | "] : nil;
  NSString *phase = (categoryOk && activeOk && overrideOk) ? @"restore_done" : @"restore_failed";
  NSDictionary *payload = [self ttsSessionExperimentPayloadForPhase:phase context:context errorText:errorText];
  RCTLogInfo(@"[ROAST_IOS_IPAD_TTS_SESSION_EXPERIMENT] %@", payload);
  return payload;
}

- (void)ensureSpeakerRouteBeforeAudioQueueStart
{
  [self ensureSpeakerRouteForEvent:@"speaker_route_checked_before_start"];
}

- (void)ensureSpeakerRouteForEvent:(NSString *)eventName
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSArray *routeBeforeOverride = [self routeOutputsPayload];
  AVAudioSessionPortDescription *firstOutput = session.currentRoute.outputs.firstObject;
  NSString *beforePortType = firstOutput.portType ?: @"";
  if ([beforePortType isEqualToString:AVAudioSessionPortBuiltInSpeaker]) {
    [self logAudioDiagEvent:eventName ?: @"speaker_route_confirmed" extra:@{
      @"beforeOutputPortType": beforePortType,
      @"afterOutputPortType": beforePortType,
      @"overrideSpeakerRetried": @NO,
      @"overrideResult": @YES,
      @"routeBeforeOverride": routeBeforeOverride,
      @"routeAfterOverride": routeBeforeOverride,
    }];
    return;
  }
  if ([session.category isEqualToString:AVAudioSessionCategoryPlayback]) {
    [self logAudioDiagEvent:eventName ?: @"speaker_route_skipped_playback_category" extra:@{
      @"beforeOutputPortType": beforePortType ?: @"",
      @"afterOutputPortType": beforePortType ?: @"",
      @"overrideSpeakerRetried": @NO,
      @"overrideResult": @YES,
      @"category": session.category ?: @"",
      @"routeBeforeOverride": routeBeforeOverride,
      @"routeAfterOverride": routeBeforeOverride,
    }];
    return;
  }

  NSError *activeError = nil;
  NSError *overrideError = nil;
  BOOL activeOk = [session setActive:YES error:&activeError];
  BOOL overrideOk = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&overrideError];
  NSMutableArray<NSString *> *errors = [NSMutableArray array];
  if (activeError) [errors addObject:[NSString stringWithFormat:@"active:%@", activeError.localizedDescription]];
  if (overrideError) [errors addObject:[NSString stringWithFormat:@"override:%@", overrideError.localizedDescription]];
  if (errors.count > 0) {
    self.lastAudioSessionError = [errors componentsJoinedByString:@" | "];
  }
  NSArray *routeAfterOverride = [self routeOutputsPayload];
  AVAudioSessionPortDescription *afterOutput = session.currentRoute.outputs.firstObject;
  NSString *afterPortType = afterOutput.portType ?: @"";

  [self logAudioDiagEvent:eventName ?: @"speaker_route_reasserted" extra:@{
    @"beforeOutputPortType": beforePortType ?: @"",
    @"afterOutputPortType": afterPortType ?: @"",
    @"overrideSpeakerRetried": @YES,
    @"activeOk": @(activeOk),
    @"overrideSpeakerOk": @(overrideOk),
    @"overrideResult": @(overrideOk),
    @"routeBeforeOverride": routeBeforeOverride,
    @"routeAfterOverride": routeAfterOverride,
    @"routeError": errors.count > 0 ? [errors componentsJoinedByString:@" | "] : [NSNull null],
  }];
}

- (void)applyMagicCookieIfAvailable
{
  Boolean writable = false;
  UInt32 cookieSize = 0;
  OSStatus sizeStatus = AudioFileStreamGetPropertyInfo(self.audioFileStream,
                                                       kAudioFileStreamProperty_MagicCookieData,
                                                       &cookieSize,
                                                       &writable);
  if (sizeStatus != noErr || cookieSize == 0) return;

  void *cookie = malloc(cookieSize);
  if (!cookie) return;
  OSStatus cookieStatus = AudioFileStreamGetProperty(self.audioFileStream,
                                                     kAudioFileStreamProperty_MagicCookieData,
                                                     &cookieSize,
                                                     cookie);
  if (cookieStatus == noErr && self.audioQueue) {
    AudioQueueSetProperty(self.audioQueue, kAudioQueueProperty_MagicCookie, cookie, cookieSize);
  }
  free(cookie);
}

- (void)resolveStartedIfNeeded
{
  if (!self.pendingResolve) return;
  self.pendingResolve([self stateDictionary]);
  self.pendingResolve = nil;
  self.pendingReject = nil;
}

- (void)failWithCode:(NSString *)code message:(NSString *)message
{
  self.status = @"failed";
  self.lastError = message ?: code;
  RCTLogInfo(@"[RoastChunkStreamPlayer] failed code=%@ message=%@", code, self.lastError);
  [self emitEvent:@"roastChunkStream:error"];
  if (self.pendingReject) {
    self.pendingReject(code, self.lastError, nil);
    self.pendingResolve = nil;
    self.pendingReject = nil;
  }
  [self stopInternalKeepingStatus:YES emitStopped:NO];
}

- (void)handleBufferComplete
{
  dispatch_async(self.workQueue, ^{
    if (self.stopped) return;
    if (self.buffersInFlight > 0) {
      self.buffersInFlight -= 1;
    }
    [self emitProgressIfNeeded];
    [self finishPlaybackIfDrained];
  });
}

- (void)finishPlaybackIfDrained
{
  if (!self.streamEnded || !self.playbackStarted || self.buffersInFlight > 0) return;
  if ([self.status isEqualToString:@"playbackEnded"]) return;

  self.playbackEndedAt = CACurrentMediaTime();
  self.status = @"playbackEnded";
  RCTLogInfo(@"[RoastChunkStreamPlayer] playback_ended elapsedMs=%lld bytesReceived=%lld packetsQueued=%lld buffersQueued=%lld",
             [self elapsedMs:self.playbackEndedAt],
             self.bytesReceived,
             self.packetsQueued,
             self.buffersQueued);
  [self logAudioDiagEvent:@"playback_ended" extra:@{
    @"playbackEndedMs": @([self elapsedMs:self.playbackEndedAt]),
  }];
  if (self.audioQueue) {
    AudioQueueStop(self.audioQueue, false);
  }
  [self scheduleTailGuardRestoreForReason:@"playback_ended"];
  [self emitEvent:@"roastChunkStream:playbackEnded"];
}

- (void)emitProgressIfNeeded
{
  CFTimeInterval now = CACurrentMediaTime();
  if (self.lastProgressEventAt > 0 && now - self.lastProgressEventAt < kRoastChunkProgressIntervalSeconds) {
    return;
  }
  self.lastProgressEventAt = now;
  [self emitEvent:@"roastChunkStream:progress"];
}

- (NSDictionary *)audioSessionDiagnosticPayload
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionPortDescription *firstOutput = session.currentRoute.outputs.firstObject;
  return @{
    @"deviceIdiom": [self deviceIdiom],
    @"audioSessionCategory": session.category ?: @"",
    @"audioSessionMode": session.mode ?: @"",
    @"categoryOptions": @((NSUInteger)session.categoryOptions),
    @"outputRoute": firstOutput.portName ?: @"",
    @"outputPortType": firstOutput.portType ?: @"",
    @"outputPortName": firstOutput.portName ?: @"",
    @"outputVolume": @(session.outputVolume),
    @"outputs": [self routeOutputsPayload],
    @"inputs": [self routeInputsPayload],
  };
}

- (NSArray *)routeOutputsPayload
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSMutableArray *outputs = [NSMutableArray array];
  for (AVAudioSessionPortDescription *port in session.currentRoute.outputs) {
    [outputs addObject:@{
      @"portType": port.portType ?: @"",
      @"portName": port.portName ?: @"",
    }];
  }
  return outputs;
}

- (NSArray *)routeInputsPayload
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSMutableArray *inputs = [NSMutableArray array];
  for (AVAudioSessionPortDescription *port in session.currentRoute.inputs) {
    [inputs addObject:@{
      @"portType": port.portType ?: @"",
      @"portName": port.portName ?: @"",
    }];
  }
  return inputs;
}

- (NSString *)deviceIdiom
{
  UIUserInterfaceIdiom idiom = UIDevice.currentDevice.userInterfaceIdiom;
  if (idiom == UIUserInterfaceIdiomPad) return @"tablet";
  if (idiom == UIUserInterfaceIdiomPhone) return @"phone";
  if (idiom == UIUserInterfaceIdiomMac) return @"mac";
  return @"unknown";
}

- (void)logAudioDiagEvent:(NSString *)event extra:(NSDictionary *)extra
{
  NSMutableDictionary *payload = [NSMutableDictionary dictionaryWithDictionary:@{
    @"event": event ?: @"unknown",
    @"requestId": self.requestId ?: @"",
    @"status": self.status ?: @"unknown",
    @"packetsBeforeStart": @(self.packetsQueued),
    @"buffersBeforeStart": @(self.buffersQueued),
    @"bytesBeforeStart": @(self.bytesQueuedBeforeStart),
    @"firstBufferByteSize": @(self.firstBufferByteSize),
    @"firstPacketCount": @(self.firstPacketCount),
    @"audioQueueVolume": @(self.audioQueueVolume),
    @"audioQueueVolumeSetResult": @((int)self.lastAudioQueueVolumeSetResult),
    @"audioQueuePrimeResult": @((int)self.lastAudioQueuePrimeResult),
    @"audioQueuePrimeMs": @(self.lastAudioQueuePrimeMs),
    @"audioQueueStartResult": @((int)self.lastAudioQueueStartResult),
    @"playbackSettleDelayMs": @(self.playbackSettleDelayMs),
    @"isFallbackPlayer": @NO,
    @"audioQueueStartAttemptMs": self.audioQueueStartAttemptAt > 0 ? @([self elapsedMs:self.audioQueueStartAttemptAt]) : [NSNull null],
    @"firstNetworkChunkMs": self.firstNetworkChunkAt > 0 ? @([self elapsedMs:self.firstNetworkChunkAt]) : [NSNull null],
    @"firstPacketParsedMs": self.firstPacketParsedAt > 0 ? @([self elapsedMs:self.firstPacketParsedAt]) : [NSNull null],
    @"audioQueueStartedMs": self.audioQueueStartedAt > 0 ? @([self elapsedMs:self.audioQueueStartedAt]) : [NSNull null],
    @"streamEndMs": self.streamEnded ? @([self elapsedMs:CACurrentMediaTime()]) : [NSNull null],
    @"playbackEndedMs": self.playbackEndedAt > 0 ? @([self elapsedMs:self.playbackEndedAt]) : [NSNull null],
    @"audioSession": [self audioSessionDiagnosticPayload],
  }];
  if (extra) {
    [payload addEntriesFromDictionary:extra];
  }
  RCTLogInfo(@"[ROAST_AUDIO_DIAG] %@", payload);
}

- (void)logAudioSessionCompareForPhase:(NSString *)phase
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionPortDescription *firstOutput = session.currentRoute.outputs.firstObject;
  NSDictionary *payload = @{
    @"requestId": self.requestId ?: @"",
    @"phase": phase ?: @"unknown",
    @"category": session.category ?: @"",
    @"mode": session.mode ?: @"",
    @"categoryOptions": @((NSUInteger)session.categoryOptions),
    @"outputVolume": @(session.outputVolume),
    @"outputPortType": firstOutput.portType ?: @"",
    @"inputCount": @(session.currentRoute.inputs.count),
    @"outputCount": @(session.currentRoute.outputs.count),
    @"secondaryAudioShouldBeSilencedHint": @(session.secondaryAudioShouldBeSilencedHint),
    @"otherAudioPlaying": @(session.otherAudioPlaying),
    @"isOtherAudioPlaying": @(session.otherAudioPlaying),
    @"audioQueueVolume": @(self.audioQueueVolume),
    @"turnId": self.turnId ?: @"",
  };
  RCTLogInfo(@"[ROAST_AUDIO_SESSION_COMPARE] %@", payload);
}

- (void)emitEvent:(NSString *)eventName
{
  if (!self.hasListeners) return;
  NSDictionary *body = [self eventDictionaryAt:CACurrentMediaTime()];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:eventName body:body];
  });
}

- (NSDictionary *)eventDictionaryAt:(CFTimeInterval)time
{
  NSMutableDictionary *state = [[self stateDictionary] mutableCopy];
  state[@"requestId"] = self.requestId ?: @"";
  state[@"elapsedMs"] = self.requestStartAt > 0 ? @([self elapsedMs:time]) : [NSNull null];
  return state;
}

- (NSDictionary *)stateDictionary
{
  CFTimeInterval now = CACurrentMediaTime();
  return @{
    @"requestId": self.requestId ?: @"",
    @"status": self.status ?: @"unknown",
    @"bytesReceived": @(self.bytesReceived),
    @"packetsQueued": @(self.packetsQueued),
    @"buffersQueued": @(self.buffersQueued),
    @"buffersInFlight": @(self.buffersInFlight),
    @"bytesQueuedBeforeStart": @(self.bytesQueuedBeforeStart),
    @"firstBufferByteSize": @(self.firstBufferByteSize),
    @"firstPacketCount": @(self.firstPacketCount),
    @"audioQueueVolume": @(self.audioQueueVolume),
    @"audioQueueVolumeSetResult": @((int)self.lastAudioQueueVolumeSetResult),
    @"audioQueuePrimeResult": @((int)self.lastAudioQueuePrimeResult),
    @"audioQueuePrimeMs": @(self.lastAudioQueuePrimeMs),
    @"audioQueueStartResult": @((int)self.lastAudioQueueStartResult),
    @"audioSessionSetupMs": @(self.lastAudioSessionSetupMs),
    @"playbackSettleDelayMs": @(self.playbackSettleDelayMs),
    @"audioQueueStartAttemptMs": self.audioQueueStartAttemptAt > 0 ? @([self elapsedMs:self.audioQueueStartAttemptAt]) : [NSNull null],
    @"audioSession": [self audioSessionDiagnosticPayload],
    @"audioSessionError": self.lastAudioSessionError ?: [NSNull null],
    @"playbackStarted": @(self.playbackStarted),
    @"error": self.lastError ?: [NSNull null],
    @"requestStartMs": @(0),
    @"firstNetworkChunkMs": self.firstNetworkChunkAt > 0 ? @([self elapsedMs:self.firstNetworkChunkAt]) : [NSNull null],
    @"firstPacketParsedMs": self.firstPacketParsedAt > 0 ? @([self elapsedMs:self.firstPacketParsedAt]) : [NSNull null],
    @"audioQueueStartedMs": self.audioQueueStartedAt > 0 ? @([self elapsedMs:self.audioQueueStartedAt]) : [NSNull null],
    @"playbackEndedMs": self.playbackEndedAt > 0 ? @([self elapsedMs:self.playbackEndedAt]) : [NSNull null],
    @"elapsedMs": self.requestStartAt > 0 ? @([self elapsedMs:now]) : [NSNull null],
  };
}

- (long long)elapsedMs:(CFTimeInterval)time
{
  if (self.requestStartAt <= 0 || time <= 0) return 0;
  return llround((time - self.requestStartAt) * 1000.0);
}

- (void)stopInternal
{
  [self stopInternalKeepingStatus:NO emitStopped:NO];
}

- (void)stopInternalKeepingStatus:(BOOL)keepStatus emitStopped:(BOOL)emitStopped
{
  BOOL shouldEmitStopped = emitStopped && !self.stopped && self.requestStartAt > 0;
  self.stopped = YES;
  [self.task cancel];
  self.task = nil;
  [self.session invalidateAndCancel];
  self.session = nil;

  if (self.audioQueue) {
    AudioQueueStop(self.audioQueue, true);
    AudioQueueDispose(self.audioQueue, true);
    self.audioQueue = NULL;
  }
  if (self.audioFileStream) {
    AudioFileStreamClose(self.audioFileStream);
    self.audioFileStream = NULL;
  }
  [self cancelTailGuardForReason:emitStopped ? @"stop" : @"cleanup"];
  [self restoreRecordSessionAfterPlaybackIfNeeded];
  if (!keepStatus) {
    self.status = @"idle";
    self.lastError = nil;
  }
  self.streamEnded = NO;
  self.buffersInFlight = 0;
  self.bytesQueuedBeforeStart = 0;
  self.firstBufferByteSize = 0;
  self.firstPacketCount = 0;
  self.pendingResolve = nil;
  self.pendingReject = nil;
  if (shouldEmitStopped) {
    self.status = @"stopped";
    [self emitEvent:@"roastChunkStream:stopped"];
  }
}

@end

static void RoastAudioFileStreamPropertyListener(void *inClientData,
                                                 AudioFileStreamID inAudioFileStream,
                                                 AudioFileStreamPropertyID inPropertyID,
                                                 UInt32 *ioFlags)
{
  RoastChunkStreamPlayerModule *player = (__bridge RoastChunkStreamPlayerModule *)inClientData;
  [player handleProperty:inPropertyID flags:ioFlags];
}

static void RoastAudioFileStreamPacketsListener(void *inClientData,
                                                UInt32 inNumberBytes,
                                                UInt32 inNumberPackets,
                                                const void *inInputData,
                                                AudioStreamPacketDescription *inPacketDescriptions)
{
  RoastChunkStreamPlayerModule *player = (__bridge RoastChunkStreamPlayerModule *)inClientData;
  [player handlePacketsWithBytes:inNumberBytes packets:inNumberPackets data:inInputData packetDescriptions:inPacketDescriptions];
}

static void RoastAudioQueueOutputCallback(void *inUserData, AudioQueueRef inAQ, AudioQueueBufferRef inBuffer)
{
  RoastChunkStreamPlayerModule *player = (__bridge RoastChunkStreamPlayerModule *)inUserData;
  AudioQueueFreeBuffer(inAQ, inBuffer);
  [player handleBufferComplete];
}
