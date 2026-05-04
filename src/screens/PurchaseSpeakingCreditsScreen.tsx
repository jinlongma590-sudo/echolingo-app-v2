import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { Alert, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ActionButton, ChromeIconButton, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { useIapCatalog } from '@/hooks/useIapCatalog';
import { useIapPurchaseFlow } from '@/hooks/useIapPurchaseFlow';
import { useMobileMe } from '@/hooks/useMobileMe';
import { safeBack } from '@/navigation/safeBack';
import { createMobileCheckout, MobileCheckoutApiError, type MobileCheckoutProduct } from '@/services/api/mobileCheckout';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { openAppSafeUrl } from '@/utils/appSafeLink';
import {
  BG_PAGE,
  BORDER_SOFT,
  COLOR_BLUE,
  COLOR_BLUE_BG,
  COLOR_GREEN,
  COLOR_RED,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';

function getCreditsPackageSummary(productId: string) {
  switch (productId) {
    case 'cn.echolingo.appv2.credits.5':
      return '适合轻量体验 AI 口语练习。';
    case 'cn.echolingo.appv2.credits.15':
      return '适合连续几天的口语训练。';
    case 'cn.echolingo.appv2.credits.30':
      return '适合较长周期稳定练习。';
    default:
      return '按你的练习节奏灵活补充口语额度。';
  }
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

function resolveAndroidCreditsProduct(productId: string): MobileCheckoutProduct | null {
  switch (productId) {
    case 'cn.echolingo.appv2.credits.5':
      return 'speaking_credits_5';
    case 'cn.echolingo.appv2.credits.15':
      return 'speaking_credits_15';
    case 'cn.echolingo.appv2.credits.30':
      return 'speaking_credits_30';
    default:
      return null;
  }
}

export function PurchaseSpeakingCreditsScreen() {
  const insets = useSafeAreaInsets();
  const { status, data, refresh } = useMobileMe();
  const { creditProducts, error, loading, refresh: refreshCatalog } = useIapCatalog();
  const session = useAppSession();
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
  const [selectedProductId, setSelectedProductId] = useState<string>('cn.echolingo.appv2.credits.15');
  const [androidCheckoutBusy, setAndroidCheckoutBusy] = useState(false);
  const [androidCheckoutError, setAndroidCheckoutError] = useState<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const refreshInFlightRef = useRef(false);
  const isAuthenticated = session.status === 'authenticated';
  const accessToken = session.session?.accessToken ?? null;

  const refreshCreditsState = useCallback(async () => {
    if (!isAndroid || !isAuthenticated || !accessToken || refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    try {
      await refresh();
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [accessToken, isAndroid, isAuthenticated, refresh]);

  useEffect(() => {
    const featuredProduct = creditProducts.find((product) => product.featured);
    const defaultProduct = featuredProduct ?? creditProducts[0];
    if (defaultProduct && !creditProducts.some((product) => product.productId === selectedProductId)) {
      setSelectedProductId(defaultProduct.productId);
    }
  }, [creditProducts, selectedProductId]);

  useEffect(() => {
    if (!isIos || creditProducts.length === 0) {
      return;
    }

    creditProducts.forEach((product) => {
      console.log('[iap][screen] credits product render price', {
        productId: product.productId,
        displayPrice: product.displayPrice,
        localizedPrice: product.localizedPrice,
        priceCny: product.priceCny ?? null,
        currencyCode: product.currencyCode,
        displayPriceSource: product.displayPriceSource,
      });
    });
  }, [creditProducts, isIos]);

  const selectedProduct =
    creditProducts.find((product) => product.productId === selectedProductId)
    ?? creditProducts.find((product) => product.featured)
    ?? creditProducts[0]
    ?? null;

  const ctaLabel =
    phase === 'purchasing'
      ? '正在购买...'
      : phase === 'verifying'
        ? '正在确认购买...'
      : phase === 'finishing'
          ? '正在同步购买状态...'
          : session.isHydrating
            ? '正在恢复登录状态...'
            : !isAuthenticated && status === 'no_session'
            ? '登录后继续'
            : isIos
              ? '使用 App 内购买'
              : isAndroid
                ? androidCheckoutBusy
                  ? '正在打开付款页面...'
                  : '前往付款页'
                : '继续购买';

  useFocusEffect(
    useCallback(() => {
      if (isAndroid && isAuthenticated && accessToken) {
        void refreshCreditsState();
      }
      return undefined;
    }, [accessToken, isAndroid, isAuthenticated, refreshCreditsState]),
  );

  useEffect(() => {
    appStateRef.current = AppState.currentState;

    if (!isAndroid || !isAuthenticated || !accessToken) {
      return undefined;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground =
        appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;

      if (nextState === 'active' && wasBackground) {
        void refreshCreditsState();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [accessToken, isAndroid, isAuthenticated, refreshCreditsState]);

  const handlePurchase = async () => {
    if (!isAuthenticated) {
      router.push('/auth/sign-in');
      return;
    }

    if (isAndroid) {
      if (!accessToken) {
        Alert.alert('请先登录', '请先登录当前 App 账号，再继续购买口语额度。');
        router.push('/auth/sign-in');
        return;
      }

      const checkoutProduct = selectedProduct
        ? resolveAndroidCreditsProduct(selectedProduct.productId)
        : null;

      if (!checkoutProduct) {
        const message = '暂时无法创建购买订单，请稍后重试。';
        setAndroidCheckoutError(message);
        Alert.alert('购买失败', message);
        return;
      }

      setAndroidCheckoutBusy(true);
      setAndroidCheckoutError(null);

      try {
        const { checkoutUrl } = await createMobileCheckout(accessToken, checkoutProduct);
        await openAppSafeUrl(checkoutUrl);
      } catch (checkoutError) {
        if (checkoutError instanceof MobileCheckoutApiError && checkoutError.code === 'unauthorized') {
          setAndroidCheckoutError('请先登录后再继续。');
          Alert.alert('请先登录', '请先登录当前 App 账号，再继续购买口语额度。');
          router.push('/auth/sign-in');
          return;
        }

        const message =
          checkoutError instanceof MobileCheckoutApiError
            ? checkoutError.message
            : '暂时无法创建购买订单，请稍后重试。';
        setAndroidCheckoutError(message);
        Alert.alert('购买失败', message);
      } finally {
        setAndroidCheckoutBusy(false);
      }
      return;
    }

    if (!selectedProduct) {
      return;
    }

    await purchaseProduct(selectedProduct);
  };

  const handleRestore = async () => {
    if (!isAuthenticated) {
      router.push('/auth/sign-in');
      return;
    }

    if (Platform.OS !== 'ios') {
      Alert.alert('恢复购买', '当前平台暂不支持 App Store 恢复购买。');
      return;
    }

    await restorePurchases();
  };

  const creditsLabel =
    status === 'ready'
      ? `${Math.max(data?.entitlements.speakingCredits ?? 0, 0)} Credits`
      : session.isHydrating
        ? '读取中'
      : !isAuthenticated && status === 'no_session'
        ? '登录后查看'
      : status === 'sync_failed'
          ? '暂未同步'
          : '读取中';

  const renderStatusCard = () => {
    const showUnavailable = isIos && Boolean(selectedProduct && !selectedProduct.storeAvailable && !loading);

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
    const iconColor = toneToIconColor(tone);

    return (
      <SurfaceCard style={styles.statusCard}>
        {title ? <StatusPill label={title} tone={tone} /> : null}
        {title ? (
          <View style={styles.statusHeader}>
            <Ionicons name="receipt-outline" size={18} color={iconColor} />
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
        {pendingTransaction && !isBusy ? (
          <View style={styles.pendingCard}>
            <AppText style={styles.pendingTitle}>有一笔购买需要继续处理</AppText>
            <AppText style={styles.pendingDetail}>
              {pendingCount > 1
                ? `当前有 ${pendingCount} 笔购买还需处理，建议先完成后再发起新的购买。`
                : '建议先完成这笔购买，再发起新的购买。'}
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
      contentContainerStyle={[styles.container, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}
      showsVerticalScrollIndicator={false}
      includeBottomInset={false}
    >
      <View style={styles.topBar}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my/account')} accessibilityLabel="返回账号页" />
      </View>

      <View style={styles.headerBlock}>
        <AppText style={styles.pageTitle}>购买口语额度</AppText>
        <AppText style={styles.pageSubtitle}>用于 AI 口语对话、实时练习与训练反馈</AppText>
        <AppText style={styles.pageNote}>
          Credits 会在完成训练后按实际使用情况扣除。
        </AppText>
      </View>

      <SurfaceCard style={styles.balanceCard}>
        <View style={styles.balanceRow}>
          <View style={styles.balanceIconWrap}>
            <Ionicons name="mic-outline" size={18} color={COLOR_BLUE} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText style={styles.balanceLabel}>当前额度</AppText>
            <AppText style={styles.balanceValue}>{creditsLabel}</AppText>
            <AppText style={styles.balanceHint}>
              {session.isHydrating
                ? '正在恢复当前账号状态。'
                : !isAuthenticated && status === 'no_session'
                ? '登录后即可查看你的口语额度。'
                : status === 'sync_failed'
                  ? '当前额度暂时无法获取，请稍后重试。'
                  : '训练结束后会同步本次使用情况。'}
            </AppText>
          </View>
        </View>
      </SurfaceCard>

      <View style={styles.sectionBlock}>
        <AppText style={styles.sectionTitle}>选择套餐</AppText>
        <AppText style={styles.sectionSubtitle}>按你的练习频率选择合适的 Credits 套餐。</AppText>
      </View>

      {creditProducts.map((product) => {
        const selected = selectedProduct?.productId === product.productId;
        return (
          <Pressable
            key={product.productId}
            accessibilityRole="button"
            onPress={() => setSelectedProductId(product.productId)}
            style={({ pressed }) => [
              styles.packPressable,
              selected && styles.packPressableSelected,
              pressed && styles.packPressablePressed,
            ]}
          >
            <SurfaceCard style={[styles.packCard, selected && styles.packCardSelected]}>
              <View style={styles.packTopRow}>
                <View style={styles.packTitleGroup}>
                  <AppText style={styles.packTitle}>{product.displayName}</AppText>
                  {product.featured ? (
                    <View style={styles.featuredPill}>
                      <AppText style={styles.featuredPillText}>推荐</AppText>
                    </View>
                  ) : null}
                </View>
                {selected ? <Ionicons name="checkmark-circle" size={20} color={COLOR_BLUE} /> : null}
              </View>
              <View style={styles.packMetaRow}>
                <AppText style={styles.packPrice}>
                  {isAndroid
                    ? formatCnyPrice(product.priceCny) ?? '暂未获取价格'
                    : product.displayPrice ?? (loading ? '正在读取 App Store 价格' : '暂未从 App Store 获取价格')}
                </AppText>
              </View>
              <AppText style={styles.packHint}>{getCreditsPackageSummary(product.productId)}</AppText>
            </SurfaceCard>
          </Pressable>
        );
      })}

      {renderStatusCard()}

      {isAndroid ? (
        <AppText style={styles.footerHint}>
          {androidCheckoutError ?? '付款完成后返回 App，口语额度会自动同步。'}
        </AppText>
      ) : error ? (
        <AppText style={styles.footerHint}>暂时无法显示商店价格，你仍可先查看可选套餐。</AppText>
      ) : null}

      {!session.isHydrating && !isAuthenticated && status === 'no_session' ? (
        <ActionButton label="登录后继续" variant="dark" onPress={() => router.push('/auth/sign-in')} />
      ) : (
        <ActionButton
          label={ctaLabel}
          variant="dark"
          onPress={() => void handlePurchase()}
          disabled={
            androidCheckoutBusy ||
            isBusy ||
            (isIos && Boolean(selectedProduct) && !selectedProduct.storeAvailable)
          }
        />
      )}

      {isIos ? (
        <View style={styles.restoreSection}>
          <ActionButton
            label={phase === 'restore_checking' ? '正在恢复购买...' : '恢复购买'}
            variant="secondary"
            onPress={() => void handleRestore()}
            disabled={isBusy}
          />
          <AppText style={styles.restoreHint}>如已购买但权益未显示，可尝试恢复购买。</AppText>
        </View>
      ) : null}
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING_PAGE_H,
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
  pageNote: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  sectionBlock: {
    gap: 4,
    paddingTop: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  balanceCard: {
    marginHorizontal: 0,
    padding: 20,
  },
  balanceRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  balanceIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${COLOR_BLUE}14`,
  },
  balanceLabel: {
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  balanceValue: {
    fontSize: 24,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  balanceHint: {
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  packCard: {
    marginHorizontal: 0,
    padding: 20,
    gap: 12,
  },
  packPressable: {
    borderRadius: 24,
  },
  packPressablePressed: {
    opacity: 0.88,
  },
  packPressableSelected: {
    transform: [{ scale: 0.995 }],
  },
  packCardSelected: {
    borderWidth: 1.5,
    borderColor: COLOR_BLUE,
    backgroundColor: COLOR_BLUE_BG,
  },
  packTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  packTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  packTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  packMetaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  packPrice: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    flexShrink: 1,
  },
  packHint: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  featuredPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: `${COLOR_GREEN}14`,
    borderWidth: 1,
    borderColor: `${COLOR_GREEN}20`,
  },
  featuredPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLOR_GREEN,
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
  restoreSection: {
    gap: 10,
  },
  restoreHint: {
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_SECONDARY,
    textAlign: 'center',
  },
});
