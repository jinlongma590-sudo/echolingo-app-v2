Pod::Spec.new do |s|
  s.name = 'JitsiWebRTC'
  s.version = '124.0.2'
  s.summary = 'WebRTC build provided by Jitsi'
  s.description = 'Local vendored Jitsi WebRTC build for iOS simulator and device builds.'
  s.homepage = 'https://github.com/jitsi/webrtc'
  s.license = { :type => 'BSD' }
  s.authors = 'The WebRTC project authors'
  s.source = { :path => '.' }
  s.platforms = { :ios => '12.0', :osx => '13.0' }
  s.vendored_frameworks = 'WebRTC.xcframework'
end
