import { DynamicColorIOS, Platform } from 'react-native';

export type AppResolvedColorScheme = 'light' | 'dark';

export type AppThemePalette = {
  colorScheme: AppResolvedColorScheme;
  pageBackground: string;
  groupedBackground: string;
  cardBackground: string;
  elevatedCardBackground: string;
  secondaryCardBackground: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
  separator: string;
  border: string;
  fillPrimary: string;
  fillSecondary: string;
  fillTertiary: string;
  primaryBlue: string;
  destructive: string;
  success: string;
  warning: string;
  glassBackground: string;
  glassBorder: string;
  shadowColor: string;
  tabBarBackground: string;
  tabBarBorder: string;
  activeTabBackground: string;
  activeTabBorder: string;
};

export type SpeakingPreparationHeroPalette = {
  iconBg: string;
  start: string;
  end: string;
  washA: string;
  washB: string;
  panel: string;
  border: string;
  switchBg: string;
  switchBorder: string;
  switchText: string;
  title: string;
  subtitle: string;
};

export const LIGHT_THEME: AppThemePalette = {
  colorScheme: 'light',
  pageBackground: '#F5F6FA',
  groupedBackground: '#EEF0F5',
  cardBackground: '#FFFFFF',
  elevatedCardBackground: '#FFFFFF',
  secondaryCardBackground: '#F7F8FB',
  textPrimary: '#111827',
  textSecondary: '#7B8190',
  textTertiary: 'rgba(123,129,144,0.72)',
  textQuaternary: 'rgba(123,129,144,0.46)',
  separator: 'rgba(60,60,67,0.18)',
  border: 'rgba(60,60,67,0.10)',
  fillPrimary: 'rgba(120,120,128,0.16)',
  fillSecondary: 'rgba(120,120,128,0.10)',
  fillTertiary: 'rgba(120,120,128,0.06)',
  primaryBlue: '#007AFF',
  destructive: '#FF3B30',
  success: '#34C759',
  warning: '#FF9F0A',
  glassBackground: 'rgba(249,249,252,0.78)',
  glassBorder: 'rgba(255,255,255,0.26)',
  shadowColor: '#000000',
  tabBarBackground: 'rgba(247,247,250,0.78)',
  tabBarBorder: 'rgba(255,255,255,0.24)',
  activeTabBackground: 'rgba(255,255,255,0.54)',
  activeTabBorder: 'rgba(255,255,255,0.22)',
};

export const DARK_THEME: AppThemePalette = {
  colorScheme: 'dark',
  pageBackground: '#0B0B0F',
  groupedBackground: '#1C1C1E',
  cardBackground: '#1C1C1E',
  elevatedCardBackground: '#2C2C2E',
  secondaryCardBackground: '#242426',
  textPrimary: 'rgba(255,255,255,0.94)',
  textSecondary: 'rgba(235,235,245,0.68)',
  textTertiary: 'rgba(235,235,245,0.42)',
  textQuaternary: 'rgba(235,235,245,0.26)',
  separator: 'rgba(84,84,88,0.65)',
  border: 'rgba(255,255,255,0.08)',
  fillPrimary: 'rgba(120,120,128,0.32)',
  fillSecondary: 'rgba(120,120,128,0.24)',
  fillTertiary: 'rgba(120,120,128,0.18)',
  primaryBlue: '#0A84FF',
  destructive: '#FF453A',
  success: '#30D158',
  warning: '#FF9F0A',
  glassBackground: 'rgba(28,28,30,0.72)',
  glassBorder: 'rgba(255,255,255,0.10)',
  shadowColor: '#000000',
  tabBarBackground: 'rgba(18,18,20,0.82)',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  activeTabBackground: 'rgba(44,44,46,0.72)',
  activeTabBorder: 'rgba(255,255,255,0.10)',
};

export function resolveAppTheme(colorScheme: AppResolvedColorScheme): AppThemePalette {
  return colorScheme === 'dark' ? DARK_THEME : LIGHT_THEME;
}

export function resolveSpeakingPreparationHeroPalette(
  scenarioId: string,
  colorScheme: AppResolvedColorScheme,
): SpeakingPreparationHeroPalette {
  const lightPresets = {
    cafe: {
      iconBg: 'rgba(255,255,255,0.82)',
      start: '#F3EBC8',
      end: '#F4E7DA',
      washA: 'rgba(255,248,220,0.62)',
      washB: 'rgba(245,232,210,0.54)',
      panel: '#F7F0DE',
      border: 'rgba(120,53,15,0.06)',
      switchBg: 'rgba(255,255,255,0.42)',
      switchBorder: 'rgba(120,53,15,0.06)',
      switchText: '#57534E',
      title: '#18181B',
      subtitle: 'rgba(63,63,70,0.64)',
    },
    sky: {
      iconBg: 'rgba(255,255,255,0.84)',
      start: '#EAF1FB',
      end: '#E7EEF8',
      washA: 'rgba(232,241,255,0.74)',
      washB: 'rgba(221,232,247,0.62)',
      panel: '#EEF3FA',
      border: 'rgba(59,130,246,0.07)',
      switchBg: 'rgba(255,255,255,0.42)',
      switchBorder: 'rgba(59,130,246,0.08)',
      switchText: '#475569',
      title: '#18181B',
      subtitle: 'rgba(63,63,70,0.64)',
    },
    mint: {
      iconBg: 'rgba(255,255,255,0.84)',
      start: '#EAF1EA',
      end: '#EEF3E9',
      washA: 'rgba(235,245,237,0.72)',
      washB: 'rgba(226,236,226,0.62)',
      panel: '#F0F4ED',
      border: 'rgba(34,197,94,0.07)',
      switchBg: 'rgba(255,255,255,0.44)',
      switchBorder: 'rgba(34,197,94,0.08)',
      switchText: '#4B5563',
      title: '#18181B',
      subtitle: 'rgba(63,63,70,0.64)',
    },
    blush: {
      iconBg: 'rgba(255,255,255,0.84)',
      start: '#F5E8E0',
      end: '#F5EDE7',
      washA: 'rgba(248,233,224,0.72)',
      washB: 'rgba(243,227,220,0.6)',
      panel: '#F8EFEB',
      border: 'rgba(194,101,26,0.07)',
      switchBg: 'rgba(255,255,255,0.42)',
      switchBorder: 'rgba(194,101,26,0.08)',
      switchText: '#57534E',
      title: '#18181B',
      subtitle: 'rgba(63,63,70,0.64)',
    },
    stone: {
      iconBg: 'rgba(255,255,255,0.84)',
      start: '#EBECEF',
      end: '#ECE7E3',
      washA: 'rgba(241,242,245,0.72)',
      washB: 'rgba(230,228,225,0.58)',
      panel: '#F1EFED',
      border: 'rgba(63,63,70,0.08)',
      switchBg: 'rgba(255,255,255,0.44)',
      switchBorder: 'rgba(63,63,70,0.08)',
      switchText: '#52525B',
      title: '#18181B',
      subtitle: 'rgba(63,63,70,0.64)',
    },
    lilac: {
      iconBg: 'rgba(255,255,255,0.84)',
      start: '#F0ECF8',
      end: '#EEE8F7',
      washA: 'rgba(240,236,250,0.72)',
      washB: 'rgba(232,225,247,0.62)',
      panel: '#F3EFF9',
      border: 'rgba(124,58,237,0.07)',
      switchBg: 'rgba(255,255,255,0.44)',
      switchBorder: 'rgba(124,58,237,0.08)',
      switchText: '#5B5563',
      title: '#18181B',
      subtitle: 'rgba(63,63,70,0.64)',
    },
  } satisfies Record<string, SpeakingPreparationHeroPalette>;

  const darkPresets = {
    cafe: {
      iconBg: 'rgba(255,248,233,0.12)',
      start: '#3A2E1A',
      end: '#2A2020',
      washA: 'rgba(245,191,91,0.18)',
      washB: 'rgba(206,132,88,0.14)',
      panel: '#1F1A17',
      border: 'rgba(255,214,153,0.10)',
      switchBg: 'rgba(255,248,233,0.08)',
      switchBorder: 'rgba(255,214,153,0.10)',
      switchText: 'rgba(255,240,220,0.88)',
      title: 'rgba(255,248,239,0.96)',
      subtitle: 'rgba(255,233,209,0.70)',
    },
    sky: {
      iconBg: 'rgba(170,214,255,0.10)',
      start: '#142130',
      end: '#16293A',
      washA: 'rgba(79,163,255,0.20)',
      washB: 'rgba(123,194,255,0.12)',
      panel: '#151E2B',
      border: 'rgba(132,192,255,0.10)',
      switchBg: 'rgba(170,214,255,0.08)',
      switchBorder: 'rgba(132,192,255,0.10)',
      switchText: 'rgba(227,241,255,0.90)',
      title: 'rgba(245,250,255,0.96)',
      subtitle: 'rgba(210,229,245,0.72)',
    },
    mint: {
      iconBg: 'rgba(182,242,203,0.10)',
      start: '#14211A',
      end: '#18251E',
      washA: 'rgba(82,214,142,0.18)',
      washB: 'rgba(147,233,183,0.12)',
      panel: '#151C17',
      border: 'rgba(146,232,182,0.10)',
      switchBg: 'rgba(182,242,203,0.08)',
      switchBorder: 'rgba(146,232,182,0.10)',
      switchText: 'rgba(229,247,236,0.88)',
      title: 'rgba(245,251,247,0.95)',
      subtitle: 'rgba(208,230,216,0.72)',
    },
    blush: {
      iconBg: 'rgba(255,214,195,0.10)',
      start: '#2A1918',
      end: '#31201D',
      washA: 'rgba(255,145,117,0.18)',
      washB: 'rgba(227,170,135,0.12)',
      panel: '#211716',
      border: 'rgba(255,198,172,0.10)',
      switchBg: 'rgba(255,214,195,0.08)',
      switchBorder: 'rgba(255,198,172,0.10)',
      switchText: 'rgba(255,237,230,0.88)',
      title: 'rgba(255,247,243,0.95)',
      subtitle: 'rgba(239,217,208,0.70)',
    },
    stone: {
      iconBg: 'rgba(228,232,240,0.08)',
      start: '#1A1C21',
      end: '#212224',
      washA: 'rgba(158,169,189,0.15)',
      washB: 'rgba(106,111,123,0.12)',
      panel: '#17181C',
      border: 'rgba(228,232,240,0.08)',
      switchBg: 'rgba(228,232,240,0.08)',
      switchBorder: 'rgba(228,232,240,0.08)',
      switchText: 'rgba(238,242,247,0.88)',
      title: 'rgba(248,249,251,0.95)',
      subtitle: 'rgba(214,219,227,0.70)',
    },
    lilac: {
      iconBg: 'rgba(228,209,255,0.10)',
      start: '#21182A',
      end: '#281D30',
      washA: 'rgba(164,120,255,0.20)',
      washB: 'rgba(212,177,255,0.12)',
      panel: '#1B1621',
      border: 'rgba(214,184,255,0.10)',
      switchBg: 'rgba(228,209,255,0.08)',
      switchBorder: 'rgba(214,184,255,0.10)',
      switchText: 'rgba(242,233,255,0.88)',
      title: 'rgba(250,246,255,0.96)',
      subtitle: 'rgba(225,214,242,0.72)',
    },
  } satisfies Record<string, SpeakingPreparationHeroPalette>;

  const group =
    scenarioId === 'coffee-order'
      ? 'cafe'
      : ['restaurant-order', 'night-market', 'shopping-store'].includes(scenarioId)
        ? 'blush'
        : ['hotel-checkin', 'airport-checkin', 'taxi-ride', 'asking-directions', 'metro-chat', 'doctor-visit'].includes(scenarioId)
          ? 'sky'
          : ['self-introduction', 'daily-greetings', 'phone-appointment'].includes(scenarioId)
            ? 'mint'
            : ['job-interview', 'meeting-discussion', 'project-presentation', 'opinion-discussion', 'hotel-problem'].includes(scenarioId)
              ? 'stone'
              : ['small-talk-party', 'free-chat'].includes(scenarioId)
                ? 'lilac'
                : 'cafe';

  return colorScheme === 'dark' ? darkPresets[group] : lightPresets[group];
}

function dynamicColor(light: string, dark: string): string {
  if (Platform.OS === 'ios') {
    return DynamicColorIOS({ light, dark }) as unknown as string;
  }

  return light;
}

/**
 * EchoLingo – Design Tokens
 * Single source of truth. Never hardcode these values in screen/component files.
 */

// ── Backgrounds ────────────────────────────────────────────────────────────
export const BG_PAGE = dynamicColor(LIGHT_THEME.pageBackground, DARK_THEME.pageBackground);
export const BG_CARD = dynamicColor(LIGHT_THEME.cardBackground, DARK_THEME.cardBackground);
export const BG_CARD_SOFT = dynamicColor('rgba(255,255,255,0.78)', 'rgba(44,44,46,0.78)');
export const BG_CARD_MUTED = dynamicColor('rgba(255,255,255,0.66)', 'rgba(36,36,38,0.70)');
export const BG_HERO = dynamicColor('#1C1C1E', '#111214');
export const BG_HERO_BTN_SEC = dynamicColor('#3A3A3C', '#2C2C2E');
export const BG_HERO_PILL = dynamicColor('rgba(255,255,255,0.07)', 'rgba(255,255,255,0.10)');
export const BG_OVERLAY = dynamicColor('rgba(28,28,30,0.28)', 'rgba(0,0,0,0.42)');
export const BG_TAB = dynamicColor(LIGHT_THEME.tabBarBackground, DARK_THEME.tabBarBackground);

// ── Text ───────────────────────────────────────────────────────────────────
export const TEXT_PRIMARY = dynamicColor(LIGHT_THEME.textPrimary, DARK_THEME.textPrimary);
export const TEXT_SECONDARY = dynamicColor(LIGHT_THEME.textSecondary, DARK_THEME.textSecondary);
export const TEXT_TERTIARY = dynamicColor(LIGHT_THEME.textTertiary, DARK_THEME.textTertiary);
export const TEXT_ON_DARK = '#FFFFFF';
export const TEXT_ON_DARK_DIM = dynamicColor('rgba(255,255,255,0.38)', 'rgba(255,255,255,0.54)');
export const TEXT_ON_DARK_SOFT = dynamicColor('rgba(255,255,255,0.78)', 'rgba(255,255,255,0.82)');

// ── Brand accent ───────────────────────────────────────────────────────────
export const ACCENT = '#F5A623';
export const PRIMARY_BLUE = '#0A84FF';
export const TAB_SELECTED_TINT = PRIMARY_BLUE;

// ── Semantic / iOS system colours ──────────────────────────────────────────
export const COLOR_BLUE = '#007AFF';
export const COLOR_GREEN = '#34C759';
export const COLOR_RED = '#FF3B30';
export const COLOR_TEAL = '#5AC8FA';

export const COLOR_BLUE_BG = 'rgba(0,122,255,0.10)';
export const COLOR_GREEN_BG = 'rgba(52,199,89,0.10)';
export const COLOR_RED_BG = 'rgba(255,59,48,0.10)';
export const COLOR_TEAL_BG = 'rgba(90,200,250,0.10)';
export const COLOR_AMBER_BG = 'rgba(245,166,35,0.15)';

// ── Separators ─────────────────────────────────────────────────────────────
export const SEPARATOR = dynamicColor(LIGHT_THEME.separator, DARK_THEME.separator);
export const SEPARATOR_DARK = 'rgba(255,255,255,0.10)';
export const BORDER_SOFT = dynamicColor(LIGHT_THEME.border, DARK_THEME.border);
export const BORDER_STRONG = dynamicColor('rgba(28,28,30,0.12)', 'rgba(255,255,255,0.14)');

// ── Radius ─────────────────────────────────────────────────────────────────
export const RADIUS_CARD = 16;
export const RADIUS_HERO = 22;
export const RADIUS_BTN = 14;
export const RADIUS_ICON = 8;
export const RADIUS_PILL = 12;

// ── Typography ─────────────────────────────────────────────────────────────
export const FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

export const FONT_LARGE_TITLE = 34;
export const FONT_TITLE = 20;
export const FONT_BODY = 15;
export const FONT_CALLOUT = 13;
export const FONT_CAPTION = 12;
export const FONT_MICRO = 11;
export const FONT_TAB = 10;

// ── Spacing ────────────────────────────────────────────────────────────────
export const SPACING_PAGE_H = 20;
export const SPACING_SECTION = 20;
export const SPACING_CARD_MB = 20;
