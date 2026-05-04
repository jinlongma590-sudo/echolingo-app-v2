import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LEARNING_METHOD_ENTRIES, type LearningMethodEntry } from '@/data/learningMethods';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { openAppSafeUrl } from '@/utils/appSafeLink';

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.12 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 2,
  } as const;
}

function buildSteps(entry: LearningMethodEntry) {
  return [
    `先明确目标：${entry.solves}`,
    `核心做法：${entry.summary}`,
    `推荐场景：${entry.scenario}`,
  ];
}

export function MyMethodsPanel() {
  const { theme } = useAppTheme();
  const [selectedMethod, setSelectedMethod] = useState<LearningMethodEntry>(LEARNING_METHOD_ENTRIES[0]);

  async function openMethodUrl(href: string) {
    try {
      await openAppSafeUrl(`https://echolingo.cn${href}`);
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'blocked_purchase_risk_url'
          ? '请在 App 内完成购买或账号相关操作。'
          : '方法页面链接暂时无法打开。';
      Alert.alert('打开失败', message);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>学习方法</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          建立长期稳定的学习节奏
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View
          style={[
            styles.listCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor),
            },
          ]}
        >
          <View style={styles.methodGrid}>
            {LEARNING_METHOD_ENTRIES.map((item, index) => {
              const active = selectedMethod.id === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setSelectedMethod(item)}
                  style={({ pressed }) => [
                    styles.methodCard,
                    {
                      backgroundColor: active
                        ? 'rgba(10,132,255,0.10)'
                        : theme.colorScheme === 'dark'
                          ? theme.secondaryCardBackground
                          : 'rgba(248,250,252,0.78)',
                      borderColor: active ? 'rgba(10,132,255,0.18)' : 'rgba(15,23,42,0.08)',
                    },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <View style={[styles.methodIndexWrap, { backgroundColor: 'rgba(10,132,255,0.12)' }]}>
                    <AppText style={[styles.methodIndex, { color: theme.primaryBlue }]}>
                      {String(index + 1).padStart(2, '0')}
                    </AppText>
                  </View>
                  <AppText style={[styles.methodTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                    {item.titleZh}
                  </AppText>
                  <AppText style={[styles.methodSummary, { color: theme.textSecondary }]} numberOfLines={2}>
                    {item.summary}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={[
            styles.detailCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
            },
          ]}
        >
          <AppText style={[styles.detailTitle, { color: theme.textPrimary }]}>
            {selectedMethod.titleZh} / {selectedMethod.titleEn}
          </AppText>
          <AppText style={[styles.detailText, { color: theme.textSecondary }]}>
            {selectedMethod.summary}
          </AppText>
          <AppText style={[styles.sectionLabel, { color: theme.textPrimary }]}>适合解决的问题</AppText>
          <AppText style={[styles.detailText, { color: theme.textSecondary }]}>
            {selectedMethod.solves}
          </AppText>
          <AppText style={[styles.sectionLabel, { color: theme.textPrimary }]}>推荐使用场景</AppText>
          <AppText style={[styles.detailText, { color: theme.textSecondary }]}>
            {selectedMethod.scenario}
          </AppText>
          <AppText style={[styles.sectionLabel, { color: theme.textPrimary }]}>训练步骤</AppText>
          <View style={styles.stepList}>
            {buildSteps(selectedMethod).map((step) => (
              <View key={step} style={styles.stepRow}>
                <View style={[styles.stepDot, { backgroundColor: theme.primaryBlue }]} />
                <AppText style={[styles.stepText, { color: theme.textSecondary }]}>{step}</AppText>
              </View>
            ))}
          </View>
          <Pressable
            onPress={() => void openMethodUrl(selectedMethod.href)}
            style={({ pressed }) => [
              styles.linkButton,
              {
                backgroundColor:
                  theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(10,132,255,0.08)',
                borderColor: 'rgba(10,132,255,0.14)',
              },
              pressed && styles.cardPressed,
            ]}
          >
            <AppText style={[styles.linkButtonText, { color: theme.primaryBlue }]}>查看对应方法页面</AppText>
          </Pressable>
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
  listCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  methodCard: {
    width: '48.9%',
    height: 104,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    justifyContent: 'space-between',
  },
  methodIndexWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  methodIndex: { fontSize: 11, lineHeight: 14, fontWeight: '800' },
  methodTitle: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  methodSummary: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  detailCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  detailTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  detailText: { marginTop: 6, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  sectionLabel: { marginTop: 14, fontSize: 14, lineHeight: 18, fontWeight: '800' },
  stepList: { marginTop: 8, gap: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stepDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  linkButton: {
    marginTop: 16,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  cardPressed: { opacity: 0.84 },
});
