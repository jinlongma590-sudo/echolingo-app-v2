import { Ionicons } from '@expo/vector-icons';
import { router, type Href, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ActionButton, ChromeIconButton, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { useIapPurchaseFlow } from '@/hooks/useIapPurchaseFlow';
import { useMobileMe } from '@/hooks/useMobileMe';
import { safeBack } from '@/navigation/safeBack';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  BG_CARD,
  BG_CARD_SOFT,
  BG_PAGE,
  BORDER_SOFT,
  BORDER_STRONG,
  COLOR_BLUE,
  COLOR_BLUE_BG,
  COLOR_GREEN,
  COLOR_RED,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';

function pickAvatarUrl(candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function AccountAvatar({ avatarUrl }: { avatarUrl: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  const canRenderImage = Boolean(avatarUrl && !imageFailed);

  if (canRenderImage && avatarUrl) {
    return (
      <View style={styles.accountAvatarWrap}>
        <Image
          source={{ uri: avatarUrl }}
          style={styles.accountAvatarImage}
          onError={() => setImageFailed(true)}
        />
      </View>
    );
  }

  return (
    <View style={styles.accountBadge}>
      <Ionicons name="person-outline" size={18} color={COLOR_BLUE} />
    </View>
  );
}

function StatusTag({ label, tone }: { label: string; tone: 'green' | 'blue' | 'neutral' }) {
  const palette =
    tone === 'green'
      ? { bg: 'rgba(52,199,89,0.10)', border: 'rgba(52,199,89,0.16)', text: COLOR_GREEN }
      : tone === 'blue'
        ? { bg: 'rgba(0,122,255,0.10)', border: 'rgba(0,122,255,0.16)', text: COLOR_BLUE }
        : { bg: 'rgba(142,142,147,0.10)', border: 'rgba(142,142,147,0.16)', text: TEXT_SECONDARY };

  return (
    <View
      style={[
        styles.statusTag,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
      ]}
    >
      <AppText style={[styles.statusTagText, { color: palette.text }]}>{label}</AppText>
    </View>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  accent = 'blue',
  trailing,
  children,
}: {
  title: string;
  value: string;
  detail: string;
  accent?: 'blue' | 'green' | 'neutral';
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const accentColor =
    accent === 'green' ? COLOR_GREEN : accent === 'blue' ? COLOR_BLUE : TEXT_SECONDARY;

  return (
    <SurfaceCard style={styles.summaryCard}>
      <View style={styles.summaryTopRow}>
        <View style={{ flex: 1, gap: 6 }}>
          <AppText style={styles.summaryTitle}>{title}</AppText>
          <AppText style={[styles.summaryValue, { color: accentColor }]}>{value}</AppText>
        </View>
        {trailing}
      </View>
      <AppText style={styles.summaryDetail}>{detail}</AppText>
      {children}
    </SurfaceCard>
  );
}

function OperationRow({
  icon,
  label,
  detail,
  onPress,
  tint = COLOR_BLUE,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail: string;
  onPress: () => void;
  tint?: string;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.operationRow, pressed && styles.rowPressed]}>
      <View style={[styles.operationIconWrap, { backgroundColor: `${tint}12` }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <AppText style={styles.operationLabel}>{label}</AppText>
        <AppText style={styles.operationDetail}>{detail}</AppText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

export function MyAccountScreen() {
  const { theme } = useAppTheme();
  const session = useAppSession();
  const { status, data, error, refresh } = useMobileMe();
  const [loggingOut, setLoggingOut] = useState(false);
  const isAuthenticated = session.status === 'authenticated';
  const canRefreshAccount = isAuthenticated && Boolean(session.session?.accessToken) && !session.isHydrating;
  const {
    phase: iapPhase,
    phaseTitle: iapPhaseTitle,
    phaseDetail: iapPhaseDetail,
    phaseTone: iapPhaseTone,
    pendingTransaction,
    pendingCount,
    isBusy: iapBusy,
    resumePendingTransaction,
    restorePurchases,
  } = useIapPurchaseFlow({
    accessToken: session.session?.accessToken ?? null,
    refreshAccount: refresh,
  });

  useFocusEffect(
    useCallback(() => {
      if (canRefreshAccount) {
        void refresh();
      }
      return undefined;
    }, [canRefreshAccount, refresh]),
  );

  const displayName = useMemo(() => {
    const fallbackEmailPrefix = session.user?.email?.split('@')[0] ?? null;
    return data?.user.displayName || session.user?.displayName || fallbackEmailPrefix || 'EchoLingo 用户';
  }, [data?.user.displayName, session.user?.displayName, session.user?.email]);

  const email = useMemo(() => data?.user.email || session.user?.email || '未绑定邮箱', [data?.user.email, session.user?.email]);
  const avatarUrl = useMemo(
    () =>
      pickAvatarUrl([
        session.user?.avatarUrl,
        data?.user.avatarUrl,
        data?.user.avatar_url,
        data?.user.avatar,
        data?.user.imageUrl,
        data?.user.photoURL,
      ]),
    [
      session.user?.avatarUrl,
      data?.user.avatarUrl,
      data?.user.avatar_url,
      data?.user.avatar,
      data?.user.imageUrl,
      data?.user.photoURL,
    ],
  );

  const handleSignIn = () => {
    router.push('/auth/sign-in');
  };

  const handleRestorePurchases = async () => {
    if (session.status !== 'authenticated') {
      router.push('/auth/sign-in');
      return;
    }

    await restorePurchases();
  };

  const performSignOut = async () => {
    setLoggingOut(true);
    try {
      await session.signOut();
      router.replace('/my');
    } catch {
      Alert.alert('退出登录失败', '请稍后再试。');
    } finally {
      setLoggingOut(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('退出登录', '退出后，此设备将不再保持登录状态。', [
      { text: '取消', style: 'cancel' },
      { text: '退出登录', style: 'destructive', onPress: () => void performSignOut() },
    ]);
  };

  const renderSignedOut = () => (
    <SurfaceCard style={styles.heroCard}>
      <View style={{ gap: 10 }}>
        <AppText style={styles.heroTitle}>登录后查看账号权益</AppText>
        <AppText style={styles.heroSubtitle}>
          登录后可同步学习记录、查看口语额度，并管理购买权益。
        </AppText>
      </View>
      <ActionButton label="登录 / 注册" variant="dark" onPress={handleSignIn} />
    </SurfaceCard>
  );

  const renderLoading = () => (
    <SurfaceCard style={styles.heroCard}>
      <View style={styles.centerState}>
        <ActivityIndicator color={TEXT_SECONDARY} />
        <AppText style={styles.loadingText}>正在读取账号信息</AppText>
      </View>
    </SurfaceCard>
  );

  const renderError = () => (
    <SurfaceCard style={styles.heroCard}>
      <View style={styles.centerState}>
        <Ionicons name="cloud-offline-outline" size={20} color={TEXT_SECONDARY} />
        <AppText style={styles.heroTitleSmall}>账号信息暂时读取失败</AppText>
        <AppText style={styles.heroSubtitle}>
          请稍后重试，或重新进入页面刷新账号信息。
        </AppText>
      </View>
      <ActionButton label="重试" variant="dark" onPress={() => void refresh()} />
    </SurfaceCard>
  );

  const renderSyncFailed = () => (
    <View style={styles.sectionStack}>
      <SurfaceCard style={styles.accountCard}>
        <View style={styles.accountCardTopRow}>
          <AccountAvatar avatarUrl={avatarUrl} />
          <View style={{ flex: 1, gap: 5 }}>
            <View style={styles.accountTitleRow}>
              <AppText style={styles.userName}>{displayName}</AppText>
              <StatusTag label="已登录" tone="green" />
            </View>
            <AppText style={styles.userMeta}>{email}</AppText>
          </View>
        </View>
      </SurfaceCard>

      <View style={styles.syncNoticeBar}>
        <View style={styles.syncNoticeTextWrap}>
          <AppText style={styles.syncNoticeTitle}>账号信息暂时无法获取</AppText>
          <AppText style={styles.syncNoticeDetail}>请检查网络后重试</AppText>
        </View>
        <Pressable onPress={() => void refresh()} style={({ pressed }) => [styles.noticeRetryButton, pressed && styles.rowPressed]}>
          <AppText style={styles.noticeRetryText}>重试</AppText>
        </Pressable>
      </View>

      <SummaryCard
        title="学习权益"
        value="暂时无法获取权益"
        detail={error ?? '当前网络或服务暂不可用，请稍后重试。'}
        accent="neutral"
        trailing={<StatusTag label="稍后重试" tone="neutral" />}
      />

      <SurfaceCard style={styles.operationCard}>
        <View style={styles.sectionHeader}>
          <AppText style={styles.sectionTitle}>管理购买与额度</AppText>
          <AppText style={styles.sectionSubtitle}>管理 App Store 购买与口语额度</AppText>
        </View>
        <View style={[styles.operationGroup, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
          <OperationRow
            icon="mic-outline"
            label="购买口语额度"
            detail="查看 Credits 套餐并继续购买。"
            onPress={() => router.push('/purchase/speaking-credits' as Href)}
          />
          {Platform.OS === 'ios' ? (
            <OperationRow
              icon="refresh-outline"
              label={iapPhase === 'restore_checking' ? '正在恢复购买...' : '恢复购买'}
              detail="找回已购买的权益与口语额度。"
              onPress={() => void handleRestorePurchases()}
              tint={TEXT_SECONDARY}
            />
          ) : null}
        </View>

        {Platform.OS === 'ios' && pendingTransaction ? (
          <View style={styles.pendingHintWrap}>
            <StatusPill label="购买遇到问题？" tone="amber" />
            <AppText style={styles.pendingHintTitle}>
              {pendingCount > 1 ? `当前有 ${pendingCount} 笔购买需要继续处理` : '有一笔购买需要继续处理'}
            </AppText>
            <AppText style={styles.pendingHintDetail}>
              如果你刚完成购买但权益还没更新，可以继续处理这笔购买。
            </AppText>
            <Pressable
              onPress={() => void resumePendingTransaction()}
              disabled={iapBusy}
              style={({ pressed }) => [styles.subtleAssistButton, pressed && styles.rowPressed, iapBusy && styles.disabledLink]}
            >
              <AppText style={styles.subtleAssistButtonText}>继续处理购买</AppText>
            </Pressable>
          </View>
        ) : null}
      </SurfaceCard>

      <SurfaceCard style={styles.signOutCard}>
        <View style={styles.sectionHeader}>
          <AppText style={styles.sectionTitle}>退出登录</AppText>
          <AppText style={styles.sectionSubtitle}>退出后，此设备将不再保持登录状态。</AppText>
        </View>
        <Pressable
          onPress={handleSignOut}
          disabled={loggingOut}
          style={({ pressed }) => [
            styles.signOutButton,
            { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border },
            pressed && styles.rowPressed,
            loggingOut && styles.disabledLink,
          ]}
        >
          <AppText style={styles.signOutText}>{loggingOut ? '退出中…' : '退出登录'}</AppText>
        </Pressable>
      </SurfaceCard>
    </View>
  );

  const renderReady = () => {
    if (!data) return null;

    const isActivated = data.entitlements.isActivated;
    const speakingCredits = Math.max(data.entitlements.speakingCredits ?? 0, 0);

    return (
      <View style={styles.sectionStack}>
        <SurfaceCard style={styles.accountCard}>
          <View style={styles.accountCardTopRow}>
            <AccountAvatar avatarUrl={avatarUrl} />
            <View style={{ flex: 1, gap: 5 }}>
              <View style={styles.accountTitleRow}>
                <AppText style={styles.userName}>{displayName}</AppText>
                <StatusTag label="已登录" tone="green" />
              </View>
              <AppText style={styles.userMeta}>{email}</AppText>
            </View>
          </View>
        </SurfaceCard>

        <SummaryCard
          title="学习权益"
          value={isActivated ? '已激活' : '未激活'}
          detail="可使用完整精听、单词学习与学习记录同步等能力。"
          accent={isActivated ? 'green' : 'neutral'}
          trailing={<StatusTag label={isActivated ? '完整学习权限' : '可随时开通'} tone={isActivated ? 'green' : 'neutral'} />}
        >
          {!isActivated ? (
            <View style={styles.inlineActionRow}>
              <ActionButton
                label="开通完整学习权限"
                variant="secondary"
                onPress={() => router.push('/purchase/membership' as Href)}
                style={styles.secondaryActionButton}
              />
            </View>
          ) : null}
        </SummaryCard>

        <SummaryCard
          title="AI 口语额度"
          value={`${speakingCredits} Credits`}
          detail="用于 AI 口语对话与实时练习，训练结束后会同步本次使用情况。"
          accent="blue"
          trailing={
            <View style={styles.creditIconWrap}>
              <Ionicons name="mic-outline" size={18} color={COLOR_BLUE} />
            </View>
          }
        >
          <View style={styles.inlineActionRow}>
            <ActionButton
              label="购买口语额度"
              variant="dark"
              onPress={() => router.push('/purchase/speaking-credits' as Href)}
              style={styles.primaryActionButton}
            />
            {Platform.OS === 'ios' ? (
              <Pressable onPress={() => void handleRestorePurchases()} disabled={iapBusy} style={({ pressed }) => [styles.linkButton, pressed && styles.rowPressed, iapBusy && styles.disabledLink]}>
                <AppText style={styles.linkButtonText}>
                  {iapPhase === 'restore_checking' ? '正在恢复购买...' : '恢复购买'}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </SummaryCard>

        <SurfaceCard style={styles.operationCard}>
          <View style={styles.sectionHeader}>
            <AppText style={styles.sectionTitle}>管理购买与额度</AppText>
            <AppText style={styles.sectionSubtitle}>管理 App Store 购买与口语额度</AppText>
          </View>
          <View style={[styles.operationGroup, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
            <OperationRow
              icon="mic-outline"
              label="购买口语额度"
              detail="查看 Credits 套餐并继续购买。"
              onPress={() => router.push('/purchase/speaking-credits' as Href)}
            />
            {Platform.OS === 'ios' ? (
              <OperationRow
                icon="refresh-outline"
                label={iapPhase === 'restore_checking' ? '正在恢复购买...' : '恢复购买'}
                detail="找回已购买的权益与口语额度。"
                onPress={() => void handleRestorePurchases()}
                tint={TEXT_SECONDARY}
              />
            ) : null}
          </View>

          {Platform.OS === 'ios' && pendingTransaction ? (
            <View style={styles.pendingHintWrap}>
              <StatusPill label="购买遇到问题？" tone="amber" />
              <AppText style={styles.pendingHintTitle}>
                {pendingCount > 1 ? `当前有 ${pendingCount} 笔购买需要继续处理` : '有一笔购买需要继续处理'}
              </AppText>
              <AppText style={styles.pendingHintDetail}>
                如果你刚完成购买但权益还没更新，可以继续处理这笔购买。
              </AppText>
              <Pressable
                onPress={() => void resumePendingTransaction()}
                disabled={iapBusy}
                style={({ pressed }) => [styles.subtleAssistButton, pressed && styles.rowPressed, iapBusy && styles.disabledLink]}
              >
                <AppText style={styles.subtleAssistButtonText}>继续处理购买</AppText>
              </Pressable>
            </View>
          ) : null}

          {Platform.OS === 'ios' && iapPhaseTitle ? (
            <View style={styles.phaseWrap}>
              <StatusPill label={iapPhaseTitle} tone={iapPhaseTone} />
              <AppText style={styles.phaseTitle}>{iapPhaseTitle}</AppText>
              <AppText style={styles.phaseDetail}>{iapPhaseDetail ?? '购买进度会在这里显示。'}</AppText>
            </View>
          ) : null}
        </SurfaceCard>

        <SurfaceCard style={styles.signOutCard}>
          <View style={styles.sectionHeader}>
            <AppText style={styles.sectionTitle}>退出登录</AppText>
            <AppText style={styles.sectionSubtitle}>退出后，此设备将不再保持登录状态。</AppText>
          </View>
          <Pressable
            onPress={handleSignOut}
            disabled={loggingOut}
            style={({ pressed }) => [
              styles.signOutButton,
              { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border },
              pressed && styles.rowPressed,
              loggingOut && styles.disabledLink,
            ]}
          >
            <AppText style={styles.signOutText}>{loggingOut ? '退出中…' : '退出登录'}</AppText>
          </Pressable>
        </SurfaceCard>
      </View>
    );
  };

  return (
    <AppScreenShell
      backgroundColor={BG_PAGE}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      includeBottomInset={false}
    >
      <View style={styles.topBar}>
      <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my')} accessibilityLabel="返回我的" />
      </View>

      {!isAuthenticated && !session.isHydrating && status === 'no_session' ? renderSignedOut() : null}
      {session.isHydrating || (isAuthenticated && status === 'no_session') || status === 'loading' ? renderLoading() : null}
      {status === 'sync_failed' ? renderSyncFailed() : null}
      {status === 'ready' ? renderReady() : null}
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 36,
    paddingHorizontal: SPACING_PAGE_H,
    backgroundColor: BG_PAGE,
    gap: 14,
  },
  topBar: {
    paddingTop: 4,
    paddingBottom: 2,
  },
  heroCard: {
    marginHorizontal: 0,
    padding: 22,
    backgroundColor: BG_CARD,
    borderRadius: 28,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  heroTitleSmall: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  heroSubtitle: {
    fontSize: FONT_CALLOUT,
    lineHeight: 21,
    color: TEXT_SECONDARY,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  loadingText: {
    fontSize: FONT_CALLOUT,
    color: TEXT_SECONDARY,
  },
  syncNoticeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: BG_CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
  },
  syncNoticeTextWrap: {
    flex: 1,
    gap: 2,
  },
  syncNoticeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  syncNoticeDetail: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  noticeRetryButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,122,255,0.08)',
  },
  noticeRetryText: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
    color: COLOR_BLUE,
  },
  sectionStack: {
    gap: 18,
  },
  accountCard: {
    marginHorizontal: 0,
    padding: 20,
    borderRadius: 28,
    backgroundColor: BG_CARD,
  },
  accountCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  accountBadge: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR_BLUE_BG,
    borderWidth: 1,
    borderColor: 'rgba(0,122,255,0.10)',
  },
  accountAvatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    overflow: 'hidden',
    backgroundColor: COLOR_BLUE_BG,
    borderWidth: 1,
    borderColor: 'rgba(0,122,255,0.10)',
  },
  accountAvatarImage: {
    width: '100%',
    height: '100%',
  },
  accountTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  userName: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  userMeta: {
    fontSize: FONT_CALLOUT,
    color: TEXT_SECONDARY,
  },
  statusTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  statusTagText: {
    fontSize: FONT_MICRO,
    fontWeight: '700',
  },
  summaryCard: {
    marginHorizontal: 0,
    padding: 20,
    borderRadius: 28,
    backgroundColor: BG_CARD,
    gap: 10,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  summaryTitle: {
    fontSize: FONT_CALLOUT,
    color: TEXT_SECONDARY,
  },
  summaryValue: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
  },
  summaryDetail: {
    fontSize: FONT_CALLOUT,
    lineHeight: 20,
    color: TEXT_SECONDARY,
  },
  creditIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR_BLUE_BG,
  },
  inlineActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 2,
    flexWrap: 'wrap',
  },
  primaryActionButton: {
    minWidth: 150,
    borderRadius: 18,
  },
  secondaryActionButton: {
    borderRadius: 18,
  },
  linkButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  linkButtonText: {
    fontSize: FONT_CALLOUT,
    fontWeight: '600',
    color: COLOR_BLUE,
  },
  operationCard: {
    marginHorizontal: 0,
    padding: 20,
    borderRadius: 28,
    backgroundColor: BG_CARD,
    gap: 14,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  sectionSubtitle: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  operationGroup: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    backgroundColor: BG_CARD_SOFT,
  },
  operationRow: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_SOFT,
  },
  operationIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operationLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  operationDetail: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  rowPressed: {
    opacity: 0.72,
  },
  pendingHintWrap: {
    gap: 8,
    paddingTop: 6,
  },
  pendingHintTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  pendingHintDetail: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  subtleAssistButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,122,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,122,255,0.10)',
  },
  subtleAssistButtonText: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
    color: COLOR_BLUE,
  },
  phaseWrap: {
    gap: 8,
    paddingTop: 2,
  },
  phaseTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  phaseDetail: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  signOutCard: {
    marginHorizontal: 0,
    padding: 20,
    borderRadius: 28,
    backgroundColor: BG_CARD,
    gap: 14,
  },
  signOutButton: {
    minHeight: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER_STRONG,
    backgroundColor: BG_CARD_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLOR_RED,
  },
  disabledLink: {
    opacity: 0.45,
  },
});
