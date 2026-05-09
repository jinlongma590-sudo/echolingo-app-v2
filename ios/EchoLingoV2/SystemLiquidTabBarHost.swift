import UIKit
import React

@objc(SystemLiquidTabBarHost)
final class SystemLiquidTabBarHost: UIView, UITabBarDelegate {
  @objc var items: NSArray = [] {
    didSet { updateItems() }
  }

  @objc var selectedIndex: NSNumber = 0 {
    didSet { syncSelectedItem() }
  }

  @objc var accentColor: NSString = "#F5A623" {
    didSet { updateAppearance() }
  }

  @objc var placement: NSString = "bottom" {
    didSet {
      updateItems()
      updateMetricsIfNeeded()
    }
  }

  @objc var onTabPress: RCTBubblingEventBlock?
  @objc var onMetricsChange: RCTBubblingEventBlock?

  private let tabBar = UITabBar(frame: .zero)
  private let topBackgroundView = UIVisualEffectView(effect: nil)
  private let topSelectedPillView = UIView(frame: .zero)
  private let topSelectedPillInnerStrokeView = UIView(frame: .zero)
  private var currentItems: [UITabBarItem] = []
  private var lastMetricsPayload: [String: CGFloat] = [:]
  private var hitFrame: CGRect = .zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateMetricsIfNeeded()
    topBackgroundView.frame = hitFrame
    tabBar.frame = hitFrame
    tabBar.layer.cornerRadius = isTopPlacement ? 24 : tabBar.bounds.height / 2
    tabBar.layer.cornerCurve = .continuous
    topBackgroundView.layer.cornerRadius = isTopPlacement ? 24 : tabBar.bounds.height / 2
    topBackgroundView.layer.cornerCurve = .continuous
    topSelectedPillInnerStrokeView.frame = topSelectedPillView.bounds.insetBy(dx: 1, dy: 1)
    topSelectedPillInnerStrokeView.layer.cornerRadius = max((topSelectedPillView.bounds.height - 2) / 2, 0)
    updateTopSelectedPillFrame(animated: false)
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    updateMetricsIfNeeded()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    updateAppearance()
    updateTopDecorationAppearance()
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    hitFrame.contains(point)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard self.point(inside: point, with: event) else {
      return nil
    }

    let convertedPoint = convert(point, to: tabBar)
    return tabBar.hitTest(convertedPoint, with: event) ?? super.hitTest(point, with: event)
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    let index = item.tag
    onTabPress?(["index": index])
  }

  private func commonInit() {
    backgroundColor = .clear
    isOpaque = false
    clipsToBounds = false

    topBackgroundView.backgroundColor = .clear
    topBackgroundView.isUserInteractionEnabled = false
    topBackgroundView.clipsToBounds = true
    topBackgroundView.layer.masksToBounds = true

    topSelectedPillView.isUserInteractionEnabled = false
    topSelectedPillView.clipsToBounds = false
    topSelectedPillView.layer.masksToBounds = false
    topSelectedPillView.layer.cornerCurve = .continuous
    topSelectedPillView.layer.borderWidth = 1

    topSelectedPillInnerStrokeView.isUserInteractionEnabled = false
    topSelectedPillInnerStrokeView.backgroundColor = .clear
    topSelectedPillInnerStrokeView.layer.borderWidth = 0.5
    topSelectedPillInnerStrokeView.layer.cornerCurve = .continuous
    topSelectedPillView.addSubview(topSelectedPillInnerStrokeView)

    tabBar.backgroundColor = .clear
    tabBar.isTranslucent = true
    tabBar.delegate = self
    tabBar.itemPositioning = .fill
    tabBar.clipsToBounds = false
    tabBar.layer.masksToBounds = false

    addSubview(topBackgroundView)
    addSubview(topSelectedPillView)
    addSubview(tabBar)
    updateAppearance()
    updateTopDecorationAppearance()
  }

  private func updateAppearance() {
    let appearance = UITabBarAppearance()
    appearance.configureWithTransparentBackground()
    appearance.backgroundColor = .clear
    appearance.backgroundEffect = isTopPlacement ? nil : UIBlurEffect(style: .systemChromeMaterial)
    appearance.shadowColor = .clear
    appearance.shadowImage = nil

    let selectedColor = UIColor(hexString: accentColor as String) ?? .systemBlue
    let normalColor = UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.92, alpha: 0.78)
        : UIColor(red: 15 / 255, green: 23 / 255, blue: 42 / 255, alpha: 0.72)
    }

    let stacked = appearance.stackedLayoutAppearance
    stacked.normal.iconColor = normalColor
    stacked.normal.titleTextAttributes = [
      .foregroundColor: normalColor,
      .font: UIFont.systemFont(ofSize: 10, weight: isTopPlacement ? .medium : .semibold),
    ]
    stacked.selected.iconColor = selectedColor
    stacked.selected.titleTextAttributes = [
      .foregroundColor: selectedColor,
      .font: UIFont.systemFont(ofSize: 10, weight: .semibold),
    ]

    appearance.inlineLayoutAppearance = stacked
    appearance.compactInlineLayoutAppearance = stacked

    tabBar.tintColor = selectedColor
    tabBar.unselectedItemTintColor = normalColor
    tabBar.standardAppearance = appearance
    if #available(iOS 15.0, *) {
      tabBar.scrollEdgeAppearance = appearance
    }

    updateTopDecorationAppearance()
  }

  private func updateItems() {
    let topPlacement = placement as String == "top"
    let symbolConfiguration = UIImage.SymbolConfiguration(pointSize: topPlacement ? 18 : 15, weight: .semibold)
    currentItems = (items as? [[String: Any]])?.enumerated().map { index, dict in
      let title = dict["title"] as? String ?? ""
      let iconName = dict["iconName"] as? String ?? "circle.fill"
      let baseImage = UIImage(systemName: iconName)
      let configuredImage = baseImage?.applyingSymbolConfiguration(symbolConfiguration)
      let tabBarItem = UITabBarItem(
        title: title,
        image: configuredImage,
        selectedImage: configuredImage
      )
      tabBarItem.tag = index
      tabBarItem.imageInsets = topPlacement
        ? UIEdgeInsets(top: -3, left: 0, bottom: 3, right: 0)
        : UIEdgeInsets(top: -7, left: 0, bottom: 7, right: 0)
      tabBarItem.titlePositionAdjustment = topPlacement
        ? UIOffset(horizontal: 0, vertical: 4)
        : UIOffset(horizontal: 0, vertical: 8)

      if let badgeText = dict["badgeText"] as? String, !badgeText.isEmpty {
        tabBarItem.badgeValue = badgeText
      } else if dict["showsDot"] as? Bool == true {
        tabBarItem.badgeValue = ""
      } else {
        tabBarItem.badgeValue = nil
      }

      return tabBarItem
    } ?? []

      tabBar.items = currentItems
    syncSelectedItem()
    updateMetricsIfNeeded()
  }

  private func syncSelectedItem() {
    guard !currentItems.isEmpty else {
      tabBar.selectedItem = nil
      return
    }

    let index = min(max(selectedIndex.intValue, 0), currentItems.count - 1)
    tabBar.selectedItem = currentItems[index]
    updateTopSelectedPillFrame(animated: true)
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
      tabCount: currentItems.count,
      placement: placement as String
    )

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

    updateTopDecorationAppearance()
    updateTopSelectedPillFrame(animated: false)
  }

  private var isTopPlacement: Bool {
    placement as String == "top"
  }

  private func updateTopDecorationAppearance() {
    let topPlacement = isTopPlacement
    topBackgroundView.isHidden = !topPlacement
    topSelectedPillView.isHidden = !topPlacement

    guard topPlacement else {
      topBackgroundView.effect = nil
      topBackgroundView.layer.borderWidth = 0
      topBackgroundView.layer.shadowOpacity = 0
      topSelectedPillView.layer.shadowOpacity = 0
      return
    }

    let darkMode = traitCollection.userInterfaceStyle == .dark
    topBackgroundView.effect = UIBlurEffect(style: .systemThinMaterial)
    topBackgroundView.contentView.backgroundColor = darkMode
      ? UIColor(white: 1, alpha: 0.04)
      : UIColor(white: 1, alpha: 0.08)
    topBackgroundView.layer.borderWidth = 1
    topBackgroundView.layer.borderColor = (darkMode
      ? UIColor(white: 1, alpha: 0.10)
      : UIColor(white: 1, alpha: 0.55)).cgColor
    topSelectedPillView.backgroundColor = darkMode
      ? UIColor(white: 1, alpha: 0.16)
      : UIColor(white: 1, alpha: 0.90)
    topSelectedPillView.layer.borderColor = (darkMode
      ? UIColor(white: 1, alpha: 0.12)
      : UIColor(white: 1, alpha: 0.55)).cgColor
    topSelectedPillView.layer.shadowColor = UIColor.black.cgColor
    topSelectedPillView.layer.shadowOpacity = darkMode ? 0.18 : 0.08
    topSelectedPillView.layer.shadowRadius = darkMode ? 16 : 14
    topSelectedPillView.layer.shadowOffset = CGSize(width: 0, height: darkMode ? 8 : 6)
    topSelectedPillView.layer.shadowPath = UIBezierPath(
      roundedRect: topSelectedPillView.bounds,
      cornerRadius: topSelectedPillView.layer.cornerRadius
    ).cgPath

    topSelectedPillInnerStrokeView.layer.borderColor = (darkMode
      ? UIColor(white: 1, alpha: 0.08)
      : UIColor(white: 1, alpha: 0.32)).cgColor
  }

  private func updateTopSelectedPillFrame(animated: Bool) {
    guard isTopPlacement, !currentItems.isEmpty else {
      topSelectedPillView.frame = .zero
      return
    }

    let metrics = Self.makeMetrics(
      width: window?.bounds.width ?? superview?.bounds.width ?? bounds.width,
      safeAreaTop: window?.safeAreaInsets.top ?? superview?.safeAreaInsets.top ?? safeAreaInsets.top,
      safeAreaBottom: window?.safeAreaInsets.bottom ?? superview?.safeAreaInsets.bottom ?? safeAreaInsets.bottom,
      tabCount: currentItems.count,
      placement: placement as String
    )
    let index = min(max(selectedIndex.intValue, 0), currentItems.count - 1)
    let pillX = hitFrame.minX
      + metrics.insetX
      + CGFloat(index) * metrics.slotWidth
      + (metrics.slotWidth - metrics.activePillWidth) / 2
    let pillY = hitFrame.minY + (metrics.height - metrics.activePillHeight) / 2
    let nextFrame = CGRect(x: pillX, y: pillY, width: metrics.activePillWidth, height: metrics.activePillHeight).integral

    let updates = {
      self.topSelectedPillView.frame = nextFrame
      self.topSelectedPillView.layer.cornerRadius = nextFrame.height / 2
      self.topSelectedPillInnerStrokeView.frame = self.topSelectedPillView.bounds.insetBy(dx: 1, dy: 1)
      self.topSelectedPillInnerStrokeView.layer.cornerRadius = self.topSelectedPillInnerStrokeView.bounds.height / 2
      self.updateTopDecorationAppearance()
    }

    if animated {
      UIView.animate(
        withDuration: 0.28,
        delay: 0,
        usingSpringWithDamping: 0.86,
        initialSpringVelocity: 0.25,
        options: [.beginFromCurrentState, .allowUserInteraction]
      ) {
        updates()
      }
    } else {
      updates()
    }
  }

  private static func makeMetrics(
    width: CGFloat,
    safeAreaTop: CGFloat,
    safeAreaBottom: CGFloat,
    tabCount: Int,
    placement: String
  ) -> AppStoreLiquidTabBarMetrics {
    let topPlacement = placement == "top"
    let outerHorizontalMargin: CGFloat = 12
    let topMaxWidth = min(CGFloat(660), width - 32)
    let topPreferredWidth = max(width * 0.46, 620)
    let tabBarWidth = topPlacement
      ? min(max(topPreferredWidth, 620), topMaxWidth)
      : min(446, max(320, width - outerHorizontalMargin * 2))
    let visibleHeight: CGFloat = topPlacement ? 48 : 86
    let tabBarRadius: CGFloat = topPlacement ? 24 : 43
    let insetX: CGFloat = 12
    let insetY: CGFloat = topPlacement ? 4 : 9
    let resolvedTabCount = CGFloat(max(tabCount, 1))
    let contentWidth = tabBarWidth - insetX * 2
    let slotWidth = contentWidth / resolvedTabCount
    let activePillWidth = min(max(slotWidth * 0.92, 76), min(slotWidth + 4, 88))
    let activePillHeight: CGFloat = topPlacement ? 40 : 58
    let activePillRadius = min(activePillHeight, activePillWidth) / 2
    let topOffset = topPlacement ? max(safeAreaTop + 6, 6) : 0
    let reservedTopInset = topPlacement ? min(max(safeAreaTop + visibleHeight + 10, 72), 80) : 0
    let bottomOffset = topPlacement ? 0 : max(safeAreaBottom - 16, -8)
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

@objc(SystemLiquidTabBarManager)
final class SystemLiquidTabBarManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    SystemLiquidTabBarHost()
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
