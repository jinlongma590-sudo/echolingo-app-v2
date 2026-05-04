import { Platform, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { type AppThemePalette, LIGHT_THEME } from '@/theme/tokens';

function normalizeColor(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '') : null;
}

function parseHexChannel(value: string) {
  return Number.parseInt(value, 16);
}

function relativeLuminance(color: string) {
  const normalized = normalizeColor(color);
  if (!normalized) return null;

  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    const [, r, g, b] = normalized;
    return (parseHexChannel(r + r) * 0.299 + parseHexChannel(g + g) * 0.587 + parseHexChannel(b + b) * 0.114) / 255;
  }

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    const r = parseHexChannel(normalized.slice(1, 3));
    const g = parseHexChannel(normalized.slice(3, 5));
    const b = parseHexChannel(normalized.slice(5, 7));
    return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  }

  const rgbMatch = normalized.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/);
  if (rgbMatch) {
    const alpha = rgbMatch[4] ? Number.parseFloat(rgbMatch[4]) : 1;
    if (alpha < 0.55) return null;
    const r = Number.parseInt(rgbMatch[1], 10);
    const g = Number.parseInt(rgbMatch[2], 10);
    const b = Number.parseInt(rgbMatch[3], 10);
    return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  }

  return null;
}

function shouldApplyAndroidDarkOverride(theme: AppThemePalette) {
  return Platform.OS === 'android' && theme.colorScheme === 'dark';
}

const LEGACY_PRIMARY_TEXT_COLORS = new Set([
  normalizeColor(LIGHT_THEME.textPrimary),
  '#000',
  '#000000',
  '#0f172a',
  '#111827',
  '#18181b',
  '#1f2937',
]);

const LEGACY_SECONDARY_TEXT_COLORS = new Set([
  normalizeColor(LIGHT_THEME.textSecondary),
  normalizeColor(LIGHT_THEME.textTertiary),
  normalizeColor(LIGHT_THEME.textQuaternary),
  '#6b7280',
  '#71717a',
  '#7b8190',
  '#8e8e93',
  'rgba(123,129,144,0.72)',
  'rgba(123,129,144,0.46)',
]);

const LEGACY_PAGE_BACKGROUNDS = new Set([
  normalizeColor(LIGHT_THEME.pageBackground),
  normalizeColor(LIGHT_THEME.groupedBackground),
  '#f5f6fa',
  '#eef0f5',
  '#f2f2f7',
]);

const LEGACY_CARD_BACKGROUNDS = new Set([
  normalizeColor(LIGHT_THEME.cardBackground),
  normalizeColor(LIGHT_THEME.elevatedCardBackground),
  '#fff',
  '#ffffff',
  'white',
]);

const LEGACY_SECONDARY_CARD_BACKGROUNDS = new Set([
  normalizeColor(LIGHT_THEME.secondaryCardBackground),
  'rgba(255,255,255,0.78)',
  'rgba(255,255,255,0.66)',
  '#f7f8fb',
  '#f8f8f8',
  '#f9fafb',
]);

export function resolveAndroidDarkTextOverride(
  style: StyleProp<TextStyle>,
  theme: AppThemePalette,
): TextStyle | null {
  if (!shouldApplyAndroidDarkOverride(theme)) return null;

  const color = normalizeColor(StyleSheet.flatten(style)?.color);
  if (!color) return null;

  if (LEGACY_PRIMARY_TEXT_COLORS.has(color)) {
    return { color: theme.textPrimary };
  }

  if (LEGACY_SECONDARY_TEXT_COLORS.has(color)) {
    return { color: theme.textSecondary };
  }

  const luminance = relativeLuminance(color);
  if (luminance !== null && luminance < 0.18) {
    return { color: theme.textPrimary };
  }

  return null;
}

export function resolveAndroidDarkViewOverride(
  style: StyleProp<ViewStyle>,
  theme: AppThemePalette,
): ViewStyle | null {
  if (!shouldApplyAndroidDarkOverride(theme)) return null;

  const backgroundColor = normalizeColor(StyleSheet.flatten(style)?.backgroundColor);
  if (!backgroundColor) return null;

  if (LEGACY_PAGE_BACKGROUNDS.has(backgroundColor)) {
    return { backgroundColor: theme.pageBackground };
  }

  if (LEGACY_CARD_BACKGROUNDS.has(backgroundColor)) {
    return { backgroundColor: theme.cardBackground, borderColor: theme.border };
  }

  if (LEGACY_SECONDARY_CARD_BACKGROUNDS.has(backgroundColor)) {
    return { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border };
  }

  return null;
}
