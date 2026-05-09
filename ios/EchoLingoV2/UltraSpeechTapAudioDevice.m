#import "UltraSpeechTapAudioDevice.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <math.h>
#import <os/lock.h>

static NSString *const UltraSpeechTapErrorDomain = @"cn.echolingo.ultraSpeechTap";

@interface UltraSpeechTapAudioDevice () {
  AudioUnit _audioUnit;
  id<RTCAudioDeviceDelegate> _delegate;
  BOOL _initialized;
  BOOL _playoutInitialized;
  BOOL _recordingInitialized;
  BOOL _playing;
  BOOL _recording;
  BOOL _audioUnitStarted;
  double _sampleRate;
  NSTimeInterval _ioBufferDuration;
  NSInteger _numberOfChannels;
  NSMutableData *_recordScratchBuffer;
  os_unfair_lock _captureLock;
  NSMutableData *_activePCMData;
  NSString *_activeTurnId;
  CFAbsoluteTime _activeTurnStartedAt;
  NSDictionary *_lastResult;
}
@end

static OSStatus UltraSpeechTapOutputCallback(void *inRefCon,
                                             AudioUnitRenderActionFlags *ioActionFlags,
                                             const AudioTimeStamp *inTimeStamp,
                                             UInt32 inBusNumber,
                                             UInt32 inNumberFrames,
                                             AudioBufferList *ioData);
static OSStatus UltraSpeechTapInputCallback(void *inRefCon,
                                            AudioUnitRenderActionFlags *ioActionFlags,
                                            const AudioTimeStamp *inTimeStamp,
                                            UInt32 inBusNumber,
                                            UInt32 inNumberFrames,
                                            AudioBufferList *ioData);

@implementation UltraSpeechTapAudioDevice

+ (instancetype)sharedDevice {
  static UltraSpeechTapAudioDevice *sharedDevice = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    sharedDevice = [[self alloc] initPrivate];
  });
  return sharedDevice;
}

- (instancetype)init {
  [NSException raise:@"UltraSpeechTapAudioDevice" format:@"Use +sharedDevice"];
  return nil;
}

- (instancetype)initPrivate {
  self = [super init];
  if (self) {
    _captureLock = OS_UNFAIR_LOCK_INIT;
    _sampleRate = 48000;
    _ioBufferDuration = 0.01;
    _numberOfChannels = 1;
    _recordScratchBuffer = [NSMutableData data];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleRouteChange:)
                                                 name:AVAudioSessionRouteChangeNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleInterruption:)
                                                 name:AVAudioSessionInterruptionNotification
                                               object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [self terminateDevice];
}

#pragma mark - Public capture API

- (NSDictionary *)supportInfo {
  return @{
    @"supported": @YES,
    @"platform": @"ios",
  };
}

- (NSDictionary *)startTurn:(NSString *)turnId error:(NSError * _Nullable __autoreleasing *)error {
  if (turnId.length == 0) {
    if (error) {
      *error = [NSError errorWithDomain:UltraSpeechTapErrorDomain
                                   code:1001
                               userInfo:@{NSLocalizedDescriptionKey: @"missing_turn_id"}];
    }
    return @{
      @"ok": @NO,
      @"turnId": @"",
      @"reason": @"missing_turn_id",
    };
  }

  os_unfair_lock_lock(&_captureLock);
  _activeTurnId = [turnId copy];
  _activeTurnStartedAt = CFAbsoluteTimeGetCurrent();
  _activePCMData = [NSMutableData data];
  os_unfair_lock_unlock(&_captureLock);

  return @{
    @"ok": @YES,
    @"turnId": turnId,
  };
}

- (NSDictionary *)stopTurn:(NSString *)turnId error:(NSError * _Nullable __autoreleasing *)error {
  NSString *resolvedTurnId = turnId ?: @"";
  NSMutableData *capturedPCM = nil;
  double startedAt = 0;

  os_unfair_lock_lock(&_captureLock);
  if (_activeTurnId == nil || ![_activeTurnId isEqualToString:resolvedTurnId]) {
    NSDictionary *lastResult = _lastResult;
    os_unfair_lock_unlock(&_captureLock);
    if (lastResult && [lastResult[@"turnId"] isEqualToString:resolvedTurnId]) {
      return lastResult;
    }
    NSString *reason = _activeTurnId == nil ? @"no_active_turn" : @"turn_id_mismatch";
    if (error) {
      *error = [NSError errorWithDomain:UltraSpeechTapErrorDomain
                                   code:1002
                               userInfo:@{NSLocalizedDescriptionKey: reason}];
    }
    return @{
      @"ok": @NO,
      @"turnId": resolvedTurnId,
      @"reason": reason,
    };
  }

  capturedPCM = [_activePCMData mutableCopy] ?: [NSMutableData data];
  startedAt = _activeTurnStartedAt;
  _activeTurnId = nil;
  _activeTurnStartedAt = 0;
  _activePCMData = nil;
  os_unfair_lock_unlock(&_captureLock);

  if (capturedPCM.length == 0) {
    NSDictionary *result = @{
      @"ok": @NO,
      @"turnId": resolvedTurnId,
      @"reason": @"empty_capture",
    };
    _lastResult = result;
    if (error) {
      *error = [NSError errorWithDomain:UltraSpeechTapErrorDomain
                                   code:1003
                               userInfo:@{NSLocalizedDescriptionKey: @"empty_capture"}];
    }
    return result;
  }

  NSString *fileName = [NSString stringWithFormat:@"ultra-speech-%@-%@.wav",
                        resolvedTurnId,
                        @((long long)(CFAbsoluteTimeGetCurrent() * 1000)).stringValue];
  NSString *filePath = [NSTemporaryDirectory() stringByAppendingPathComponent:fileName];
  NSURL *fileURL = [NSURL fileURLWithPath:filePath];

  NSError *writeError = nil;
  if (![self writeWavFileWithPCMData:capturedPCM toURL:fileURL error:&writeError]) {
    NSString *reason = writeError.localizedDescription ?: @"write_failed";
    NSDictionary *result = @{
      @"ok": @NO,
      @"turnId": resolvedTurnId,
      @"reason": reason,
    };
    _lastResult = result;
    if (error) {
      *error = writeError;
    }
    return result;
  }

  NSTimeInterval durationMs = (_sampleRate > 0 && _numberOfChannels > 0)
    ? ((double)capturedPCM.length / ((double)_numberOfChannels * sizeof(int16_t) * _sampleRate)) * 1000.0
    : MAX((CFAbsoluteTimeGetCurrent() - startedAt) * 1000.0, 0);
  NSDictionary *result = @{
    @"ok": @YES,
    @"turnId": resolvedTurnId,
    @"uri": fileURL.absoluteString ?: filePath,
    @"durationMs": @((NSInteger)llround(durationMs)),
    @"size": @((NSInteger)capturedPCM.length + 44),
    @"sampleRate": @((NSInteger)llround(_sampleRate)),
    @"channels": @(_numberOfChannels),
    @"format": @"wav",
    @"mimeType": @"audio/wav",
  };
  _lastResult = result;
  return result;
}

- (NSDictionary *)lastResult {
  return _lastResult ?: @{
    @"ok": @NO,
    @"reason": @"no_result",
  };
}

#pragma mark - RTCAudioDevice

- (double)deviceInputSampleRate {
  return _sampleRate;
}

- (NSTimeInterval)inputIOBufferDuration {
  return _ioBufferDuration;
}

- (NSInteger)inputNumberOfChannels {
  return _numberOfChannels;
}

- (NSTimeInterval)inputLatency {
  return AVAudioSession.sharedInstance.inputLatency;
}

- (double)deviceOutputSampleRate {
  return _sampleRate;
}

- (NSTimeInterval)outputIOBufferDuration {
  return _ioBufferDuration;
}

- (NSInteger)outputNumberOfChannels {
  return _numberOfChannels;
}

- (NSTimeInterval)outputLatency {
  return AVAudioSession.sharedInstance.outputLatency;
}

- (BOOL)isInitialized {
  return _initialized;
}

- (BOOL)initializeWithDelegate:(id<RTCAudioDeviceDelegate>)delegate {
  _delegate = delegate;
  if (_initialized) {
    return YES;
  }
  if (![self configureAudioSession]) {
    return NO;
  }
  if (![self setupAudioUnit]) {
    return NO;
  }
  _initialized = YES;
  _playoutInitialized = YES;
  _recordingInitialized = YES;
  [self notifyAudioParametersChanged];
  return YES;
}

- (BOOL)terminateDevice {
  [self stopAudioUnitIfNeededForce:YES];
  if (_audioUnit != nil) {
    AudioUnitUninitialize(_audioUnit);
    AudioComponentInstanceDispose(_audioUnit);
    _audioUnit = nil;
  }
  _delegate = nil;
  _initialized = NO;
  _playoutInitialized = NO;
  _recordingInitialized = NO;
  _playing = NO;
  _recording = NO;
  return YES;
}

- (BOOL)isPlayoutInitialized {
  return _playoutInitialized;
}

- (BOOL)initializePlayout {
  _playoutInitialized = YES;
  return YES;
}

- (BOOL)isPlaying {
  return _playing;
}

- (BOOL)startPlayout {
  _playing = YES;
  return [self startAudioUnitIfNeeded];
}

- (BOOL)stopPlayout {
  _playing = NO;
  [self stopAudioUnitIfNeededForce:NO];
  return YES;
}

- (BOOL)isRecordingInitialized {
  return _recordingInitialized;
}

- (BOOL)initializeRecording {
  _recordingInitialized = YES;
  return YES;
}

- (BOOL)isRecording {
  return _recording;
}

- (BOOL)startRecording {
  _recording = YES;
  return [self startAudioUnitIfNeeded];
}

- (BOOL)stopRecording {
  _recording = NO;
  [self stopAudioUnitIfNeededForce:NO];
  return YES;
}

#pragma mark - Audio session / unit

- (BOOL)configureAudioSession {
  AVAudioSession *audioSession = AVAudioSession.sharedInstance;
  NSError *error = nil;
  [audioSession setCategory:AVAudioSessionCategoryPlayAndRecord
                       mode:AVAudioSessionModeVoiceChat
                    options:(AVAudioSessionCategoryOptionAllowBluetooth |
                             AVAudioSessionCategoryOptionDefaultToSpeaker)
                      error:&error];
  if (error) {
    return NO;
  }

  [audioSession setPreferredSampleRate:48000 error:&error];
  if (error) {
    return NO;
  }

  [audioSession setPreferredIOBufferDuration:0.01 error:&error];
  if (error) {
    return NO;
  }

  [audioSession setActive:YES error:&error];
  if (error) {
    return NO;
  }

  [self refreshAudioParameters];
  return YES;
}

- (void)refreshAudioParameters {
  AVAudioSession *audioSession = AVAudioSession.sharedInstance;
  _sampleRate = audioSession.sampleRate > 0 ? audioSession.sampleRate : 48000;
  _ioBufferDuration = audioSession.IOBufferDuration > 0 ? audioSession.IOBufferDuration : 0.01;
  _numberOfChannels = MAX((NSInteger)audioSession.inputNumberOfChannels, 1);
}

- (BOOL)setupAudioUnit {
  if (_audioUnit != nil) {
    return YES;
  }

  AudioComponentDescription description;
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_VoiceProcessingIO;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;
  description.componentFlags = 0;
  description.componentFlagsMask = 0;

  AudioComponent component = AudioComponentFindNext(NULL, &description);
  if (component == NULL) {
    return NO;
  }

  OSStatus status = AudioComponentInstanceNew(component, &_audioUnit);
  if (status != noErr) {
    _audioUnit = nil;
    return NO;
  }

  UInt32 enableIO = 1;
  status = AudioUnitSetProperty(_audioUnit,
                                kAudioOutputUnitProperty_EnableIO,
                                kAudioUnitScope_Input,
                                1,
                                &enableIO,
                                sizeof(enableIO));
  if (status != noErr) {
    return NO;
  }

  status = AudioUnitSetProperty(_audioUnit,
                                kAudioOutputUnitProperty_EnableIO,
                                kAudioUnitScope_Output,
                                0,
                                &enableIO,
                                sizeof(enableIO));
  if (status != noErr) {
    return NO;
  }

  AudioStreamBasicDescription streamFormat;
  memset(&streamFormat, 0, sizeof(streamFormat));
  streamFormat.mSampleRate = _sampleRate;
  streamFormat.mFormatID = kAudioFormatLinearPCM;
  streamFormat.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  streamFormat.mFramesPerPacket = 1;
  streamFormat.mChannelsPerFrame = (UInt32)_numberOfChannels;
  streamFormat.mBitsPerChannel = 16;
  streamFormat.mBytesPerFrame = streamFormat.mChannelsPerFrame * sizeof(int16_t);
  streamFormat.mBytesPerPacket = streamFormat.mBytesPerFrame;

  status = AudioUnitSetProperty(_audioUnit,
                                kAudioUnitProperty_StreamFormat,
                                kAudioUnitScope_Output,
                                1,
                                &streamFormat,
                                sizeof(streamFormat));
  if (status != noErr) {
    return NO;
  }

  status = AudioUnitSetProperty(_audioUnit,
                                kAudioUnitProperty_StreamFormat,
                                kAudioUnitScope_Input,
                                0,
                                &streamFormat,
                                sizeof(streamFormat));
  if (status != noErr) {
    return NO;
  }

  AURenderCallbackStruct recordingCallback;
  recordingCallback.inputProc = UltraSpeechTapInputCallback;
  recordingCallback.inputProcRefCon = (__bridge void *)self;
  status = AudioUnitSetProperty(_audioUnit,
                                kAudioOutputUnitProperty_SetInputCallback,
                                kAudioUnitScope_Global,
                                1,
                                &recordingCallback,
                                sizeof(recordingCallback));
  if (status != noErr) {
    return NO;
  }

  AURenderCallbackStruct playoutCallback;
  playoutCallback.inputProc = UltraSpeechTapOutputCallback;
  playoutCallback.inputProcRefCon = (__bridge void *)self;
  status = AudioUnitSetProperty(_audioUnit,
                                kAudioUnitProperty_SetRenderCallback,
                                kAudioUnitScope_Input,
                                0,
                                &playoutCallback,
                                sizeof(playoutCallback));
  if (status != noErr) {
    return NO;
  }

  status = AudioUnitInitialize(_audioUnit);
  if (status != noErr) {
    return NO;
  }

  return YES;
}

- (BOOL)startAudioUnitIfNeeded {
  if (_audioUnit == nil && ![self setupAudioUnit]) {
    return NO;
  }
  if (_audioUnitStarted) {
    return YES;
  }
  if (!_playing && !_recording) {
    return YES;
  }
  OSStatus status = AudioOutputUnitStart(_audioUnit);
  if (status == noErr) {
    _audioUnitStarted = YES;
    return YES;
  }
  return NO;
}

- (void)stopAudioUnitIfNeededForce:(BOOL)force {
  if (_audioUnit == nil || !_audioUnitStarted) {
    return;
  }
  if (!force && (_playing || _recording)) {
    return;
  }
  AudioOutputUnitStop(_audioUnit);
  _audioUnitStarted = NO;
}

#pragma mark - Callbacks

- (OSStatus)handlePlayoutWithActionFlags:(AudioUnitRenderActionFlags *)actionFlags
                               timestamp:(const AudioTimeStamp *)timestamp
                          inputBusNumber:(UInt32)inputBusNumber
                              frameCount:(UInt32)frameCount
                              outputData:(AudioBufferList *)outputData {
  if (!_playing || _delegate == nil || _delegate.getPlayoutData == nil) {
    for (UInt32 index = 0; index < outputData->mNumberBuffers; index += 1) {
      AudioBuffer buffer = outputData->mBuffers[index];
      if (buffer.mData != NULL && buffer.mDataByteSize > 0) {
        memset(buffer.mData, 0, buffer.mDataByteSize);
      }
    }
    return noErr;
  }

  return _delegate.getPlayoutData(actionFlags, timestamp, inputBusNumber, frameCount, outputData);
}

- (OSStatus)handleRecordingWithActionFlags:(AudioUnitRenderActionFlags *)actionFlags
                                 timestamp:(const AudioTimeStamp *)timestamp
                            inputBusNumber:(UInt32)inputBusNumber
                                frameCount:(UInt32)frameCount {
  if (_audioUnit == nil || !_recording || _delegate == nil || _delegate.deliverRecordedData == nil) {
    return noErr;
  }

  UInt32 bytesPerFrame = (UInt32)(_numberOfChannels * sizeof(int16_t));
  NSUInteger bytesNeeded = (NSUInteger)frameCount * bytesPerFrame;
  if (_recordScratchBuffer.length < bytesNeeded) {
    [_recordScratchBuffer setLength:bytesNeeded];
  }

  AudioBufferList bufferList;
  bufferList.mNumberBuffers = 1;
  bufferList.mBuffers[0].mNumberChannels = (UInt32)_numberOfChannels;
  bufferList.mBuffers[0].mDataByteSize = (UInt32)bytesNeeded;
  bufferList.mBuffers[0].mData = _recordScratchBuffer.mutableBytes;

  OSStatus status = AudioUnitRender(_audioUnit,
                                    actionFlags,
                                    timestamp,
                                    1,
                                    frameCount,
                                    &bufferList);
  if (status != noErr) {
    return status;
  }

  [self capturePCMFromBufferList:&bufferList];
  return _delegate.deliverRecordedData(actionFlags,
                                       timestamp,
                                       inputBusNumber,
                                       frameCount,
                                       &bufferList,
                                       NULL,
                                       nil);
}

- (void)capturePCMFromBufferList:(const AudioBufferList *)bufferList {
  if (bufferList == NULL || bufferList->mNumberBuffers == 0) {
    return;
  }

  os_unfair_lock_lock(&_captureLock);
  if (_activeTurnId == nil || _activePCMData == nil) {
    os_unfair_lock_unlock(&_captureLock);
    return;
  }

  for (UInt32 index = 0; index < bufferList->mNumberBuffers; index += 1) {
    const AudioBuffer buffer = bufferList->mBuffers[index];
    if (buffer.mData != NULL && buffer.mDataByteSize > 0) {
      [_activePCMData appendBytes:buffer.mData length:buffer.mDataByteSize];
    }
  }
  os_unfair_lock_unlock(&_captureLock);
}

#pragma mark - WAV writer

- (BOOL)writeWavFileWithPCMData:(NSData *)pcmData
                          toURL:(NSURL *)url
                          error:(NSError * _Nullable __autoreleasing *)error {
  NSMutableData *wavData = [NSMutableData dataWithCapacity:pcmData.length + 44];
  uint32_t dataLength = (uint32_t)pcmData.length;
  uint32_t riffChunkSize = 36 + dataLength;
  uint16_t audioFormat = 1;
  uint16_t channels = (uint16_t)_numberOfChannels;
  uint32_t sampleRate = (uint32_t)llround(_sampleRate);
  uint16_t bitsPerSample = 16;
  uint32_t byteRate = sampleRate * channels * bitsPerSample / 8;
  uint16_t blockAlign = channels * bitsPerSample / 8;

  [wavData appendBytes:"RIFF" length:4];
  [wavData appendBytes:&riffChunkSize length:4];
  [wavData appendBytes:"WAVE" length:4];
  [wavData appendBytes:"fmt " length:4];

  uint32_t fmtChunkSize = 16;
  [wavData appendBytes:&fmtChunkSize length:4];
  [wavData appendBytes:&audioFormat length:2];
  [wavData appendBytes:&channels length:2];
  [wavData appendBytes:&sampleRate length:4];
  [wavData appendBytes:&byteRate length:4];
  [wavData appendBytes:&blockAlign length:2];
  [wavData appendBytes:&bitsPerSample length:2];
  [wavData appendBytes:"data" length:4];
  [wavData appendBytes:&dataLength length:4];
  [wavData appendData:pcmData];

  return [wavData writeToURL:url options:NSDataWritingAtomic error:error];
}

#pragma mark - Notifications

- (void)handleRouteChange:(NSNotification *)notification {
  [self refreshAudioParameters];
  [self notifyAudioParametersChanged];
}

- (void)handleInterruption:(NSNotification *)notification {
  NSDictionary *userInfo = notification.userInfo ?: @{};
  AVAudioSessionInterruptionType type =
    [userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
  id<RTCAudioDeviceDelegate> delegate = _delegate;
  if (delegate == nil) {
    return;
  }

  if (type == AVAudioSessionInterruptionTypeBegan) {
    [delegate dispatchAsync:^{
      [delegate notifyAudioInputInterrupted];
      [delegate notifyAudioOutputInterrupted];
    }];
  } else {
    [self configureAudioSession];
    [self notifyAudioParametersChanged];
    if (_playing || _recording) {
      [self startAudioUnitIfNeeded];
    }
  }
}

- (void)notifyAudioParametersChanged {
  id<RTCAudioDeviceDelegate> delegate = _delegate;
  if (delegate == nil) {
    return;
  }

  [delegate dispatchAsync:^{
    [delegate notifyAudioInputParametersChange];
    [delegate notifyAudioOutputParametersChange];
  }];
}

@end

static OSStatus UltraSpeechTapOutputCallback(void *inRefCon,
                                             AudioUnitRenderActionFlags *ioActionFlags,
                                             const AudioTimeStamp *inTimeStamp,
                                             UInt32 inBusNumber,
                                             UInt32 inNumberFrames,
                                             AudioBufferList *ioData) {
  UltraSpeechTapAudioDevice *device = (__bridge UltraSpeechTapAudioDevice *)inRefCon;
  return [device handlePlayoutWithActionFlags:ioActionFlags
                                    timestamp:inTimeStamp
                               inputBusNumber:inBusNumber
                                   frameCount:inNumberFrames
                                   outputData:ioData];
}

static OSStatus UltraSpeechTapInputCallback(void *inRefCon,
                                            AudioUnitRenderActionFlags *ioActionFlags,
                                            const AudioTimeStamp *inTimeStamp,
                                            UInt32 inBusNumber,
                                            UInt32 inNumberFrames,
                                            AudioBufferList *ioData) {
  UltraSpeechTapAudioDevice *device = (__bridge UltraSpeechTapAudioDevice *)inRefCon;
  return [device handleRecordingWithActionFlags:ioActionFlags
                                      timestamp:inTimeStamp
                                 inputBusNumber:inBusNumber
                                     frameCount:inNumberFrames];
}
