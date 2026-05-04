import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AuthFormCard } from '@/components/auth/AuthFormCard';
import { AuthTabletShell } from '@/components/auth/AuthTabletShell';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { BackLink } from '@/components/ui/BackLink';
import { ActionButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { normalizeAuthErrorMessage, validateEmailAddress } from '@/services/auth/authErrorMessage';
import { sendPasswordResetEmail } from '@/services/auth/client';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { BG_CARD_SOFT, BORDER_SOFT, COLOR_RED, FONT_CALLOUT, TEXT_PRIMARY, TEXT_SECONDARY } from '@/theme/tokens';

const inputStyle = {
  minHeight: 48,
  borderRadius: 14,
  borderWidth: 0.5,
  borderColor: BORDER_SOFT,
  backgroundColor: BG_CARD_SOFT,
  paddingHorizontal: 14,
  color: TEXT_PRIMARY,
} as const;

export function ForgotPasswordScreen() {
  const { shouldUseTabletLayout } = useDeviceClass();
  const { theme } = useAppTheme();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const emailError = email.length > 0 ? validateEmailAddress(email) : null;

  const handleSend = async () => {
    const nextEmailError = validateEmailAddress(email);
    if (nextEmailError) {
      setError(nextEmailError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await sendPasswordResetEmail(email.trim());
      setSent(true);
    } catch (err) {
      setError(normalizeAuthErrorMessage(err, '发送失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  const tabletInputStyle = {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.secondaryCardBackground,
    paddingHorizontal: 16,
    color: theme.textPrimary,
    fontSize: 16,
  } as const;

  if (shouldUseTabletLayout) {
    return (
      <AuthTabletShell onBack={() => router.back()}>
        <AuthFormCard
          title={sent ? '重置邮件已发送' : '找回密码'}
          subtitle={sent ? '请前往邮箱查看，并通过邮件中的链接重置密码。' : '输入注册邮箱，我们会发送重置密码链接。'}
        >
          {sent ? (
            <ActionButton
              label="返回登录"
              variant="dark"
              onPress={() => router.replace('/auth/sign-in')}
              style={{ minHeight: 54, borderRadius: 18 }}
              labelStyle={{ fontSize: 16 }}
            />
          ) : (
            <View style={{ gap: 14 }}>
              <View style={{ gap: 8 }}>
                <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>邮箱</AppText>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="输入你的注册邮箱"
                  placeholderTextColor={theme.textSecondary}
                  style={tabletInputStyle}
                />
                {emailError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{emailError}</AppText> : null}
              </View>
              {error ? <AppText style={{ color: COLOR_RED, fontSize: 13 }}>{error}</AppText> : null}
              <ActionButton
                label={submitting ? '发送中…' : '发送重置邮件'}
                variant="dark"
                onPress={() => void handleSend()}
                disabled={submitting || !email.trim() || Boolean(emailError)}
                style={{ minHeight: 54, borderRadius: 18 }}
                labelStyle={{ fontSize: 16 }}
              />
              {submitting ? <ActivityIndicator color={theme.textSecondary} /> : null}
            </View>
          )}
        </AuthFormCard>
      </AuthTabletShell>
    );
  }

  return (
    <AppScreenShell scrollable={false} includeBottomInset={false}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <BackLink label="返回" onPress={() => router.back()} />
        </View>
        <PageHeader title={sent ? '重置邮件已发送' : '找回密码'} subtitle={sent ? '请前往邮箱查看，并通过邮件中的链接重置密码。' : '输入注册邮箱，我们会发送重置密码链接。'} />
        <View style={{ paddingHorizontal: 20 }}>
          <SurfaceCard style={{ marginHorizontal: 0 }}>
            {sent ? (
              <ActionButton label="返回登录" variant="dark" onPress={() => router.replace('/auth/sign-in')} />
            ) : (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 6 }}>
                  <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>邮箱</AppText>
                  <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="输入你的注册邮箱" placeholderTextColor={TEXT_SECONDARY} style={inputStyle} />
                  {emailError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{emailError}</AppText> : null}
                </View>
                {error ? <AppText style={{ color: COLOR_RED, fontSize: 13 }}>{error}</AppText> : null}
                <ActionButton
                  label={submitting ? '发送中…' : '发送重置邮件'}
                  variant="dark"
                  onPress={() => void handleSend()}
                  disabled={submitting || !email.trim() || Boolean(emailError)}
                />
                {submitting ? <ActivityIndicator color={TEXT_SECONDARY} /> : null}
              </View>
            )}
          </SurfaceCard>
        </View>
      </View>
    </AppScreenShell>
  );
}
