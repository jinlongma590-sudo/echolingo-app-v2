import SwiftUI

struct AppStoreLiquidTabBarItem: Identifiable, Equatable {
  let id: String
  let title: String
  let systemImage: String
  let badgeText: String?
  let showsDot: Bool
}

struct AppStoreLiquidTabBarMetrics: Equatable {
  let width: CGFloat
  let height: CGFloat
  let radius: CGFloat
  let bottomOffset: CGFloat
  let topOffset: CGFloat
  let insetX: CGFloat
  let insetY: CGFloat
  let slotWidth: CGFloat
  let activePillWidth: CGFloat
  let activePillHeight: CGFloat
  let activePillRadius: CGFloat
  let reservedTopInset: CGFloat
  let reservedBottomInset: CGFloat
  let pageInset: CGFloat

  static let `default` = AppStoreLiquidTabBarMetrics(
    width: 380,
    height: 76,
    radius: 38,
    bottomOffset: 6,
    topOffset: 0,
    insetX: 12,
    insetY: 9,
    slotWidth: 71.2,
    activePillWidth: 78,
    activePillHeight: 58,
    activePillRadius: 29,
    reservedTopInset: 0,
    reservedBottomInset: 94,
    pageInset: 94
  )
}

final class AppStoreLiquidTabBarViewModel: ObservableObject {
  @Published var items: [AppStoreLiquidTabBarItem] = []
  @Published var selectedIndex: Int = 0
  @Published var accentColor: Color = .orange
  @Published var metrics: AppStoreLiquidTabBarMetrics = .default

  var onSelect: ((Int) -> Void)?
}

struct AppStoreLiquidTabBarView: View {
  @ObservedObject var model: AppStoreLiquidTabBarViewModel
  @Namespace private var glassNamespace

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .bottom) {
        Color.clear

        tabBarBody
          .frame(width: model.metrics.width, height: model.metrics.height)
      }
      .frame(width: proxy.size.width, height: proxy.size.height)
      .background(Color.clear)
    }
  }

  @ViewBuilder
  private var tabBarBody: some View {
    if #available(iOS 26.0, *) {
      modernGlassTabBar
    } else {
      fallbackTabBar
    }
  }

  @available(iOS 26.0, *)
  private var modernGlassTabBar: some View {
    let metrics = model.metrics
    let compactTopPlacement = isCompactTopPlacement

    return ZStack(alignment: .topLeading) {
      largeCapsuleSurface
        .frame(width: metrics.width, height: metrics.height)
        .zIndex(0)

      activePillView(.clear.interactive(false))
        .frame(width: metrics.activePillWidth, height: metrics.activePillHeight)
        .matchedGeometryEffect(id: "active-pill-material", in: glassNamespace)
        .offset(x: activePillX, y: activePillY)
        .zIndex(2)

      buttonContentRow(iconColor: inactiveColor)
        .frame(width: contentWidth, height: metrics.height)
        .offset(x: metrics.insetX, y: 0)
        .zIndex(10)
    }
    .frame(width: metrics.width, height: metrics.height)
    .offset(y: compactTopPlacement ? 1 : 4)
    .animation(.spring(response: 0.5, dampingFraction: 0.86, blendDuration: 0.18), value: clampedSelectedIndex)
  }

  private var fallbackTabBar: some View {
    let metrics = model.metrics
    let compactTopPlacement = isCompactTopPlacement
    let isBottomPlacement = metrics.topOffset <= 0
    let visualBottomLift = max(metrics.bottomOffset + 2, 0)

    return ZStack(alignment: .topLeading) {
      Capsule()
        .fill(.ultraThinMaterial)
        .frame(width: metrics.width, height: metrics.height)

      Capsule()
        .fill(Color.white.opacity(0.58))
        .frame(width: metrics.activePillWidth, height: metrics.activePillHeight)
        .matchedGeometryEffect(id: "fallback-active-pill", in: glassNamespace)
        .offset(x: activePillX, y: activePillY)
        .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 8)
        .zIndex(1)

      buttonContentRow(iconColor: inactiveColor)
        .frame(width: contentWidth, height: metrics.height)
        .offset(x: metrics.insetX, y: 0)
        .zIndex(2)
    }
    .frame(width: metrics.width, height: metrics.height)
    .offset(y: isBottomPlacement ? -visualBottomLift : (compactTopPlacement ? 1 : 4))
    .animation(.easeInOut(duration: 0.28), value: clampedSelectedIndex)
  }

  @available(iOS 26.0, *)
  private func activePillView(_ _: Glass) -> some View {
    return Capsule()
      .fill(Color.white.opacity(0.28))
      .overlay {
        Capsule()
          .fill(
            LinearGradient(
              colors: [
                Color.white.opacity(0.32),
                Color.white.opacity(0.14),
                Color.white.opacity(0.06)
              ],
              startPoint: .top,
              endPoint: .bottom
            )
          )
      }
      .overlay {
        Capsule()
          .stroke(
            LinearGradient(
              colors: [
                Color.white.opacity(0.72),
                Color.white.opacity(0.28),
                Color.black.opacity(0.035)
              ],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            ),
            lineWidth: 0.85
          )
      }
      .overlay {
        Capsule()
          .stroke(Color.white.opacity(0.18), lineWidth: 0.4)
          .padding(1.2)
      }
      .shadow(color: Color.black.opacity(0.045), radius: 14, x: 0, y: 8)
  }

  @available(iOS 26.0, *)
  private var largeCapsuleSurface: some View {
    let metrics = model.metrics

    return Capsule()
      .fill(Color.white.opacity(0.022))
      .glassEffect(.regular.interactive(false), in: Capsule())
      .overlay {
        Capsule()
          .fill(
            LinearGradient(
              colors: [
                Color.white.opacity(0.085),
                Color.white.opacity(0.030),
                Color.black.opacity(0.020)
              ],
              startPoint: .top,
              endPoint: .bottom
            )
          )
      }
      .overlay {
        Capsule()
          .stroke(
            LinearGradient(
              colors: [
                Color.white.opacity(0.30),
                Color.white.opacity(0.12),
                Color.black.opacity(0.065)
              ],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            ),
            lineWidth: 0.85
          )
      }
      .overlay {
        Capsule()
          .stroke(Color.white.opacity(0.075), lineWidth: 0.45)
          .padding(1.2)
      }
      .shadow(color: Color.black.opacity(0.030), radius: 18, x: 0, y: 8)
    .frame(width: metrics.width, height: metrics.height)
  }

  private var contentWidth: CGFloat {
    let metrics = model.metrics
    return metrics.width - metrics.insetX * 2
  }

  private var activePillX: CGFloat {
    let metrics = model.metrics
    return metrics.insetX
      + CGFloat(clampedSelectedIndex) * metrics.slotWidth
      + (metrics.slotWidth - metrics.activePillWidth) / 2
  }

  private var activePillY: CGFloat {
    let metrics = model.metrics
    return (metrics.height - metrics.activePillHeight) / 2
  }

  private func buttonContentRow(iconColor: Color) -> some View {
    let compactTopPlacement = isCompactTopPlacement

    return HStack(spacing: 0) {
      ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
        let isActive = index == clampedSelectedIndex
        let foregroundColor = isActive ? model.accentColor : iconColor

        Button {
          model.onSelect?(index)
        } label: {
          VStack(spacing: compactTopPlacement ? 1 : 2) {
            Image(systemName: item.systemImage)
              .symbolRenderingMode(.monochrome)
              .font(.system(size: compactTopPlacement ? 20 : 18, weight: .semibold))
              .foregroundColor(foregroundColor)

            Text(item.title)
              .font(.system(size: 10, weight: isActive ? .semibold : .medium))
              .lineLimit(1)
              .foregroundColor(foregroundColor)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .contentShape(Rectangle())
          .overlay(alignment: .topTrailing) {
            badgeView(for: item)
              .offset(x: compactTopPlacement ? -10 : -12, y: compactTopPlacement ? 8 : 10)
          }
        }
        .buttonStyle(.plain)
        .frame(width: model.metrics.slotWidth, height: model.metrics.height)
      }
    }
    .frame(height: model.metrics.height)
  }

  @ViewBuilder
  private func badgeView(for item: AppStoreLiquidTabBarItem) -> some View {
    if let badgeText = item.badgeText, !badgeText.isEmpty {
      Text(badgeText)
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(Color.white)
        .padding(.horizontal, 6)
        .frame(height: 18)
        .background(
          Capsule().fill(Color(red: 1, green: 0.23, blue: 0.19))
        )
    } else if item.showsDot {
      Circle()
        .fill(Color(red: 1, green: 0.23, blue: 0.19))
        .frame(width: 9, height: 9)
    }
  }

  private var isCompactTopPlacement: Bool {
    model.metrics.topOffset > 0 && model.metrics.height <= 52
  }

  private var clampedSelectedIndex: Int {
    guard !model.items.isEmpty else { return 0 }
    return min(max(model.selectedIndex, 0), model.items.count - 1)
  }

private var inactiveColor: Color {
    Color(red: 0.13, green: 0.15, blue: 0.20)
  }
}

final class TopLiquidTabBarViewModel: ObservableObject {
  @Published var items: [AppStoreLiquidTabBarItem] = []
  @Published var selectedIndex: Int = 0
  @Published var accentColor: Color = .blue
  @Published var metrics: AppStoreLiquidTabBarMetrics = .default

  var onSelect: ((Int) -> Void)?
}

struct TopLiquidTabBarView: View {
  @ObservedObject var model: TopLiquidTabBarViewModel
  @Namespace private var topNamespace
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .topLeading) {
        Color.clear

        topBarBody
          .frame(width: model.metrics.width, height: model.metrics.height)
          .offset(x: max((proxy.size.width - model.metrics.width) / 2, 0), y: model.metrics.topOffset)
      }
      .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
      .background(Color.clear)
    }
  }

  private var topBarBody: some View {
    ZStack(alignment: .topLeading) {
      baseCapsule
        .frame(width: model.metrics.width, height: model.metrics.height)

      selectedPill
        .frame(width: model.metrics.activePillWidth, height: model.metrics.activePillHeight)
        .matchedGeometryEffect(id: "top-liquid-active-pill", in: topNamespace)
        .offset(x: activePillX, y: activePillY)

      itemRow
        .frame(width: contentWidth, height: model.metrics.height)
        .offset(x: model.metrics.insetX, y: 0)
    }
    .frame(width: model.metrics.width, height: model.metrics.height)
    .animation(.spring(response: 0.42, dampingFraction: 0.86, blendDuration: 0.18), value: clampedSelectedIndex)
  }

  private var baseCapsule: some View {
    Capsule()
      .fill(.ultraThinMaterial)
      .overlay {
        Capsule()
          .fill(baseBackgroundColor)
      }
      .overlay {
        Capsule()
          .stroke(baseBorderColor, lineWidth: 1)
      }
      .shadow(color: baseShadowColor, radius: colorScheme == .dark ? 24 : 22, x: 0, y: colorScheme == .dark ? 12 : 10)
  }

  private var selectedPill: some View {
    Capsule()
      .fill(selectedBackgroundColor)
      .overlay {
        Capsule()
          .stroke(selectedBorderColor, lineWidth: 1)
      }
      .shadow(color: selectedShadowColor, radius: colorScheme == .dark ? 18 : 16, x: 0, y: colorScheme == .dark ? 9 : 7)
  }

  private var itemRow: some View {
    HStack(spacing: 0) {
      ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
        let isActive = index == clampedSelectedIndex
        let foregroundColor = isActive ? model.accentColor : inactiveColor

        Button {
          model.onSelect?(index)
        } label: {
          VStack(spacing: 2) {
            Image(systemName: item.systemImage)
              .symbolRenderingMode(.monochrome)
              .font(.system(size: 20, weight: .semibold))
              .foregroundColor(foregroundColor)

            Text(item.title)
              .font(.system(size: 10.5, weight: isActive ? .semibold : .medium))
              .lineLimit(1)
              .foregroundColor(foregroundColor)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .contentShape(Rectangle())
          .overlay(alignment: .topTrailing) {
            badgeView(for: item)
              .offset(x: -10, y: 8)
          }
        }
        .buttonStyle(.plain)
        .frame(width: model.metrics.slotWidth, height: model.metrics.height)
      }
    }
    .frame(height: model.metrics.height)
  }

  @ViewBuilder
  private func badgeView(for item: AppStoreLiquidTabBarItem) -> some View {
    if let badgeText = item.badgeText, !badgeText.isEmpty {
      Text(badgeText)
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(Color.white)
        .padding(.horizontal, 6)
        .frame(height: 18)
        .background(
          Capsule().fill(Color(red: 1, green: 0.23, blue: 0.19))
        )
    } else if item.showsDot {
      Circle()
        .fill(Color(red: 1, green: 0.23, blue: 0.19))
        .frame(width: 9, height: 9)
    }
  }

  private var contentWidth: CGFloat {
    model.metrics.width - model.metrics.insetX * 2
  }

  private var activePillX: CGFloat {
    model.metrics.insetX
      + CGFloat(clampedSelectedIndex) * model.metrics.slotWidth
      + (model.metrics.slotWidth - model.metrics.activePillWidth) / 2
  }

  private var activePillY: CGFloat {
    (model.metrics.height - model.metrics.activePillHeight) / 2
  }

  private var clampedSelectedIndex: Int {
    guard !model.items.isEmpty else { return 0 }
    return min(max(model.selectedIndex, 0), model.items.count - 1)
  }

  private var baseBackgroundColor: Color {
    colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.72)
  }

  private var baseBorderColor: Color {
    colorScheme == .dark ? Color.white.opacity(0.14) : Color.white.opacity(0.70)
  }

  private var baseShadowColor: Color {
    Color.black.opacity(colorScheme == .dark ? 0.28 : 0.08)
  }

  private var selectedBackgroundColor: Color {
    colorScheme == .dark ? Color.white.opacity(0.20) : Color.white.opacity(0.88)
  }

  private var selectedBorderColor: Color {
    colorScheme == .dark ? Color.white.opacity(0.18) : Color.white.opacity(0.75)
  }

  private var selectedShadowColor: Color {
    Color.black.opacity(colorScheme == .dark ? 0.32 : 0.10)
  }

  private var inactiveColor: Color {
    colorScheme == .dark
      ? Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.72)
      : Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255).opacity(0.82)
  }
}
