import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { safeBack } from '@/navigation/safeBack';
import { deleteCurrentAccount } from '@/services/api/account';
import { fetchCurrentUserProfile, type UserProfileSnapshot } from '@/services/api/profile';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAiDataConsent } from '@/services/privacy/AiDataConsentProvider';
import { useAppTheme, type AppThemeMode } from '@/theme/AppThemeProvider';
import { useThemeColors } from '@/theme/useThemeColors';
import { openAppSafeUrl } from '@/utils/appSafeLink';
import {
  BG_CARD,
  BORDER_SOFT,
  COLOR_RED,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';

const APP_VERSION = '1.0.0';

function extractErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function isExpiredSessionError(error: unknown) {
  const message = extractErrorText(error).toLowerCase();
  return (
    message.includes('jwt expired') ||
    message.includes('pgrst303') ||
    message.includes('401') ||
    message.includes('auth session missing') ||
    message.includes('invalid jwt') ||
    message.includes('unauthorized')
  );
}

function resolveAccountStatusLabel(isLoggedIn?: boolean) {
  return isLoggedIn ? '已登录' : '游客';
}

async function openExternalUrl(url: string, fallbackTitle: string) {
  try {
    await openAppSafeUrl(url);
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'blocked_purchase_risk_url'
        ? '请在 App 内完成购买或账号相关操作。'
        : '暂时无法打开链接，请稍后再试。';
    Alert.alert(fallbackTitle, message);
  }
}

function StateCard({
  icon,
  title,
  subtitle,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { colors, theme } = useThemeColors();

  return (
    <SurfaceCard style={styles.stateCard}>
      <View
        style={[
          styles.stateIconWrap,
          {
            backgroundColor: theme.fillTertiary,
            borderColor: theme.border,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={theme.textSecondary} />
      </View>
      <AppText style={[styles.stateTitle, { color: colors.textPrimary }]}>{title}</AppText>
      <AppText style={[styles.stateSubtitle, { color: colors.textSecondary }]}>{subtitle}</AppText>

      {primaryLabel || secondaryLabel ? (
        <View style={styles.stateActions}>
          {primaryLabel && onPrimary ? (
            <Pressable
              onPress={onPrimary}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.primaryButtonText}>{primaryLabel}</AppText>
            </Pressable>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <Pressable
              onPress={onSecondary}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  backgroundColor: theme.secondaryCardBackground,
                  borderColor: theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>{secondaryLabel}</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SurfaceCard>
  );
}

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const { colors } = useThemeColors();

  return (
    <View style={styles.sectionTitleWrap}>
      <AppText style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</AppText>
      {subtitle ? <AppText style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>{subtitle}</AppText> : null}
    </View>
  );
}

function SettingsRow({
  label,
  value,
  onPress,
  destructive = false,
  disabled = false,
  showChevron = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
}) {
  const { colors, theme } = useThemeColors();

  return (
    <Pressable
      disabled={!onPress || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: colors.divider },
        pressed && onPress && !disabled && styles.pressed,
      ]}
    >
      <AppText
        style={[
          styles.rowLabel,
          { color: colors.textPrimary },
          destructive && styles.rowLabelDestructive,
          disabled && { color: colors.textSecondary },
        ]}
      >
        {label}
      </AppText>
      <View style={styles.rowRight}>
        {value ? (
          <AppText
            style={[
              styles.rowValue,
              { color: colors.textSecondary },
              destructive && styles.rowValueDestructive,
              disabled && { color: colors.textMuted },
            ]}
          >
            {value}
          </AppText>
        ) : null}
        {showChevron ? (
          <Ionicons
            name="chevron-forward"
            size={15}
            color={disabled ? theme.textQuaternary : theme.textTertiary}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export function SettingsScreen() {
  const session = useAppSession();
  const { colors, theme, themeMode, setThemeMode } = useThemeColors();
  const aiConsent = useAiDataConsent();
  const [profile, setProfile] = useState<UserProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const isLoggedIn = session.status === 'authenticated';
  const sessionExpired = session.authStateReason === 'expired';

  const load = useCallback(async () => {
    const currentSession = session.session;
    if (!currentSession) return;

    setLoading(true);
    setLoadError(false);
    try {
      const next = await fetchCurrentUserProfile(currentSession);
      setProfile(next);
    } catch (error) {
      if (isExpiredSessionError(error)) {
        setProfile(null);
        await session.invalidateSession();
        return;
      }
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!isLoggedIn) {
      setProfile(null);
      setLoading(false);
      if (!sessionExpired) {
        setLoadError(false);
      }
      return;
    }
    void load();
  }, [isLoggedIn, load, sessionExpired]);

  const email = profile?.email ?? session.user?.email ?? '游客';
  const accountStatusLabel = resolveAccountStatusLabel(isLoggedIn);

  const handleSignOut = useCallback(() => {
    Alert.alert('退出登录？', '退出后需要重新登录才能同步学习记录。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出登录',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSigningOut(true);
            try {
              await session.signOut();
              router.replace('/my');
            } finally {
              setSigningOut(false);
            }
          })();
        },
      },
    ]);
  }, [session]);

  const handleDeleteAccount = useCallback(() => {
    if (!session.session || deletingAccount) return;

    Alert.alert(
      '删除账号',
      '删除账号后，你的账号信息会被删除或匿名化，学习记录、AI 练习记录、词汇学习记录及相关个人数据将被清除，且操作不可恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingAccount(true);
              try {
                await deleteCurrentAccount(session.session!);
                await session.signOut();
                Alert.alert('账号已删除', '你的账号和相关学习数据已提交删除处理。');
                router.replace('/auth/sign-in');
              } catch (error) {
                Alert.alert('删除失败', extractErrorText(error) || '暂时无法删除账号，请稍后再试。');
              } finally {
                setDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
  }, [deletingAccount, session]);

  const header = (
    <View style={styles.header}>
      <View style={styles.backRow}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my')} accessibilityLabel="返回我的" />
      </View>
    </View>
  );

  if (!isLoggedIn && !sessionExpired) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <StateCard
          icon="settings-outline"
          title="登录后查看设置"
          subtitle="登录后可以管理账号状态、学习偏好和应用信息。"
          primaryLabel="去登录"
          onPrimary={() => router.push('/auth/sign-in')}
        />
      </AppScreenShell>
    );
  }

  if (sessionExpired) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <StateCard
          icon="shield-checkmark-outline"
          title="登录状态已失效"
          subtitle="请重新登录后继续使用。"
          primaryLabel="去登录"
          onPrimary={() => router.push('/auth/sign-in')}
          secondaryLabel="返回我的"
          onSecondary={() => router.replace('/my')}
        />
      </AppScreenShell>
    );
  }

  if (loadError && !loading) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <StateCard
          icon="cloud-offline-outline"
          title="设置暂时不可用"
          subtitle="请稍后重试。"
          primaryLabel="重新加载"
          onPrimary={() => {
            void load();
          }}
        />
      </AppScreenShell>
    );
  }

  return (
    <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false} headerScrollFade>
      <SurfaceCard style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <AppText style={[styles.heroEyebrow, { color: colors.textMuted }]}>设置</AppText>
            <AppText style={[styles.heroTitle, { color: colors.textPrimary }]}>设置</AppText>
            <AppText style={[styles.heroSubtitle, { color: colors.textSecondary }]}>管理账号、学习偏好和应用信息。</AppText>
          </View>
          <View
            style={[
              styles.heroBadge,
              {
                backgroundColor: theme.fillTertiary,
                borderColor: theme.border,
              },
            ]}
          >
            <Ionicons name="settings-outline" size={18} color={theme.textPrimary} />
          </View>
        </View>
      </SurfaceCard>

      <SurfaceCard style={styles.groupCard}>
        <SectionTitle title="账号" subtitle="查看当前账号与登录操作。" />
        <SettingsRow label="当前账号" value={email} />
        <SettingsRow label="账号状态" value={accountStatusLabel} />
        <SettingsRow
          label="AI 数据处理说明"
          value={aiConsent.hasConsent ? '已同意，可重新查看' : '首次使用前需同意'}
          onPress={aiConsent.openConsentNotice}
          showChevron
        />
        {isLoggedIn ? (
          <SettingsRow
            label={signingOut ? '退出中…' : '退出登录'}
            value=""
            onPress={signingOut ? undefined : handleSignOut}
            destructive
          />
        ) : (
          <SettingsRow label="去登录" onPress={() => router.push('/auth/sign-in')} showChevron />
        )}
        {isLoggedIn ? (
          <SettingsRow
            label={deletingAccount ? '删除中…' : '删除账号'}
            onPress={deletingAccount ? undefined : handleDeleteAccount}
            destructive
          />
        ) : null}
      </SurfaceCard>

      <SurfaceCard style={styles.groupCard}>
        <SectionTitle title="学习偏好" subtitle="先保留当前默认学习方式。" />
        <SettingsRow label="默认字幕模式" value="双语" />
        <SettingsRow label="默认播放倍速" value="1x" />
        <SettingsRow label="学习进度" value="自动保留" />
      </SurfaceCard>

      <SurfaceCard style={styles.groupCard}>
        <SectionTitle title="外观设置" subtitle="在跟随系统、浅色和深色之间切换，修改后立即生效。" />
        <View style={styles.segmentRow}>
          {([
            { key: 'system', label: '跟随系统' },
            { key: 'light', label: '浅色' },
            { key: 'dark', label: '深色' },
          ] as Array<{ key: AppThemeMode; label: string }>).map((item) => {
            const active = themeMode === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => void setThemeMode(item.key)}
                style={[
                  styles.segmentChip,
                  {
                    backgroundColor: active ? 'rgba(10,132,255,0.12)' : theme.fillTertiary,
                    borderColor: active ? 'rgba(10,132,255,0.18)' : theme.border,
                  },
                ]}
              >
                <AppText style={[styles.segmentChipText, { color: active ? theme.primaryBlue : theme.textSecondary }]}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </SurfaceCard>

      <SurfaceCard style={styles.groupCard}>
        <SectionTitle title="帮助与支持" subtitle="遇到问题时，从这里继续联系或查看帮助。" />
        <SettingsRow
          label="支持中心"
          value="echolingo.cn/support"
          onPress={() => {
            void openExternalUrl('https://echolingo.cn/support', '支持中心暂时不可用');
          }}
          showChevron
        />
        <SettingsRow
          label="反馈问题"
          value="打开网页反馈"
          onPress={() => {
            void openExternalUrl('https://echolingo.cn/feedback', '反馈入口暂时不可用');
          }}
          showChevron
        />
        <SettingsRow
          label="使用帮助"
          value="学习资源"
          onPress={() => {
            void openExternalUrl('https://echolingo.cn/resources', '帮助入口暂时不可用');
          }}
          showChevron
        />
      </SurfaceCard>

      <SurfaceCard style={styles.groupCard}>
        <SectionTitle title="关于" subtitle="查看版本信息和基础协议入口。" />
        <SettingsRow
          label="隐私政策"
          value="echolingo.cn"
          onPress={() => {
            void openExternalUrl('https://echolingo.cn/privacy', '隐私政策暂时不可用');
          }}
          showChevron
        />
        <SettingsRow
          label="用户协议"
          value="echolingo.cn"
          onPress={() => {
            void openExternalUrl('https://echolingo.cn/terms', '用户协议暂时不可用');
          }}
          showChevron
        />
        <SettingsRow label="当前版本" value={APP_VERSION} />
      </SurfaceCard>
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 28,
    gap: 12,
  },
  header: {
    paddingTop: 4,
    paddingBottom: 0,
  },
  backRow: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 2,
    paddingBottom: 4,
  },
  heroCard: {
    padding: 22,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  heroEyebrow: {
    fontSize: FONT_MICRO,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: TEXT_TERTIARY,
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: TEXT_PRIMARY,
  },
  heroSubtitle: {
    fontSize: FONT_CALLOUT,
    lineHeight: 20,
    color: TEXT_SECONDARY,
  },
  heroBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  groupCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitleWrap: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 0.5,
    borderTopColor: BORDER_SOFT,
    paddingVertical: 3,
  },
  rowLabel: {
    flex: 1,
    fontSize: FONT_BODY,
    lineHeight: 21,
    color: TEXT_PRIMARY,
  },
  rowLabelDestructive: {
    color: COLOR_RED,
  },
  rowLabelDisabled: {
    color: TEXT_SECONDARY,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  rowValueDestructive: {
    color: COLOR_RED,
  },
  rowValueDisabled: {
    color: TEXT_TERTIARY,
  },
  stateCard: {
    padding: 20,
    alignItems: 'flex-start',
  },
  stateIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  stateTitle: {
    marginTop: 16,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: TEXT_PRIMARY,
  },
  stateSubtitle: {
    marginTop: 8,
    fontSize: FONT_BODY,
    lineHeight: 22,
    color: TEXT_SECONDARY,
  },
  stateActions: {
    width: '100%',
    gap: 10,
    marginTop: 18,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEXT_PRIMARY,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
  },
  segmentChip: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 14,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentChipText: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
