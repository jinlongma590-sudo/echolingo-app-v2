Pod::Spec.new do |s|
  s.name = 'libavif'
  s.version = '1.0.0'
  s.summary = 'libavif - Library for encoding and decoding .avif files'
  s.description = <<-DESC
    This library aims to be a friendly, portable C implementation of the AV1 Image File Format.
  DESC
  s.homepage = 'https://github.com/joedrago/avif/'
  s.license = { :type => 'BSD' }
  s.author = { 'Joe Drago' => 'joedrago@gmail.com' }
  s.source = { :path => '.' }
  s.platforms = {
    :ios => '9.0',
    :osx => '10.10',
    :tvos => '9.0',
    :watchos => '2.0',
  }
  s.prepare_command = <<-CMD
    sed -i '' 's/\\"rav1e\\/rav1e.h\\"/\\"librav1e\\/rav1e.h\\"/g' './src/codec_rav1e.c' || true
    sed -i '' 's/\\"rav1e.h\\"/\\"librav1e\\/rav1e.h\\"/g' './src/codec_rav1e.c' || true
  CMD
  s.default_subspecs = 'libaom'
  s.preserve_paths = ['src', 'include/avif']

  s.subspec 'core' do |ss|
    ss.source_files = ['src/**/*.{h,c,cc}', 'include/avif/*.h']
    ss.public_header_files = 'include/avif/*.h'
    ss.header_mappings_dir = 'include'
    ss.exclude_files = 'src/codec_*.c'
    ss.pod_target_xcconfig = {
      'HEADER_SEARCH_PATHS' => '$(inherited) $(PODS_ROOT)/libavif/include $(PODS_TARGET_SRCROOT)/include'
    }
  end

  s.subspec 'libaom' do |ss|
    ss.dependency 'libavif/core'
    ss.dependency 'libaom', '>= 3.0.0'
    ss.source_files = 'src/codec_aom.c'
    ss.pod_target_xcconfig = {
      'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/libaom/aom',
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) AVIF_CODEC_AOM=1 AVIF_CODEC_AOM_DECODE=1 AVIF_CODEC_AOM_ENCODE=1'
    }
  end

  s.subspec 'libdav1d' do |ss|
    ss.dependency 'libavif/core'
    ss.dependency 'libdav1d', '>= 0.6.0'
    ss.source_files = 'src/codec_dav1d.c'
    ss.pod_target_xcconfig = {
      'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/libdav1d/dav1d/include',
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) AVIF_CODEC_DAV1D=1 AVIF_CODEC_AOM_DECODE=0'
    }
  end

  s.subspec 'libgav1' do |ss|
    ss.dependency 'libavif/core'
    ss.dependency 'libgav1', '>= 0.16.3'
    ss.source_files = 'src/codec_libgav1.c'
    ss.pod_target_xcconfig = {
      'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/libgav1/include',
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) AVIF_CODEC_LIBGAV1=1 AVIF_CODEC_AOM_DECODE=0'
    }
  end

  s.subspec 'librav1e' do |ss|
    ss.dependency 'libavif/core'
    ss.dependency 'librav1e', '>= 0.3.0'
    ss.source_files = 'src/codec_rav1e.c'
    ss.pod_target_xcconfig = {
      'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/librav1e/rav1e/include',
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) AVIF_CODEC_RAV1E=1 AVIF_CODEC_AOM_ENCODE=0'
    }
    ss.ios.deployment_target = '9.0'
    ss.osx.deployment_target = '10.10'
  end

  s.subspec 'svt-av1' do |ss|
    ss.dependency 'libavif/core'
    ss.dependency 'svt-av1', '>= 0.8.7'
    ss.source_files = 'src/codec_svt.c'
    ss.pod_target_xcconfig = {
      'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/svt-av1/include',
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) AVIF_CODEC_SVT=1 AVIF_CODEC_AOM_ENCODE=0'
    }
  end

  s.subspec 'sharpyuv' do |ss|
    ss.dependency 'libwebp', '>= 1.2.3'
    ss.pod_target_xcconfig = {
      'HEADER_SEARCH_PATHS' => '$(inherited) ${PODS_ROOT}/libwebp',
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) AVIF_LIBSHARPYUV_ENABLED=1'
    }
  end
end
