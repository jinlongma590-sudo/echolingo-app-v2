internal import Expo
import React
import ReactAppDependencyProvider
#if canImport(WebRTC)
import WebRTC
#endif

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
#if targetEnvironment(simulator)
    configureSimulatorWebRTCAudio()
#endif

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func configureSimulatorWebRTCAudio() {
#if canImport(WebRTC)
    // The iOS simulator audio stack can abort when WebRTC auto-starts playout
    // during setRemoteDescription. Keep signaling and tracks alive, but leave
    // simulator playout disabled so direct /speaking/v2/call no longer crashes.
    let audioSession = RTCAudioSession.sharedInstance()
    audioSession.useManualAudio = true
    audioSession.isAudioEnabled = false
#endif
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    directMetroBundleURL()
      ?? RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
      ?? fallbackMetroBundleURL()
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

  private func directMetroBundleURL() -> URL? {
    let provider = RCTBundleURLProvider.sharedSettings()

    if let jsLocation = provider.jsLocation?.trimmingCharacters(in: .whitespacesAndNewlines),
       !jsLocation.isEmpty,
       let url = metroBundleURL(hostPort: jsLocation) {
      NSLog("[EchoLingoV2] Using Metro bundle URL from jsLocation=%@", jsLocation)
      return url
    }

    if let ipFileUrl = Bundle.main.url(forResource: "ip", withExtension: "txt"),
       let ipAddress = try? String(contentsOf: ipFileUrl, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines),
       !ipAddress.isEmpty,
       let url = metroBundleURL(hostPort: "\(ipAddress):8081") {
      NSLog("[EchoLingoV2] Using Metro bundle URL from ip.txt=%@", ipAddress)
      return url
    }

    return nil
  }

  private func metroBundleURL(hostPort: String) -> URL? {
    let normalizedHostPort = hostPort.contains(":") ? hostPort : "\(hostPort):8081"
    var components = URLComponents(string: "http://\(normalizedHostPort)")
    components?.path = "/.expo/.virtual-metro-entry.bundle"
    components?.queryItems = [
      URLQueryItem(name: "platform", value: "ios"),
      URLQueryItem(name: "dev", value: "true"),
      URLQueryItem(name: "lazy", value: "true"),
      URLQueryItem(name: "minify", value: "false"),
      URLQueryItem(name: "inlineSourceMap", value: "false"),
      URLQueryItem(name: "modulesOnly", value: "false"),
      URLQueryItem(name: "runModule", value: "true"),
    ]

    if let bundleIdentifier = Bundle.main.bundleIdentifier {
      components?.queryItems?.append(URLQueryItem(name: "app", value: bundleIdentifier))
    }

    return components?.url
  }

  private func fallbackMetroBundleURL() -> URL? {
    // Expo localhost mode can resolve to the IPv6 loopback on macOS. Keep the
    // simulator fallback on `localhost` so the native bundle URL matches Metro.
    NSLog("[EchoLingoV2] Falling back to localhost Metro bundle URL")
    return metroBundleURL(hostPort: "localhost:8081")
  }
}
