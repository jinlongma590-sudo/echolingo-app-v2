import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { resolveAndroidDarkViewOverride } from '@/theme/androidLegacyColorOverrides';

type Tone = 'neutral' | 'blue' | 'amber' | 'green' | 'red' | 'dark';
type Variant = 'primary' | 'dark' | 'secondary' | 'danger';

function toneColors(tone: Tone, theme: ReturnType<typeof useAppTheme>['theme']) {
  switch (tone) {
    case 'blue':
      return {
        bg: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.18)' : 'rgba(10,132,255,0.10)',
        border: 'rgba(10,132,255,0.22)',
        text: theme.primaryBlue,
      };
    case 'amber':
      return {
        bg: theme.colorScheme === 'dark' ? 'rgba(255,159,10,0.18)' : 'rgba(245,158,11,0.12)',
        border: 'rgba(255,159,10,0.20)',
        text: theme.warning,
      };
    case 'green':
      return {
        bg: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.18)' : 'rgba(34,197,94,0.10)',
        border: 'rgba(48,209,88,0.20)',
        text: theme.success,
      };
    case 'red':
      return {
        bg: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.18)' : 'rgba(239,68,68,0.10)',
        border: 'rgba(255,69,58,0.20)',
        text: theme.destructive,
      };
    case 'dark':
      return {
        bg: theme.elevatedCardBackground,
        border: theme.border,
        text: theme.textPrimary,
      };
    default:
      return {
        bg: theme.fillSecondary,
        border: theme.border,
        text: theme.textSecondary,
      };
  }
}

function variantColors(variant: Variant, theme: ReturnType<typeof useAppTheme>['theme']) {
  switch (variant) {
    case 'secondary':
      return {
        bg: theme.secondaryCardBackground,
        border: theme.border,
        text: theme.textPrimary,
      };
    case 'danger':
      return {
        bg: theme.destructive,
        border: theme.destructive,
        text: '#FFFFFF',
      };
    case 'primary':
      return {
        bg: theme.primaryBlue,
        border: theme.primaryBlue,
        text: '#FFFFFF',
      };
    case 'dark':
    default:
      return {
        bg: theme.colorScheme === 'dark' ? theme.primaryBlue : '#111827',
        border: theme.colorScheme === 'dark' ? theme.primaryBlue : '#111827',
        text: '#FFFFFF',
      };
  }
}

export function SurfaceCard({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const { theme } = useAppTheme();
  const androidDarkSurfaceOverride = resolveAndroidDarkViewOverride(style, theme);

  return (
    <View
      style={[
        {
          borderRadius: 22,
          padding: padded ? 16 : 0,
          backgroundColor: theme.cardBackground,
          borderWidth: 1,
          borderColor: theme.border,
          gap: 12,
          shadowColor: theme.shadowColor,
          shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        style,
        androidDarkSurfaceOverride,
      ]}
    >
      {children}
    </View>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: Tone;
}) {
  const { theme } = useAppTheme();
  const colors = toneColors(tone, theme);

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <AppText style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{label}</AppText>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  variant = 'dark',
  disabled,
  style,
  labelStyle,
  ...rest
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
} & Omit<PressableProps, 'style'>) {
  const { theme } = useAppTheme();
  const colors = variantColors(variant, theme);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          minHeight: 46,
          borderRadius: 16,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : pressed ? 0.84 : 1,
        },
        style,
      ]}
      {...rest}
    >
      <AppText style={[{ fontSize: 15, fontWeight: '700', color: colors.text }, labelStyle]}>{label}</AppText>
    </Pressable>
  );
}

export function ChromeIconButton({
  icon,
  onPress,
  accessibilityLabel,
  loading = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
  accessibilityLabel?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => {
        const dark = theme.colorScheme === 'dark';

        return {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: dark ? theme.groupedBackground : theme.cardBackground,
          borderWidth: 1,
          borderColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(17,24,39,0.06)',
          shadowColor: theme.shadowColor,
          shadowOpacity: dark ? 0 : 0.05,
          shadowRadius: dark ? 0 : 12,
          shadowOffset: { width: 0, height: 4 },
          opacity: disabled ? 0.42 : pressed ? 0.78 : 1,
          transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
        };
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={theme.textSecondary} />
      ) : (
        <Ionicons name={icon} size={20} color={theme.textPrimary} />
      )}
    </Pressable>
  );
}

export function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: active ? theme.primaryBlue : theme.fillSecondary,
        borderWidth: 1,
        borderColor: active ? theme.primaryBlue : theme.border,
        opacity: pressed ? 0.84 : 1,
      })}
    >
      <AppText style={{ fontSize: 12, fontWeight: '700', color: active ? '#FFFFFF' : theme.textSecondary }}>{label}</AppText>
    </Pressable>
  );
}

export function MetricTile({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: Tone;
}) {
  const { theme } = useAppTheme();
  const colors = toneColors(tone, theme);

  return (
    <View
      style={{
        minWidth: 120,
        flexGrow: 1,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 14,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 6,
      }}
    >
      <AppText style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{label}</AppText>
      <AppText style={{ fontSize: 22, fontWeight: '800', color: theme.textPrimary }}>{value}</AppText>
      {note ? <AppText style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary }}>{note}</AppText> : null}
    </View>
  );
}

export function ProgressBar({ progress }: { progress: number }) {
  const { theme } = useAppTheme();
  const clamped = Math.max(0, Math.min(100, progress));

  return (
    <View
      style={{
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        backgroundColor: theme.fillPrimary,
      }}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: '100%',
          backgroundColor: theme.primaryBlue,
        }}
      />
    </View>
  );
}

export function BulletRow({
  label,
  value,
  title,
  detail,
  tone = 'blue',
}: {
  label?: string;
  value?: string | null;
  title?: string;
  detail?: string | null;
  tone?: Tone;
}) {
  const { theme } = useAppTheme();
  const colors = toneColors(tone, theme);
  const heading = title ?? label ?? '要点';
  const body = detail ?? value ?? null;

  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <AppText style={{ fontSize: 14, color: colors.text }}>•</AppText>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>{heading}</AppText>
        {body ? <AppText style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>{body}</AppText> : null}
      </View>
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.secondaryCardBackground,
        paddingHorizontal: 14,
        paddingVertical: 4,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        style={{
          minHeight: 40,
          color: theme.textPrimary,
        }}
      />
    </View>
  );
}
