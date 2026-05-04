import Constants from 'expo-constants';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { deleteCurrentAccount } from '@/services/api/account';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAiDataConsent } from '@/services/privacy/AiDataConsentProvider';
import { useAppTheme, type AppThemeMode } from '@/theme/AppThemeProvider';
import { openAppSafeUrl } from '@/utils/appSafeLink';

type MySettingsPanelProps = {
  onOpenFeedback: () => void;
  onRefreshData: () => Promise<void>;
  syncSummary: string;
  onSignedOut?: () => void;
  isAuthenticated?: boolean;
  onAccountDeleted?: () => void;
};

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.12 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 2,
  } as const;
}

async function openExternal(url: string) {
  try {
    await openAppSafeUrl(url);
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'blocked_purchase_risk_url'
        ? '请在 App 内完成购买或账号相关操作。'
        : '当前链接暂时无法打开。';
    Alert.alert('打开失败', message);
  }
}

export function MySettingsPanel({
  onOpenFeedback,
  onRefreshData,
  syncSummary,
  onSignedOut,
  isAuthenticated,
  onAccountDeleted,
}: MySettingsPanelProps) {
  const session = useAppSession();
  const aiConsent = useAiDataConsent();
  const { theme, themeMode, setThemeMode } = useAppTheme();
  const version = Constants.expoConfig?.version ?? '--';

  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const effectiveAuthenticated = isAuthenticated ?? session.status === 'authenticated';
  const accountEmail = effectiveAuthenticated ? session.user?.email ?? '未绑定邮箱' : '未登录';
  async function handleRefreshData() {
    if (!effectiveAuthenticated) {
      return;
    }
    try {
      await onRefreshData();
      setSyncStatusMessage('同步状态已更新');
    } catch {
      Alert.alert('同步失败', '暂时无法更新同步状态，请稍后再试。');
    }
  }

  async function handleConfirmedSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    try {
      await session.signOut();
      onSignedOut?.();
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleConfirmedDeleteAccount() {
    if (!effectiveAuthenticated || !session.session || isDeletingAccount) {
      return;
    }

    setIsDeletingAccount(true);
    try {
      await deleteCurrentAccount(session.session);
      await session.signOut();
      onAccountDeleted?.();
      Alert.alert('账号已删除', '你的账号和相关学习数据已提交删除处理。');
    } catch (error) {
      Alert.alert('删除失败', error instanceof Error ? error.message : '暂时无法删除账号，请稍后再试。');
    } finally {
      setIsDeletingAccount(false);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>设置</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          管理应用偏好与账号安全
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor),
            },
          ]}
        >
          <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>账号安全</AppText>
          <View style={styles.rowBetween}>
            <AppText style={[styles.label, { color: theme.textSecondary }]}>当前邮箱</AppText>
            <AppText style={[styles.value, { color: theme.textPrimary }]}>{accountEmail}</AppText>
          </View>
          <View style={styles.rowBetween}>
            <AppText style={[styles.label, { color: theme.textSecondary }]}>登录状态</AppText>
            <AppText style={[styles.value, { color: effectiveAuthenticated ? '#34C759' : theme.textSecondary }]}>
              {effectiveAuthenticated ? '已登录' : '未登录'}
            </AppText>
          </View>
          <View style={styles.rowBetween}>
            <AppText style={[styles.label, { color: theme.textSecondary }]}>账号保护</AppText>
            <AppText style={[styles.value, { color: theme.textPrimary }]}>
              {effectiveAuthenticated ? '已启用' : '登录后可用'}
            </AppText>
          </View>
          <AppText style={[styles.noteText, { color: theme.textSecondary }]}>
            {effectiveAuthenticated
              ? '你的账号由当前登录方式保护，敏感操作需要在登录状态下完成。'
              : '登录后可查看完整账号安全信息并同步云端数据。'}
          </AppText>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
            },
          ]}
        >
          <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>数据同步</AppText>
          <View style={styles.syncRow}>
            <AppText style={[styles.label, { color: theme.textSecondary }]}>学习记录</AppText>
            <AppText style={[styles.value, { color: theme.textPrimary }]}>
              {effectiveAuthenticated ? syncSummary : '登录后可同步学习记录。'}
            </AppText>
          </View>
          <View style={styles.syncRow}>
            <AppText style={[styles.label, { color: theme.textSecondary }]}>笔记与收藏</AppText>
            <AppText style={[styles.value, { color: theme.textPrimary }]}>
              {effectiveAuthenticated ? '随登录账号同步' : '登录后可同步'}
            </AppText>
          </View>
          <AppText style={[styles.noteText, { color: theme.textSecondary }]}>
            {effectiveAuthenticated ? '学习进度会在登录状态下自动同步。' : '登录后会自动同步学习进度。'}
          </AppText>
          {effectiveAuthenticated && syncStatusMessage ? (
            <AppText style={[styles.noteText, { color: '#34C759' }]}>{syncStatusMessage}</AppText>
          ) : null}
          {effectiveAuthenticated ? (
            <Pressable
              onPress={() => void handleRefreshData()}
              disabled={!effectiveAuthenticated}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primaryBlue },
                pressed && styles.cardPressed,
              ]}
            >
              <AppText style={styles.primaryButtonText}>重新同步</AppText>
            </Pressable>
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
            },
          ]}
        >
          <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>外观设置</AppText>
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
                      backgroundColor: active ? 'rgba(10,132,255,0.12)' : 'rgba(15,23,42,0.04)',
                      borderColor: active ? 'rgba(10,132,255,0.18)' : 'rgba(15,23,42,0.08)',
                    },
                  ]}
                >
                  <AppText style={[styles.segmentChipText, { color: active ? theme.primaryBlue : theme.textSecondary }]}>{item.label}</AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
            },
          ]}
        >
          <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>关于 EchoLingo</AppText>
          <View style={styles.rowBetween}>
            <AppText style={[styles.label, { color: theme.textSecondary }]}>App 名称</AppText>
            <AppText style={[styles.value, { color: theme.textPrimary }]}>EchoLingo</AppText>
          </View>
          <View style={styles.rowBetween}>
            <AppText style={[styles.label, { color: theme.textSecondary }]}>当前版本</AppText>
            <AppText style={[styles.value, { color: theme.textPrimary }]}>{version}</AppText>
          </View>
          <Pressable onPress={() => void openExternal('https://echolingo.cn/support')}>
            <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>支持中心 echolingo.cn/support</AppText>
          </Pressable>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
            },
          ]}
        >
          <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>隐私与协议</AppText>
          <Pressable onPress={aiConsent.openConsentNotice}>
            <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>AI 数据处理说明</AppText>
          </Pressable>
          <Pressable onPress={() => void openExternal('https://echolingo.cn/privacy')}>
            <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>隐私政策</AppText>
          </Pressable>
          <Pressable onPress={() => void openExternal('https://echolingo.cn/terms')}>
            <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>用户协议</AppText>
          </Pressable>
          <Pressable onPress={onOpenFeedback}>
            <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>反馈入口</AppText>
          </Pressable>
        </View>

        {effectiveAuthenticated ? (
          <Pressable
            disabled={isSigningOut}
            onPress={() =>
              Alert.alert('确认退出登录', '退出后需要重新登录才能继续同步学习数据。', [
                { text: '取消', style: 'cancel' },
                { text: '退出登录', style: 'destructive', onPress: () => void handleConfirmedSignOut() },
              ])
            }
            style={({ pressed }) => [
              styles.logoutButton,
              { backgroundColor: 'rgba(255,69,58,0.10)', borderColor: 'rgba(255,69,58,0.18)' },
              isSigningOut && styles.logoutButtonDisabled,
              pressed && !isSigningOut && styles.cardPressed,
            ]}
          >
            {isSigningOut ? <ActivityIndicator size="small" color="#FF453A" /> : null}
            <AppText style={styles.logoutText}>{isSigningOut ? '正在退出...' : '退出登录'}</AppText>
          </Pressable>
        ) : null}

        {effectiveAuthenticated ? (
          <Pressable
            disabled={isDeletingAccount}
            onPress={() =>
              Alert.alert(
                '删除账号',
                '删除账号后，你的账号信息会被删除或匿名化，学习记录、AI 练习记录、词汇学习记录及相关个人数据将被清除，且操作不可恢复。',
                [
                  { text: '取消', style: 'cancel' },
                  {
                    text: isDeletingAccount ? '处理中...' : '确认删除',
                    style: 'destructive',
                    onPress: () => void handleConfirmedDeleteAccount(),
                  },
                ],
              )
            }
            style={({ pressed }) => [
              styles.deleteButton,
              { backgroundColor: 'rgba(255,69,58,0.08)', borderColor: 'rgba(255,69,58,0.16)' },
              isDeletingAccount && styles.logoutButtonDisabled,
              pressed && !isDeletingAccount && styles.cardPressed,
            ]}
          >
            {isDeletingAccount ? <ActivityIndicator size="small" color="#FF453A" /> : null}
            <AppText style={styles.deleteText}>{isDeletingAccount ? '正在删除账号...' : '删除账号'}</AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 0 },
  panelHeader: { marginBottom: 14 },
  panelTitle: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.35 },
  panelSubtitle: { marginTop: 4, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  panelContent: { gap: 12 },
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  cardTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800', marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  syncRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  value: { fontSize: 14, lineHeight: 18, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  noteText: { marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  segmentChip: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentChipText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  primaryButton: { marginTop: 12, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FFFFFF' },
  linkText: { marginTop: 8, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  logoutButton: {
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    marginTop: 10,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonDisabled: { opacity: 0.62 },
  logoutText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FF453A' },
  deleteText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FF453A' },
  cardPressed: { opacity: 0.84 },
});
