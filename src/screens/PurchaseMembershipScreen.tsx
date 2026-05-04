import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { AppState, Platform, Alert, StyleSheet, View } from 'react-native';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ActionButton, ChromeIconButton, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { useIapCatalog } from '@/hooks/useIapCatalog';
import { useIapPurchaseFlow } from '@/hooks/useIapPurchaseFlow';
import { useMobileMe } from '@/hooks/useMobileMe';
import { safeBack } from '@/navigation/safeBack';
import { MobileCheckoutApiError, createMobileCheckout } from '@/services/api/mobileCheckout';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { openAppSafeUrl } from '@/utils/appSafeLink';
import {
  BG_PAGE,
  COLOR_BLUE,
  COLOR_GREEN,
  COLOR_RED,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';

function BenefitCard({
  icon,
  title,
  detail,
  tint,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail: string;
  tint: string;
}) {
  return (
    <SurfaceCard style={styles.benefitCard}>
      <View style={[styles.iconWrap, { backgroundColor: `${tint}14` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <AppText style={styles.benefitTitle}>{title}</AppText>
        <AppText style={styles.benefitDetail}>{detail}</AppText>
      </View>
    </SurfaceCard>
  );
}

function toneToIconColor(tone: 'neutral' | 'blue' | 'amber' | 'green' | 'red') {
  switch (tone) {
    case 'blue':
      return COLOR_BLUE;
    case 'green':
      return COLOR_GREEN;
    case 'red':
      return COLOR_RED;
    case 'amber':
      return '#D97706';
    default:
      return TEXT_SECONDARY;
  }
}

function formatCnyPrice(priceCny: number | null | undefined) {
  if (typeof priceCny !== 'number' || !Number.isFinite(priceCny)) {
    return null;
  }

  return `¥${priceCny.toFixed(2)}`;
}

export function PurchaseMembershipScreen() {
  const { membershipProduct, loading, error, refresh: refreshCatalog } = useIapCatalog();
  const { status: mobileMeStatus, data: mobileMeData, refresh } = useMobileMe();
  const session = useAppSession();
  const [androidCheckoutBusy, setAndroidCheckoutBusy] = useState(false);
  const [androidCheckoutError, setAndroidCheckoutError] = useState<string | null>(null);
  const {
    phase,
    phaseTitle,
    phaseDetail,
    phaseTone,
    pendingTransaction,
    pendingCount,
    isBusy,
    purchaseProduct,
    resumePendingTransaction,
    restorePurchases,
  } = useIapPurchaseFlow({
    accessToken: session.session?.accessToken ?? null,
    refreshAccount: refresh,
  });
  const isIos = Platform.OS === 'ios';
  const isAndroid = Platform.OS === 'android';

  const ctaLabel =
    phase === 'purchasing'
      ? '正在购买...'
      : phase === 'verifying'
        ? '正在确认购买...'
        : phase === 'finishing'
          ? '正在同步购买状态...'
          : session.status !== 'authenticated'
            ? '登录后继续'
            : isIos
              ? '开通会员'
              : isAndroid
                ? androidCheckoutBusy
                  ? '正在打开付款页面...'
                  : '前往付款页完成开通'
                : '继续开通';
  const membershipActivated = mobileMeStatus === 'ready' && Boolean(mobileMeData?.entitlements.isActivated);
  const currentAccountEmail = mobileMeData?.user.email ?? session.user?.email ?? null;
  const androidPriceLabel = formatCnyPrice(membershipProduct?.priceCny);
  const androidBindingHint = currentAccountEmail
    ? `本次开通将绑定当前账号：${currentAccountEmail}`
    : '本次开通将绑定当前登录账号';
  const androidWebHint = '付款完成后返回 App，会员状态会自动同步。';
  const appStateRef = useRef(AppState.currentState);

  useFocusEffect(
    useCallback(() => {
      if (isAndroid && session.status === 'authenticated') {
        void refresh();
      }
      return undefined;
    }, [isAndroid, refresh, session.status]),
  );

  useEffect(() => {
    appStateRef.current = AppState.currentState;

    if (!isAndroid || session.status !== 'authenticated') {
      return undefined;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground =
        appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;

      if (nextState === 'active' && wasBackground) {
        void refresh();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isAndroid, refresh, session.status]);

  useEffect(() => {
    if (!membershipActivated) {
      return;
    }

    setAndroidCheckoutBusy(false);
    setAndroidCheckoutError(null);
  }, [membershipActivated]);

  useEffect(() => {
    if (!isIos || !membershipProduct) {
      return;
    }

    console.log('[iap][screen] membership product render price', {
      productId: membershipProduct.productId,
      displayPrice: membershipProduct.displayPrice,
      localizedPrice: membershipProduct.localizedPrice,
      priceCny: membershipProduct.priceCny ?? null,
      currencyCode: membershipProduct.currencyCode,
      displayPriceSource: membershipProduct.displayPriceSource,
    });
  }, [isIos, membershipProduct]);

  const handlePurchase = async () => {
    if (session.status !== 'authenticated') {
      router.push('/auth/sign-in');
      return;
    }

    if (isAndroid) {
      const accessToken = session.session?.accessToken ?? null;
      if (!accessToken) {
        Alert.alert('请先登录', '请先登录当前 App 账号，再继续开通。');
        router.push('/auth/sign-in');
        return;
      }

      setAndroidCheckoutBusy(true);
      setAndroidCheckoutError(null);

      try {
        const { checkoutUrl } = await createMobileCheckout(accessToken);
        await openAppSafeUrl(checkoutUrl);
      } catch (checkoutError) {
        if (checkoutError instanceof MobileCheckoutApiError && checkoutError.code === 'unauthorized') {
          setAndroidCheckoutError('请先登录后再继续。');
          Alert.alert('请先登录', '请先登录当前 App 账号，再继续开通。');
          router.push('/auth/sign-in');
          return;
        }

        const message =
          checkoutError instanceof MobileCheckoutApiError
            ? checkoutError.message
            : '暂时无法创建开通订单，请稍后重试。';
        setAndroidCheckoutError(message);
        Alert.alert('开通失败', message);
      } finally {
        setAndroidCheckoutBusy(false);
      }
      return;
    }

    if (!membershipProduct) {
      return;
    }

    await purchaseProduct(membershipProduct);
  };

  const handleRestore = async () => {
    if (session.status !== 'authenticated') {
      router.push('/auth/sign-in');
      return;
    }

    if (!isIos) {
      Alert.alert('恢复购买', '当前平台暂不支持 App Store 恢复购买。');
      return;
    }

    await restorePurchases();
  };

  const renderStatusCard = () => {
    const showUnavailable = isIos && Boolean(membershipProduct && !membershipProduct.storeAvailable && !loading);

    if (isAndroid) {
      return null;
    }

    if (!phaseTitle && !pendingTransaction && !showUnavailable) {
      return null;
    }

    const tone = showUnavailable ? 'red' : phaseTone;
    const title = showUnavailable ? '商品暂不可用' : phaseTitle;
    const detail = showUnavailable
      ? '暂时无法获取 App Store 价格，请稍后重试。'
      : phaseDetail;
    const tint = toneToIconColor(tone);
    const showPendingPrompt = Boolean(pendingTransaction && !isBusy);

    return (
      <SurfaceCard style={styles.statusCard}>
        {title ? <StatusPill label={title} tone={tone} /> : null}
        {title ? (
          <View style={styles.statusHeader}>
            <Ionicons name="receipt-outline" size={18} color={tint} />
            <AppText style={styles.statusTitle}>{title}</AppText>
          </View>
        ) : null}
        {detail ? <AppText style={styles.statusDetail}>{detail}</AppText> : null}
        {showUnavailable ? (
          <ActionButton
            label="重新获取价格"
            variant="secondary"
            onPress={() => void refreshCatalog()}
            disabled={loading}
          />
        ) : null}
        {showPendingPrompt ? (
          <View style={styles.pendingCard}>
            <AppText style={styles.pendingTitle}>有一笔购买需要继续处理</AppText>
            <AppText style={styles.pendingDetail}>
              {pendingCount > 1
                ? `当前有 ${pendingCount} 笔购买还需处理，建议先完成后再继续新的购买。`
                : '建议先完成这笔购买，再继续新的购买。'}
            </AppText>
            <View style={styles.inlineActions}>
              <ActionButton
                label="继续处理购买"
                variant="dark"
                onPress={() => void resumePendingTransaction()}
                disabled={isBusy}
                style={{ flex: 1 }}
              />
              <ActionButton
                label="找回已购权益"
                variant="secondary"
                onPress={() => void handleRestore()}
                disabled={isBusy}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}
      </SurfaceCard>
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
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my/account')} accessibilityLabel="返回账号页" />
      </View>

      <View style={styles.headerBlock}>
        <AppText style={styles.pageTitle}>{isAndroid ? '开通 EchoLingo Pro' : '开通 EchoLingo'}</AppText>
        <AppText style={styles.pageSubtitle}>一次开通，长期使用完整学习权限。</AppText>
        <AppText style={styles.pageHint}>口语练习使用 Credits，开通后可按需购买口语额度。</AppText>
      </View>

      <BenefitCard
        icon="headset-outline"
        title="完整精听训练"
        detail="进入完整精听学习链路，持续推进听力训练。"
        tint={COLOR_BLUE}
      />
      <BenefitCard
        icon="sparkles-outline"
        title="单词深度分析"
        detail="查看更完整的学习分析、重点问题与复习洞察。"
        tint={COLOR_GREEN}
      />
      <BenefitCard
        icon="sync-outline"
        title="跨设备同步学习记录"
        detail="同步精听、单词、口语记录，跨设备延续学习进度。"
        tint={COLOR_BLUE}
      />

      {membershipActivated ? (
        <SurfaceCard style={styles.priceCard}>
          <AppText style={styles.priceLabel}>当前状态</AppText>
          <AppText style={styles.priceValue}>已开通完整学习权限</AppText>
          <AppText style={styles.priceBadge}>会员权益已激活，可长期使用。</AppText>
          <AppText style={styles.priceHint}>
            你现在可以使用完整精听训练、单词深度分析与学习记录同步。
          </AppText>
        </SurfaceCard>
      ) : (
        <SurfaceCard style={styles.priceCard}>
          <AppText style={styles.priceLabel}>{isAndroid ? 'EchoLingo Pro' : membershipProduct?.displayName ?? 'EchoLingo 完整学习权限'}</AppText>
          <AppText style={styles.priceValue}>
            {isAndroid
              ? androidPriceLabel ?? (loading ? '正在读取开通价格' : '暂未获取开通价格')
              : membershipProduct?.displayPrice ?? (loading ? '正在读取 App Store 价格' : '暂未从 App Store 获取价格')}
          </AppText>
          <AppText style={styles.priceBadge}>
            {isAndroid ? '一次性开通' : '一次性购买，不是月付订阅。'}
          </AppText>
          <AppText style={styles.priceHint}>
            {isAndroid
              ? androidBindingHint
              : '解锁完整精听训练、单词深度分析与学习记录同步。'}
          </AppText>
          {isAndroid ? (
            <View style={styles.androidCheckoutBlock}>
              <ActionButton
                label={ctaLabel}
                variant="dark"
                onPress={() => void handlePurchase()}
                disabled={androidCheckoutBusy}
              />
              <AppText style={styles.androidCheckoutHint}>
                {androidCheckoutError ?? androidWebHint}
              </AppText>
            </View>
          ) : null}
        </SurfaceCard>
      )}

      {renderStatusCard()}

      {error || (!isAndroid && androidCheckoutError) ? (
        <AppText style={styles.footerHint}>
          {androidCheckoutError ??
            (isAndroid ? '当前 Android 版本可继续完成开通流程。' : '暂时无法获取 App Store 价格，请稍后重试。')}
        </AppText>
      ) : null}

      {membershipActivated ? (
        <ActionButton
          label="返回账号"
          variant="dark"
          onPress={() => router.replace('/my/account')}
        />
      ) : (
        <ActionButton
          label={ctaLabel}
          variant="dark"
          onPress={() => void handlePurchase()}
          disabled={
            isBusy ||
            (isIos &&
              session.status === 'authenticated' &&
              (!membershipProduct || !membershipProduct.storeAvailable))
          }
        />
      )}

      {!isAndroid ? (
        <AppText style={styles.ctaHint}>
          {membershipActivated
            ? '完整学习权限已激活。口语 Credits 仍可按需单独购买。'
            : '这是一次性购买项目，不会自动续费。口语 Credits 可单独购买。'}
        </AppText>
      ) : null}

      {isIos ? (
        <ActionButton
          label={phase === 'restore_checking' ? '正在恢复购买...' : '恢复购买'}
          variant="secondary"
          onPress={() => void handleRestore()}
          disabled={isBusy}
        />
      ) : null}
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 32,
    gap: 18,
  },
  topBar: {
    paddingTop: 12,
    paddingBottom: 2,
  },
  headerBlock: {
    gap: 8,
  },
  pageTitle: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  pageSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: TEXT_SECONDARY,
  },
  pageHint: {
    fontSize: 13,
    lineHeight: 20,
    color: TEXT_SECONDARY,
  },
  benefitCard: {
    marginHorizontal: 0,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  benefitDetail: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  priceCard: {
    marginHorizontal: 0,
    padding: 20,
    gap: 10,
  },
  priceLabel: {
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  priceValue: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  priceBadge: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: COLOR_BLUE,
  },
  priceHint: {
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  androidCheckoutBlock: {
    gap: 10,
    paddingTop: 4,
  },
  androidCheckoutHint: {
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  statusCard: {
    marginHorizontal: 0,
    padding: 20,
    gap: 12,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  statusDetail: {
    fontSize: 13,
    lineHeight: 20,
    color: TEXT_SECONDARY,
  },
  pendingCard: {
    gap: 8,
    paddingTop: 6,
  },
  pendingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  pendingDetail: {
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 10,
  },
  footerHint: {
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  ctaHint: {
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
