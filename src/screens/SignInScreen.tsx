import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';
import { AuthFormCard } from '@/components/auth/AuthFormCard';
import { AuthTabletShell } from '@/components/auth/AuthTabletShell';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { BackLink } from '@/components/ui/BackLink';
import { ActionButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { normalizeAuthErrorMessage, validateEmailAddress } from '@/services/auth/authErrorMessage';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { COLOR_RED, FONT_CALLOUT } from '@/theme/tokens';

const baseInputStyle = {
  minHeight: 48,
  borderRadius: 14,
  borderWidth: 0.5,
  paddingHorizontal: 14,
} as const;

export function SignInScreen() {
  const { shouldUseTabletLayout } = useDeviceClass();
  const { theme } = useAppTheme();
  const session = useAppSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailError = email.length > 0 ? validateEmailAddress(email) : null;
  const passwordError = password.length === 0 ? null : password.trim().length === 0 ? '请输入密码' : null;

  const handleSignIn = async () => {
    const nextEmailError = validateEmailAddress(email);
    const nextPasswordError = password.trim().length === 0 ? '请输入密码' : null;

    if (nextEmailError || nextPasswordError) {
      setError(nextEmailError ?? nextPasswordError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await session.signIn(email.trim(), password);
      router.replace('/my');
    } catch (err) {
      setError(normalizeAuthErrorMessage(err, '登录失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAppleSignIn = async (identityToken: string, nonce?: string) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await session.signInWithApple(identityToken, nonce);
      router.replace('/my');
    } catch (err) {
      setError(normalizeAuthErrorMessage(err, 'Apple 登录暂不可用，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAppleSignInError = (message: string) => {
    if (message === 'APPLE_SIGN_IN_CANCELLED') {
      return;
    }

    setError(
      message === 'Apple 登录暂不可用，请稍后重试'
        ? message
        : normalizeAuthErrorMessage(new Error(message), 'Apple 登录暂不可用，请稍后重试'),
    );
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
        <AuthFormCard title="登录 EchoLingo" subtitle="登录后即可同步学习记录与账号权益。">
          <View style={{ gap: 14 }}>
            <View style={{ gap: 8 }}>
              <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>邮箱</AppText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                placeholder="输入你的邮箱"
                placeholderTextColor={theme.textSecondary}
                style={tabletInputStyle}
              />
              {emailError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{emailError}</AppText> : null}
            </View>
            <View style={{ gap: 8 }}>
              <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>密码</AppText>
              <TextInput
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholder="输入密码"
                placeholderTextColor={theme.textSecondary}
                style={tabletInputStyle}
              />
              {passwordError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{passwordError}</AppText> : null}
            </View>
            {error ? <AppText style={{ color: COLOR_RED, fontSize: 13 }}>{error}</AppText> : null}
            <ActionButton
              label={submitting ? '登录中…' : '登录'}
              variant="dark"
              onPress={() => void handleSignIn()}
              disabled={submitting || !email.trim() || !password || Boolean(emailError) || Boolean(passwordError)}
              style={{ minHeight: 54, borderRadius: 18 }}
              labelStyle={{ fontSize: 16 }}
            />
            <AppleSignInButton onSuccess={handleAppleSignIn} onError={handleAppleSignInError} />
            {submitting ? <ActivityIndicator color={theme.textSecondary} /> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 }}>
              <Pressable onPress={() => router.push('/auth/forgot-password')}>
                <AppText style={{ fontSize: 14, color: theme.textSecondary }}>忘记密码？</AppText>
              </Pressable>
              <Pressable onPress={() => router.push('/auth/sign-up')}>
                <AppText style={{ fontSize: 14, color: theme.textSecondary }}>还没账号？注册</AppText>
              </Pressable>
            </View>
          </View>
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
        <PageHeader title="登录 EchoLingo" subtitle="登录后即可同步学习记录与账号权益。" />
        <View style={{ paddingHorizontal: 20 }}>
          <SurfaceCard style={{ marginHorizontal: 0 }}>
            <View style={{ gap: 12 }}>
              <View style={{ gap: 6 }}>
                <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>邮箱</AppText>
                <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="输入你的邮箱" placeholderTextColor={theme.textSecondary} style={[baseInputStyle, { borderColor: theme.border, backgroundColor: theme.secondaryCardBackground, color: theme.textPrimary }]} />
                {emailError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{emailError}</AppText> : null}
              </View>
              <View style={{ gap: 6 }}>
                <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>密码</AppText>
                <TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="输入密码" placeholderTextColor={theme.textSecondary} style={[baseInputStyle, { borderColor: theme.border, backgroundColor: theme.secondaryCardBackground, color: theme.textPrimary }]} />
                {passwordError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{passwordError}</AppText> : null}
              </View>
              {error ? <AppText style={{ color: COLOR_RED, fontSize: 13 }}>{error}</AppText> : null}
              <ActionButton
                label={submitting ? '登录中…' : '登录'}
                variant="dark"
                onPress={() => void handleSignIn()}
                disabled={submitting || !email.trim() || !password || Boolean(emailError) || Boolean(passwordError)}
              />
              <AppleSignInButton onSuccess={handleAppleSignIn} onError={handleAppleSignInError} />
              {submitting ? <ActivityIndicator color={theme.textSecondary} /> : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 }}>
                <Pressable onPress={() => router.push('/auth/forgot-password')}><AppText style={{ fontSize: 13, color: theme.textSecondary }}>忘记密码？</AppText></Pressable>
                <Pressable onPress={() => router.push('/auth/sign-up')}><AppText style={{ fontSize: 13, color: theme.textSecondary }}>还没账号？注册</AppText></Pressable>
              </View>
            </View>
          </SurfaceCard>
        </View>
      </View>
    </AppScreenShell>
  );
}
