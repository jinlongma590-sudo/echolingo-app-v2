#import "RoastStreamPlayerModule.h"

#import <AVFoundation/AVFoundation.h>
#import <React/RCTLog.h>

@interface RoastStreamPlayerModule ()
@property (nonatomic, strong) AVPlayer *player;
@property (nonatomic, strong) id timeObserver;
@property (nonatomic, copy) RCTPromiseResolveBlock pendingResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock pendingReject;
@property (nonatomic, assign) CFTimeInterval playStartedAt;
@property (nonatomic, copy) NSString *status;
@property (nonatomic, copy) NSString *lastError;
@property (nonatomic, assign) BOOL observingPlayer;
@property (nonatomic, assign) BOOL observingItem;
@end

@implementation RoastStreamPlayerModule

RCT_EXPORT_MODULE(RoastStreamPlayer)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  if (self = [super init]) {
    _status = @"idle";
  }
  return self;
}

- (void)dealloc
{
  [self cleanupPlayer];
}

RCT_EXPORT_METHOD(playStream:(NSString *)urlString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSURL *url = [NSURL URLWithString:urlString ?: @""];
    if (!url || !url.scheme || !url.host) {
      reject(@"invalid_url", @"Invalid stream URL.", nil);
      return;
    }

    [self cleanupPlayer];
    self.pendingResolve = resolve;
    self.pendingReject = reject;
    self.playStartedAt = CACurrentMediaTime();
    self.status = @"loading";
    self.lastError = nil;

    NSError *sessionError = nil;
    [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayback error:&sessionError];
    [[AVAudioSession sharedInstance] setActive:YES error:&sessionError];
    if (sessionError) {
      RCTLogWarn(@"[RoastStreamPlayer] audio_session_warning %@", sessionError.localizedDescription);
    }

    RCTLogInfo(@"[RoastStreamPlayer] playStream called scheme=%@ host=%@ path=%@", url.scheme, url.host, url.path);

    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:@{
      @"AVURLAssetHTTPHeaderFieldsKey": @{
        @"Accept": @"audio/mpeg, application/vnd.apple.mpegurl, */*"
      }
    }];
    AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:asset];
    item.preferredForwardBufferDuration = 0.1;
    if ([item respondsToSelector:@selector(setCanUseNetworkResourcesForLiveStreamingWhilePaused:)]) {
      item.canUseNetworkResourcesForLiveStreamingWhilePaused = YES;
    }
    self.player = [AVPlayer playerWithPlayerItem:item];
    self.player.automaticallyWaitsToMinimizeStalling = NO;
    [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:nil];
    [item addObserver:self forKeyPath:@"loadedTimeRanges" options:NSKeyValueObservingOptionNew context:nil];
    [item addObserver:self forKeyPath:@"playbackLikelyToKeepUp" options:NSKeyValueObservingOptionNew context:nil];
    [item addObserver:self forKeyPath:@"playbackBufferEmpty" options:NSKeyValueObservingOptionNew context:nil];
    [item addObserver:self forKeyPath:@"playbackBufferFull" options:NSKeyValueObservingOptionNew context:nil];
    [self.player addObserver:self forKeyPath:@"timeControlStatus" options:NSKeyValueObservingOptionNew context:nil];
    self.observingItem = YES;
    self.observingPlayer = YES;
    __weak RoastStreamPlayerModule *weakSelf = self;
    self.timeObserver = [self.player addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(0.05, NSEC_PER_SEC)
                                                                  queue:dispatch_get_main_queue()
                                                             usingBlock:^(CMTime time) {
      RoastStreamPlayerModule *strongSelf = weakSelf;
      if (!strongSelf) return;
      Float64 seconds = CMTimeGetSeconds(time);
      if (isfinite(seconds) && seconds > 0.01) {
        [strongSelf resolveStarted:@"playing"];
      }
    }];

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(playerItemDidFail:)
                                                 name:AVPlayerItemFailedToPlayToEndTimeNotification
                                               object:item];

    [self.player play];
    RCTLogInfo(@"[RoastStreamPlayer] play_call_done reason=%@", [self waitingReasonString]);

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(8.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (self.pendingReject) {
        self.status = @"timeout";
        self.lastError = @"native_stream_timeout_no_progress";
        self.pendingReject(@"native_stream_timeout_no_progress", @"AVPlayer did not report playback progress.", nil);
        self.pendingResolve = nil;
        self.pendingReject = nil;
      }
    });
  });
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self cleanupPlayer];
    self.status = @"stopped";
    resolve(@{ @"status": self.status });
  });
}

RCT_EXPORT_METHOD(getState:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *playerStatus = @"none";
    if (self.player) {
      switch (self.player.timeControlStatus) {
        case AVPlayerTimeControlStatusPaused:
          playerStatus = @"paused";
          break;
        case AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate:
          playerStatus = @"waiting";
          break;
        case AVPlayerTimeControlStatusPlaying:
          playerStatus = @"playing";
          break;
      }
    }
    resolve(@{
      @"status": self.status ?: @"unknown",
      @"playerStatus": playerStatus,
      @"reasonForWaitingToPlay": [self waitingReasonString] ?: [NSNull null],
      @"error": self.lastError ?: [NSNull null],
    });
  });
}

- (void)resolveStarted:(NSString *)status
{
  if (!self.pendingResolve) return;
  CFTimeInterval elapsedMs = (CACurrentMediaTime() - self.playStartedAt) * 1000.0;
  self.status = status;
  self.pendingResolve(@{
    @"status": status,
    @"elapsedMs": @(llround(elapsedMs)),
  });
  self.pendingResolve = nil;
  self.pendingReject = nil;
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey,id> *)change
                       context:(void *)context
{
  if ([keyPath isEqualToString:@"timeControlStatus"] && object == self.player) {
    AVPlayerTimeControlStatus timeStatus = self.player.timeControlStatus;
    RCTLogInfo(@"[RoastStreamPlayer] time_control_status %ld reason=%@", (long)timeStatus, [self waitingReasonString]);
    return;
  }

  if (object == self.player.currentItem && (
      [keyPath isEqualToString:@"loadedTimeRanges"] ||
      [keyPath isEqualToString:@"playbackLikelyToKeepUp"] ||
      [keyPath isEqualToString:@"playbackBufferEmpty"] ||
      [keyPath isEqualToString:@"playbackBufferFull"])) {
    [self logItemBufferState:keyPath];
    return;
  }

  if ([keyPath isEqualToString:@"status"] && object == self.player.currentItem) {
    AVPlayerItemStatus itemStatus = self.player.currentItem.status;
    RCTLogInfo(@"[RoastStreamPlayer] item_status %ld error=%@", (long)itemStatus, self.player.currentItem.error.localizedDescription);
    if (itemStatus == AVPlayerItemStatusFailed) {
      NSError *error = self.player.currentItem.error;
      self.status = @"failed";
      self.lastError = error.localizedDescription ?: @"native_stream_item_failed";
      if (self.pendingReject) {
        self.pendingReject(@"native_stream_item_failed", self.lastError, error);
        self.pendingResolve = nil;
        self.pendingReject = nil;
      }
    } else if (itemStatus == AVPlayerItemStatusReadyToPlay) {
      self.status = @"ready";
      [self.player play];
    }
    return;
  }

  [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}

- (NSString *)waitingReasonString
{
  if (!self.player) return nil;
  if (@available(iOS 10.0, *)) {
    AVPlayerWaitingReason reason = self.player.reasonForWaitingToPlay;
    if (!reason) return nil;
    return reason;
  }
  return nil;
}

- (void)logItemBufferState:(NSString *)source
{
  AVPlayerItem *item = self.player.currentItem;
  if (!item) return;

  NSMutableArray<NSString *> *ranges = [NSMutableArray array];
  for (NSValue *value in item.loadedTimeRanges) {
    CMTimeRange range = [value CMTimeRangeValue];
    Float64 start = CMTimeGetSeconds(range.start);
    Float64 duration = CMTimeGetSeconds(range.duration);
    if (isfinite(start) && isfinite(duration)) {
      [ranges addObject:[NSString stringWithFormat:@"%.3f+%.3f", start, duration]];
    }
  }

  Float64 currentTime = CMTimeGetSeconds(item.currentTime);
  RCTLogInfo(
    @"[RoastStreamPlayer] buffer_state source=%@ current=%.3f ranges=%@ likely=%d empty=%d full=%d reason=%@",
    source,
    isfinite(currentTime) ? currentTime : -1,
    [ranges componentsJoinedByString:@","],
    item.playbackLikelyToKeepUp,
    item.playbackBufferEmpty,
    item.playbackBufferFull,
    [self waitingReasonString]
  );
}

- (void)playerItemDidFail:(NSNotification *)notification
{
  NSError *error = notification.userInfo[AVPlayerItemFailedToPlayToEndTimeErrorKey];
  self.status = @"failed";
  self.lastError = error.localizedDescription ?: @"native_stream_failed";
  if (self.pendingReject) {
    self.pendingReject(@"native_stream_failed", self.lastError, error);
    self.pendingResolve = nil;
    self.pendingReject = nil;
  }
}

- (void)cleanupPlayer
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  if (self.observingPlayer && self.player) {
    [self.player removeObserver:self forKeyPath:@"timeControlStatus"];
  }
  if (self.observingItem && self.player.currentItem) {
    [self.player.currentItem removeObserver:self forKeyPath:@"status"];
    [self.player.currentItem removeObserver:self forKeyPath:@"loadedTimeRanges"];
    [self.player.currentItem removeObserver:self forKeyPath:@"playbackLikelyToKeepUp"];
    [self.player.currentItem removeObserver:self forKeyPath:@"playbackBufferEmpty"];
    [self.player.currentItem removeObserver:self forKeyPath:@"playbackBufferFull"];
  }
  self.observingPlayer = NO;
  self.observingItem = NO;
  if (self.timeObserver && self.player) {
    [self.player removeTimeObserver:self.timeObserver];
  }
  self.timeObserver = nil;
  [self.player pause];
  self.player = nil;
  self.pendingResolve = nil;
  self.pendingReject = nil;
}

@end
