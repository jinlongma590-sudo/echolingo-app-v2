import React, { useRef } from 'react';
import {
  Animated,
  type ColorValue,
  ScrollView,
  StyleSheet,
  View,
  type Insets,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { resolveAndroidDarkViewOverride } from '@/theme/androidLegacyColorOverrides';
import { FONT_CALLOUT, FONT_LARGE_TITLE, SPACING_PAGE_H } from '@/theme/tokens';

type AppScreenShellProps = {
  title?: string;
  subtitle?: string;
  rightAction?: React.ReactNode;
  header?: React.ReactNode;
  scrollable?: boolean;
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  showsVerticalScrollIndicator?: boolean;
  backgroundColor?: ColorValue;
  testID?: string;
  includeBottomInset?: boolean;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  headerScrollFade?: boolean;
  disableTabletTopInset?: boolean;
};

const HEADER_FADE_START = 0;
const HEADER_FADE_END = 48;
const HEADER_TRANSLATE_Y = -10;

function splitPadding(style: StyleProp<ViewStyle>) {
  const flattened = StyleSheet.flatten(style) ?? {};
  const { paddingTop, paddingBottom, ...rest } = flattened;

  return {
    paddingTop: typeof paddingTop === 'number' ? paddingTop : 0,
    paddingBottom: typeof paddingBottom === 'number' ? paddingBottom : 0,
    hasExplicitPaddingBottom: Object.prototype.hasOwnProperty.call(flattened, 'paddingBottom'),
    rest,
  };
}

function buildScrollIndicatorInsets(bottomInset: number, includeBottomInset: boolean): Insets {
  return {
    top: 0,
    left: 0,
    right: 0,
    bottom: includeBottomInset ? bottomInset : 0,
  };
}

export function AppScreenShell({
  title,
  subtitle,
  rightAction,
  header,
  scrollable = true,
  children,
  contentContainerStyle,
  showsVerticalScrollIndicator = false,
  backgroundColor,
  testID,
  includeBottomInset = true,
  keyboardShouldPersistTaps = 'handled',
  headerScrollFade = false,
  disableTabletTopInset = false,
}: AppScreenShellProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const floatingInsets = useFloatingTabInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const hasHeaderContent = Boolean(header || title || subtitle || rightAction);
  const { paddingTop, paddingBottom, hasExplicitPaddingBottom, rest } = splitPadding(contentContainerStyle);
  const androidDarkBackgroundOverride = resolveAndroidDarkViewOverride(
    { backgroundColor: backgroundColor as string | undefined },
    theme,
  );
  const androidDarkContentOverride = resolveAndroidDarkViewOverride(rest, theme);
  const shouldBypassTabletTopInset = disableTabletTopInset && floatingInsets.placement === 'top';
  const resolvedTopInsetBase = shouldBypassTabletTopInset
    ? insets.top
    : floatingInsets.top > 0
      ? floatingInsets.top
      : insets.top;
  const resolvedPaddingTop = resolvedTopInsetBase + paddingTop;
  const shouldApplyDefaultBottomInset = includeBottomInset && !hasExplicitPaddingBottom;
  const resolvedPaddingBottom = shouldApplyDefaultBottomInset ? floatingInsets.bottom : paddingBottom;
  const resolvedBackgroundColor = androidDarkBackgroundOverride?.backgroundColor ?? backgroundColor ?? theme.pageBackground;
  const shouldAnimateHeader = headerScrollFade && scrollable && hasHeaderContent;
  const headerOpacity = scrollY.interpolate({
    inputRange: [HEADER_FADE_START, HEADER_FADE_END],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const headerTranslateY = scrollY.interpolate({
    inputRange: [HEADER_FADE_START, HEADER_FADE_END],
    outputRange: [0, HEADER_TRANSLATE_Y],
    extrapolate: 'clamp',
  });
  const headerAnimatedStyle = shouldAnimateHeader
    ? {
        opacity: headerOpacity,
        transform: [{ translateY: headerTranslateY }],
      }
    : null;

  const headerNode =
    header ??
    (title ? (
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Animated.View style={[styles.headerCopy, headerAnimatedStyle]}>
            <AppText style={styles.title}>{title}</AppText>
            {subtitle ? <AppText style={styles.subtitle} tone="secondary">{subtitle}</AppText> : null}
          </Animated.View>
          {rightAction ? <Animated.View style={[styles.rightAction, headerAnimatedStyle]}>{rightAction}</Animated.View> : null}
        </View>
      </View>
    ) : null);

  const resolvedHeaderNode = header && shouldAnimateHeader && headerNode ? <Animated.View style={headerAnimatedStyle}>{headerNode}</Animated.View> : headerNode;

  if (!scrollable) {
    return (
      <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: resolvedBackgroundColor }]} testID={testID}>
        <View
          style={[
            styles.content,
            { backgroundColor: resolvedBackgroundColor, paddingTop: resolvedPaddingTop, paddingBottom: resolvedPaddingBottom },
            rest,
            androidDarkContentOverride,
          ]}
        >
          {resolvedHeaderNode}
          {children}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: resolvedBackgroundColor }]} testID={testID}>
      <Animated.ScrollView
        style={[styles.scrollView, { backgroundColor: resolvedBackgroundColor }]}
        contentContainerStyle={[
          {
            paddingTop: resolvedPaddingTop,
            paddingBottom: resolvedPaddingBottom,
          },
          rest,
          androidDarkContentOverride,
        ]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        scrollIndicatorInsets={buildScrollIndicatorInsets(floatingInsets.bottom, shouldApplyDefaultBottomInset)}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        scrollEventThrottle={16}
        onScroll={
          shouldAnimateHeader
            ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
                useNativeDriver: true,
              })
            : undefined
        }
      >
        {resolvedHeaderNode}
        {children}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: FONT_LARGE_TITLE,
    lineHeight: 41,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  subtitle: {
    marginTop: 4,
    fontSize: FONT_CALLOUT,
    lineHeight: 18,
  },
  rightAction: {
    alignSelf: 'flex-start',
  },
});
