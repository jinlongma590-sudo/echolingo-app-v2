import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';

import {
  clearAiDataConsent,
  loadAiDataConsent,
  saveAiDataConsent,
} from './aiDataConsentStorage';

type ConsentModalMode = 'request' | 'review';

type AiDataConsentContextValue = {
  hasConsent: boolean;
  isHydrating: boolean;
  requestConsent: () => Promise<boolean>;
  openConsentNotice: () => void;
  resetConsent: () => Promise<void>;
};

const AiDataConsentContext = createContext<AiDataConsentContextValue | null>(null);

export function AiDataConsentProvider({ children }: PropsWithChildren) {
  const { theme } = useAppTheme();
  const [isHydrating, setIsHydrating] = useState(true);
  const [hasConsent, setHasConsent] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<ConsentModalMode>('request');
  const [saving, setSaving] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const pendingPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedConsent = await loadAiDataConsent();
      if (cancelled) return;
      setHasConsent(Boolean(storedConsent));
      setIsHydrating(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const closeReview = useCallback(() => {
    if (resolverRef.current) {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      pendingPromiseRef.current = null;
      resolve(false);
    }
    setVisible(false);
  }, []);

  const resolvePending = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    pendingPromiseRef.current = null;
    resolve?.(value);
  }, []);

  const requestConsent = useCallback(() => {
    if (hasConsent) {
      return Promise.resolve(true);
    }

    if (pendingPromiseRef.current) {
      setMode('request');
      setVisible(true);
      return pendingPromiseRef.current;
    }

    setMode('request');
    setVisible(true);

    const promise = new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
    pendingPromiseRef.current = promise;
    return promise;
  }, [hasConsent]);

  const openConsentNotice = useCallback(() => {
    setMode(hasConsent ? 'review' : 'request');
    setVisible(true);
  }, [hasConsent]);

  const resetConsent = useCallback(async () => {
    await clearAiDataConsent();
    setHasConsent(false);
  }, []);

  const handleAccept = useCallback(async () => {
    if (saving) return;

    setSaving(true);
    try {
      await saveAiDataConsent();
      setHasConsent(true);
      setVisible(false);
      resolvePending(true);
    } catch (error) {
      console.warn('[ai-consent] save failed', error);
      resolvePending(false);
    } finally {
      setSaving(false);
    }
  }, [resolvePending, saving]);

  const handleDecline = useCallback(() => {
    setVisible(false);
    resolvePending(false);
  }, [resolvePending]);

  const handleRequestClose = useCallback(() => {
    if (mode === 'review' && !resolverRef.current) {
      setVisible(false);
      return;
    }

    handleDecline();
  }, [handleDecline, mode]);

  const value = useMemo<AiDataConsentContextValue>(
    () => ({
      hasConsent,
      isHydrating,
      requestConsent,
      openConsentNotice,
      resetConsent,
    }),
    [hasConsent, isHydrating, openConsentNotice, requestConsent, resetConsent],
  );

  return (
    <AiDataConsentContext.Provider value={value}>
      {children}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleRequestClose}>
        <View style={styles.backdrop}>
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <AppText style={[styles.title, { color: theme.textPrimary }]}>AI 数据处理说明</AppText>
              <AppText style={[styles.subtitle, { color: theme.textSecondary }]}>
                使用 AI 口语、录音、语音转写、发音评估和 AI 对话前，请先确认以下数据处理说明。
              </AppText>

              <View style={styles.section}>
                <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>会发送哪些数据</AppText>
                <AppText style={[styles.sectionText, { color: theme.textSecondary }]}>
                  录音音频、语音转写文本、你输入的文字、练习内容、AI 对话内容、学习表现，以及当前练习场景和上下文。
                </AppText>
              </View>

              <View style={styles.section}>
                <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>会发送给谁</AppText>
                <AppText style={[styles.sectionText, { color: theme.textSecondary }]}>
                  第三方 AI 服务提供商，例如 OpenAI、Anthropic，以及语音识别和发音评测服务提供商。
                </AppText>
              </View>

              <View style={styles.section}>
                <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>用途说明</AppText>
                <AppText style={[styles.sectionText, { color: theme.textSecondary }]}>
                  这些数据仅用于语音识别、AI 对话、发音评估和学习反馈，不用于广告追踪。
                </AppText>
              </View>

              {hasConsent && mode === 'review' ? (
                <View
                  style={[
                    styles.statusCard,
                    {
                      backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.16)' : 'rgba(10,132,255,0.08)',
                      borderColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.22)' : 'rgba(10,132,255,0.14)',
                    },
                  ]}
                >
                  <AppText style={[styles.statusTitle, { color: theme.primaryBlue }]}>当前状态：已同意</AppText>
                  <AppText style={[styles.statusText, { color: theme.textSecondary }]}>
                    你可以在这里重新查看说明。若需停止使用 AI 功能，可在不继续使用相关功能的前提下撤回同意。
                  </AppText>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.actions}>
              {mode === 'review' && hasConsent ? (
                <>
                  <Pressable
                    onPress={() => {
                      void resetConsent();
                      setVisible(false);
                    }}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      {
                        backgroundColor: theme.secondaryCardBackground,
                        borderColor: theme.border,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <AppText style={[styles.secondaryButtonText, { color: theme.textPrimary }]}>撤回同意</AppText>
                  </Pressable>
                  <Pressable
                    onPress={closeReview}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primaryBlue },
                      pressed && styles.pressed,
                    ]}
                  >
                    <AppText style={styles.primaryButtonText}>关闭</AppText>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    onPress={handleDecline}
                    disabled={saving}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      {
                        backgroundColor: theme.secondaryCardBackground,
                        borderColor: theme.border,
                      },
                      pressed && !saving && styles.pressed,
                    ]}
                  >
                    <AppText style={[styles.secondaryButtonText, { color: theme.textPrimary }]}>不同意</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleAccept()}
                    disabled={saving}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primaryBlue },
                      pressed && !saving && styles.pressed,
                    ]}
                  >
                    {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                    <AppText style={styles.primaryButtonText}>同意并继续</AppText>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </AiDataConsentContext.Provider>
  );
}

export function useAiDataConsent() {
  const context = useContext(AiDataConsentContext);
  if (!context) {
    throw new Error('useAiDataConsent must be used within AiDataConsentProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 28,
    backgroundColor: 'rgba(15,23,42,0.48)',
    justifyContent: 'center',
  },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    maxHeight: '88%',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 14,
    gap: 16,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  section: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  statusCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
  },
  statusTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  statusText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 6,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.84,
  },
});
