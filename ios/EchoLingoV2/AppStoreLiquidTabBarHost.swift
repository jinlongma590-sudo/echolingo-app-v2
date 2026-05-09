import Foundation
import SwiftUI
import React

@objc(AppStoreLiquidTabBarHost)
final class AppStoreLiquidTabBarHost: UIView {
  @objc var items: NSArray = [] {
    didSet { updateItems() }
  }

  @objc var selectedIndex: NSNumber = 0 {
    didSet {
      viewModel.selectedIndex = selectedIndex.intValue
    }
  }

  @objc var accentColor: NSString = "#F5A623" {
    didSet { viewModel.accentColor = Color(uiColor: UIColor(hexString: accentColor as String) ?? .systemOrange) }
  }

  @objc var placement: NSString = "bottom" {
    didSet { updateMetricsIfNeeded() }
  }

  @objc var onTabPress: RCTBubblingEventBlock?
  @objc var onMetricsChange: RCTBubblingEventBlock?

  private let viewModel = AppStoreLiquidTabBarViewModel()
  private lazy var hostingController = UIHostingController(rootView: AppStoreLiquidTabBarView(model: viewModel))
  private var lastMetricsPayload: [String: CGFloat] = [:]
  private var hitFrame: CGRect = .zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
    viewModel.onSelect = { [weak self] index in
      self?.onTabPress?(["index": index])
    }
    setupHosting()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    backgroundColor = .clear
    isOpaque = false
    viewModel.onSelect = { [weak self] index in
      self?.onTabPress?(["index": index])
    }
    setupHosting()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController.view.frame = bounds
    updateMetricsIfNeeded()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    updateMetricsIfNeeded()
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    hitFrame.contains(point)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard self.point(inside: point, with: event) else {
      return nil
    }

    let convertedPoint = convert(point, to: hostingController.view)
    return hostingController.view.hitTest(convertedPoint, with: event) ?? super.hitTest(point, with: event)
  }

  private func setupHosting() {
    let hostedView = hostingController.view!
    hostedView.backgroundColor = .clear
    hostedView.isOpaque = false
    hostedView.isUserInteractionEnabled = true
    hostedView.translatesAutoresizingMaskIntoConstraints = true
    clipsToBounds = false
    addSubview(hostedView)
  }

  private func updateItems() {
    viewModel.items = (items as? [[String: Any]])?.map { dict in
      AppStoreLiquidTabBarItem(
        id: dict["key"] as? String ?? UUID().uuidString,
        title: dict["title"] as? String ?? "",
        systemImage: dict["iconName"] as? String ?? "circle.fill",
        badgeText: dict["badgeText"] as? String,
        showsDot: dict["showsDot"] as? Bool ?? false
      )
    } ?? []
    updateMetricsIfNeeded()
  }

  private func updateMetricsIfNeeded() {
    guard bounds.width > 0, bounds.height > 0 else { return }
    let windowSafeAreaTop = window?.safeAreaInsets.top ?? superview?.safeAreaInsets.top ?? safeAreaInsets.top
    let windowSafeAreaBottom = window?.safeAreaInsets.bottom ?? superview?.safeAreaInsets.bottom ?? safeAreaInsets.bottom
    let metrics = Self.makeMetrics(
      width: bounds.width,
      safeAreaTop: windowSafeAreaTop,
      safeAreaBottom: windowSafeAreaBottom,
      tabCount: viewModel.items.count,
      placement: placement as String
    )
    viewModel.metrics = metrics
    viewModel.selectedIndex = selectedIndex.intValue
    viewModel.accentColor = Color(uiColor: UIColor(hexString: accentColor as String) ?? .systemOrange)

    hitFrame = CGRect(
      x: placement as String == "top" ? 0 : (bounds.width - metrics.width) / 2,
      y: placement as String == "top" ? 0 : max(bounds.height - metrics.height - metrics.bottomOffset, 0),
      width: metrics.width,
      height: metrics.height
    )

    let payload: [String: CGFloat] = [
      "height": metrics.height,
      "bottomOffset": metrics.bottomOffset,
      "topOffset": metrics.topOffset,
      "pageInset": metrics.pageInset,
      "reservedTopInset": metrics.reservedTopInset,
      "reservedBottomInset": metrics.reservedBottomInset,
      "width": metrics.width,
    ]

    if payload != lastMetricsPayload {
      lastMetricsPayload = payload
      onMetricsChange?([
        "placement": placement,
        "height": metrics.height,
        "bottomOffset": metrics.bottomOffset,
        "topOffset": metrics.topOffset,
        "pageInset": metrics.pageInset,
        "reservedTopInset": metrics.reservedTopInset,
        "reservedBottomInset": metrics.reservedBottomInset,
        "width": metrics.width,
      ])
    }
  }

  private static func makeMetrics(
    width: CGFloat,
    safeAreaTop: CGFloat,
    safeAreaBottom: CGFloat,
    tabCount: Int,
    placement: String
  ) -> AppStoreLiquidTabBarMetrics {
    let outerHorizontalMargin: CGFloat = 24
    let topPlacement = placement == "top"
    let tabBarWidth = topPlacement
      ? width
      : min(404, max(320, width - outerHorizontalMargin * 2))
    let visibleHeight: CGFloat = topPlacement ? 52 : 76
    let tabBarRadius: CGFloat = topPlacement ? 26 : 38
    let insetX: CGFloat = 12
    let insetY: CGFloat = topPlacement ? 5 : 9
    let resolvedTabCount = CGFloat(max(tabCount, 1))
    let contentWidth = tabBarWidth - insetX * 2
    let slotWidth = contentWidth / resolvedTabCount
    let activePillWidth = min(max(slotWidth * 0.92, 76), min(slotWidth + 4, 88))
    let activePillHeight: CGFloat = topPlacement ? 42 : 58
    let activePillRadius = min(activePillHeight, activePillWidth) / 2
    let topOffset = topPlacement ? max(safeAreaTop + 6, 6) : 0
    let reservedTopInset = topPlacement ? min(max(safeAreaTop + visibleHeight + 12, 84), 92) : 0
    let bottomOffset = topPlacement ? 0 : max(safeAreaBottom - 10, 18)
    let reservedBottomInset = topPlacement ? 0 : bottomOffset + visibleHeight
    let pageInset = topPlacement ? reservedTopInset : reservedBottomInset

    return AppStoreLiquidTabBarMetrics(
      width: tabBarWidth,
      height: visibleHeight,
      radius: tabBarRadius,
      bottomOffset: bottomOffset,
      topOffset: topOffset,
      insetX: insetX,
      insetY: insetY,
      slotWidth: slotWidth,
      activePillWidth: activePillWidth,
      activePillHeight: activePillHeight,
      activePillRadius: activePillRadius,
      reservedTopInset: reservedTopInset,
      reservedBottomInset: reservedBottomInset,
      pageInset: pageInset
    )
  }
}

@objc(AppStoreLiquidTabBarManager)
final class AppStoreLiquidTabBarManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    AppStoreLiquidTabBarHost()
  }
}

@objc(TopLiquidTabBarHost)
final class TopLiquidTabBarHost: UIView {
  @objc var items: NSArray = [] {
    didSet { updateItems() }
  }

  @objc var selectedIndex: NSNumber = 0 {
    didSet {
      viewModel.selectedIndex = selectedIndex.intValue
    }
  }

  @objc var accentColor: NSString = "#0A84FF" {
    didSet { viewModel.accentColor = Color(uiColor: UIColor(hexString: accentColor as String) ?? .systemBlue) }
  }

  @objc var placement: NSString = "top" {
    didSet { updateMetricsIfNeeded() }
  }

  @objc var onTabPress: RCTBubblingEventBlock?
  @objc var onMetricsChange: RCTBubblingEventBlock?

  private let viewModel = TopLiquidTabBarViewModel()
  private lazy var hostingController = UIHostingController(rootView: TopLiquidTabBarView(model: viewModel))
  private var lastMetricsPayload: [String: CGFloat] = [:]
  private var hitFrame: CGRect = .zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
    viewModel.onSelect = { [weak self] index in
      self?.onTabPress?(["index": index])
    }
    setupHosting()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    backgroundColor = .clear
    isOpaque = false
    viewModel.onSelect = { [weak self] index in
      self?.onTabPress?(["index": index])
    }
    setupHosting()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController.view.frame = bounds
    updateMetricsIfNeeded()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    updateMetricsIfNeeded()
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    hitFrame.contains(point)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard self.point(inside: point, with: event) else {
      return nil
    }

    let convertedPoint = convert(point, to: hostingController.view)
    return hostingController.view.hitTest(convertedPoint, with: event) ?? super.hitTest(point, with: event)
  }

  private func setupHosting() {
    let hostedView = hostingController.view!
    hostedView.backgroundColor = .clear
    hostedView.isOpaque = false
    hostedView.isUserInteractionEnabled = true
    hostedView.translatesAutoresizingMaskIntoConstraints = true
    clipsToBounds = false
    addSubview(hostedView)
  }

  private func updateItems() {
    viewModel.items = (items as? [[String: Any]])?.map { dict in
      AppStoreLiquidTabBarItem(
        id: dict["key"] as? String ?? UUID().uuidString,
        title: dict["title"] as? String ?? "",
        systemImage: dict["iconName"] as? String ?? "circle.fill",
        badgeText: dict["badgeText"] as? String,
        showsDot: dict["showsDot"] as? Bool ?? false
      )
    } ?? []
    updateMetricsIfNeeded()
  }

  private func updateMetricsIfNeeded() {
    guard bounds.width > 0, bounds.height > 0 else { return }
    let windowSafeAreaTop = window?.safeAreaInsets.top ?? superview?.safeAreaInsets.top ?? safeAreaInsets.top
    let windowSafeAreaBottom = window?.safeAreaInsets.bottom ?? superview?.safeAreaInsets.bottom ?? safeAreaInsets.bottom
    let screenWidth = window?.bounds.width ?? superview?.bounds.width ?? bounds.width
    let metrics = Self.makeMetrics(
      width: screenWidth,
      safeAreaTop: windowSafeAreaTop,
      safeAreaBottom: windowSafeAreaBottom,
      tabCount: viewModel.items.count
    )
    viewModel.metrics = metrics
    viewModel.selectedIndex = selectedIndex.intValue
    viewModel.accentColor = Color(uiColor: UIColor(hexString: accentColor as String) ?? .systemBlue)

    hitFrame = CGRect(
      x: max((bounds.width - metrics.width) / 2, 0),
      y: metrics.topOffset,
      width: metrics.width,
      height: metrics.height
    )

    let payload: [String: CGFloat] = [
      "height": metrics.height,
      "bottomOffset": metrics.bottomOffset,
      "topOffset": metrics.topOffset,
      "pageInset": metrics.pageInset,
      "reservedTopInset": metrics.reservedTopInset,
      "reservedBottomInset": metrics.reservedBottomInset,
      "width": metrics.width,
    ]

    if payload != lastMetricsPayload {
      lastMetricsPayload = payload
      onMetricsChange?([
        "placement": "top",
        "height": metrics.height,
        "bottomOffset": metrics.bottomOffset,
        "topOffset": metrics.topOffset,
        "pageInset": metrics.pageInset,
        "reservedTopInset": metrics.reservedTopInset,
        "reservedBottomInset": metrics.reservedBottomInset,
        "width": metrics.width,
      ])
    }
  }

  private static func makeMetrics(
    width: CGFloat,
    safeAreaTop: CGFloat,
    safeAreaBottom: CGFloat,
    tabCount: Int
  ) -> AppStoreLiquidTabBarMetrics {
    let outerHorizontalMargin: CGFloat = 16
    let visibleHeight: CGFloat = 56
    let tabBarWidth = min(max(width * 0.52, 620), min(760, width - outerHorizontalMargin * 2))
    let tabBarRadius: CGFloat = 28
    let insetX: CGFloat = 8
    let insetY: CGFloat = 5
    let resolvedTabCount = CGFloat(max(tabCount, 1))
    let contentWidth = tabBarWidth - insetX * 2
    let slotWidth = contentWidth / resolvedTabCount
    let activePillWidth = max(slotWidth - 8, 0)
    let activePillHeight: CGFloat = 46
    let activePillRadius = min(activePillHeight, activePillWidth) / 2
    let topOffset = max(safeAreaTop + 8, 8)
    let reservedTopInset = min(max(safeAreaTop + 64, 72), 82)

    return AppStoreLiquidTabBarMetrics(
      width: tabBarWidth,
      height: visibleHeight,
      radius: tabBarRadius,
      bottomOffset: 0,
      topOffset: topOffset,
      insetX: insetX,
      insetY: insetY,
      slotWidth: slotWidth,
      activePillWidth: activePillWidth,
      activePillHeight: activePillHeight,
      activePillRadius: activePillRadius,
      reservedTopInset: reservedTopInset,
      reservedBottomInset: 0,
      pageInset: reservedTopInset
    )
  }
}

@objc(TopLiquidTabBarManager)
final class TopLiquidTabBarManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    TopLiquidTabBarHost()
  }
}

private extension UIColor {
  convenience init?(hexString: String) {
    var value = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("#") {
      value.removeFirst()
    }

    guard value.count == 6, let hex = Int(value, radix: 16) else {
      return nil
    }

    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255,
      green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255,
      alpha: 1
    )
  }
}
