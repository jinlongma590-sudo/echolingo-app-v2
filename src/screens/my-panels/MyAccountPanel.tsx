import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import React from 'react';

import { AppText } from '@/components/AppText';
import { useIapPurchaseFlow } from '@/hooks/useIapPurchaseFlow';
import { useAppTheme } from '@/theme/AppThemeProvider';

const accountBadgeLightImage = require('../../../assets/images/account/account_badge_v3_clean.png');
const accountBadgeDarkImage = require('../../../assets/images/account/account2.png');

type MyAccountPanelProps = {
  isActivated: boolean;
  membershipType?: string | null;
  membershipExpiry?: string | null;
  canUseAiPractice: boolean;
  canUsePremiumLibrary: boolean;
  canUseVocabulary: boolean;
  hasLearningSync: boolean;
  speakingCredits: number;
  accessToken: string | null;
  refreshAccount: () => Promise<unknown>;
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

function EntitlementCard({
  title,
  enabled,
}: {
  title: string;
  enabled: boolean;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.entitlementCard,
        {
          backgroundColor:
            theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
          borderColor: 'rgba(15,23,42,0.08)',
        },
      ]}
    >
      <View
        style={[
          styles.entitlementIconWrap,
          { backgroundColor: enabled ? 'rgba(10,132,255,0.12)' : 'rgba(15,23,42,0.06)' },
        ]}
      >
        <Ionicons
          name={enabled ? 'checkmark-outline' : 'lock-closed-outline'}
          size={18}
          color={enabled ? theme.primaryBlue : theme.textSecondary}
        />
      </View>
      <AppText style={[styles.entitlementTitle, { color: theme.textPrimary }]} numberOfLines={2}>
        {title}
      </AppText>
      <AppText style={[styles.entitlementStatus, { color: enabled ? theme.primaryBlue : theme.textSecondary }]}>
        {enabled ? '当前可用' : '需解锁'}
      </AppText>
    </View>
  );
}

export function MyAccountPanel({
  isActivated,
  membershipType,
  membershipExpiry,
  canUseAiPractice,
  canUsePremiumLibrary,
  canUseVocabulary,
  hasLearningSync,
  speakingCredits,
  accessToken,
  refreshAccount,
}: MyAccountPanelProps) {
  const { theme } = useAppTheme();
  const accountBadgeImage = theme.colorScheme === 'dark' ? accountBadgeDarkImage : accountBadgeLightImage;
  const {
    phase,
    phaseTitle,
    phaseDetail,
    restorePurchases,
    isBusy,
  } = useIapPurchaseFlow({
    accessToken,
    refreshAccount,
  });

  const entitlements = [
    { key: 'ai-practice', title: 'AI 口语练习', enabled: canUseAiPractice },
    { key: 'realtime-call', title: '实时语音通话', enabled: canUseAiPractice },
    { key: 'listening-history', title: '精听学习记录', enabled: hasLearningSync },
    { key: 'vocabulary', title: '单词个性化复习', enabled: canUseVocabulary },
    { key: 'notes-favorites', title: '笔记与收藏', enabled: hasLearningSync },
    { key: 'archive-sync', title: '学习档案同步', enabled: hasLearningSync },
    { key: 'leaderboard', title: '排行榜', enabled: hasLearningSync },
    { key: 'multi-device', title: '多端数据同步', enabled: hasLearningSync || canUsePremiumLibrary },
  ];

  async function openSubscriptions() {
    const url =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('打开失败', '订阅管理链接暂时无法打开。');
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>账号与权益</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          查看会员状态、权益与口语额度
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View
          style={[
            styles.membershipCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor),
            },
          ]}
        >
          <Image
            source={accountBadgeImage}
            style={[
              styles.membershipBadgeImage,
              theme.colorScheme === 'dark' && styles.membershipBadgeImageDark,
            ]}
            contentFit="contain"
            pointerEvents="none"
          />
          <View style={styles.membershipContent}>
            <View style={styles.eyebrowRow}>
              <Ionicons name="sparkles-outline" size={16} color={theme.primaryBlue} />
              <AppText style={[styles.eyebrowText, { color: theme.textSecondary }]}>会员权益</AppText>
            </View>
            <AppText style={[styles.membershipTitle, { color: theme.textPrimary }]} numberOfLines={1}>
              {isActivated ? 'EchoLingo Pro' : 'EchoLingo Free'}
            </AppText>
            <AppText style={[styles.membershipStatus, { color: theme.primaryBlue }]}>
              {membershipType ?? (isActivated ? '已激活' : '未激活')}
            </AppText>
            <AppText
              style={[
                styles.membershipSubtitle,
                { color: membershipExpiry ? theme.primaryBlue : theme.textSecondary },
              ]}
              numberOfLines={2}
            >
              {membershipExpiry ? `有效期至 ${membershipExpiry}` : '激活后解锁完整学习权益'}
            </AppText>
          </View>
        </View>

        <View
          style={[
            styles.entitlementShell,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
            },
          ]}
        >
          <View style={styles.entitlementGrid}>
            {entitlements.map((item) => (
              <EntitlementCard key={item.key} title={item.title} enabled={item.enabled} />
            ))}
          </View>

          <View
            style={[
              styles.creditCard,
              {
                backgroundColor:
                  theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                borderColor: 'rgba(15,23,42,0.08)',
              },
            ]}
          >
            <View>
              <AppText style={[styles.creditLabel, { color: theme.textSecondary }]}>口语额度</AppText>
              <AppText style={[styles.creditValue, { color: theme.textPrimary }]}>{speakingCredits} 次</AppText>
            </View>
            <View style={styles.accountActionRow}>
              {Platform.OS === 'ios' ? (
                <Pressable
                  onPress={() => void restorePurchases()}
                  disabled={isBusy}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      backgroundColor:
                        theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(10,132,255,0.08)',
                      borderColor: 'rgba(10,132,255,0.14)',
                    },
                    pressed && !isBusy && styles.buttonPressed,
                  ]}
                >
                  <AppText style={[styles.secondaryButtonText, { color: theme.primaryBlue }]}>
                    {phase === 'restore_checking' ? '恢复中…' : '恢复购买'}
                  </AppText>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void openSubscriptions()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primaryBlue },
                  pressed && styles.buttonPressed,
                ]}
              >
                <AppText style={styles.primaryButtonText}>管理订阅</AppText>
              </Pressable>
            </View>
          </View>

          {phaseTitle || phaseDetail ? (
            <View
              style={[
                styles.phaseCard,
                {
                  backgroundColor:
                    theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                  borderColor: 'rgba(15,23,42,0.08)',
                },
              ]}
            >
              {phaseTitle ? <AppText style={[styles.phaseTitle, { color: theme.textPrimary }]}>{phaseTitle}</AppText> : null}
              {phaseDetail ? <AppText style={[styles.phaseDetail, { color: theme.textSecondary }]}>{phaseDetail}</AppText> : null}
            </View>
          ) : null}
        </View>
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
  membershipCard: {
    position: 'relative',
    height: 170,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  membershipBadgeImage: {
    position: 'absolute',
    right: 12,
    top: 4,
    width: 244,
    height: 172,
    zIndex: 1,
    opacity: 1,
  },
  membershipBadgeImageDark: {
    right: 16,
    top: 8,
    width: 218,
    height: 154,
  },
  membershipContent: { position: 'relative', width: '58%', zIndex: 2 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrowText: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  membershipTitle: { marginTop: 6, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.35 },
  membershipStatus: { marginTop: 6, fontSize: 16, lineHeight: 20, fontWeight: '800' },
  membershipSubtitle: { marginTop: 8, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  entitlementShell: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  entitlementGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  entitlementCard: {
    width: '48.9%',
    height: 82,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  entitlementIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  entitlementTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  entitlementStatus: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  creditCard: {
    marginTop: 16,
    minHeight: 88,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  creditLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  creditValue: { marginTop: 4, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  accountActionRow: { flexDirection: 'row', gap: 10 },
  primaryButton: {
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FFFFFF' },
  secondaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  phaseCard: {
    marginTop: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  phaseTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  phaseDetail: { marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  buttonPressed: { opacity: 0.86 },
});
