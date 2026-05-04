import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';
import { AuthFormCard } from '@/components/auth/AuthFormCard';
import { AuthTabletShell } from '@/components/auth/AuthTabletShell';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { BackLink } from '@/components/ui/BackLink';
import { ActionButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { normalizeAuthErrorMessage, validateEmailAddress } from '@/services/auth/authErrorMessage';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { COLOR_RED, FONT_CALLOUT } from '@/theme/tokens';
import { openAppSafeUrl } from '@/utils/appSafeLink';

const baseInputStyle = {
  minHeight: 48,
  borderRadius: 14,
  borderWidth: 0.5,
  paddingHorizontal: 14,
} as const;

export function SignUpScreen() {
  const { shouldUseTabletLayout } = useDeviceClass();
  const { theme } = useAppTheme();
  const session = useAppSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const emailError = email.length > 0 ? validateEmailAddress(email) : null;
  const passwordError =
    password.length === 0 ? null : password.length < 6 ? '密码长度不够，请至少输入 6 位' : null;
  const confirmPasswordError =
    confirmPassword.length > 0 && password !== confirmPassword ? '两次密码不一致' : null;

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 6 &&
    password === confirmPassword &&
    !emailError &&
    !passwordError &&
    !confirmPasswordError;

  const openPolicyLink = async (url: string, fallbackTitle: string) => {
    try {
      await openAppSafeUrl(url);
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'blocked_purchase_risk_url'
          ? '请在 App 内完成购买或账号相关操作。'
          : '请稍后再试。';
      Alert.alert(fallbackTitle, message);
    }
  };

  const handleSignUp = async () => {
    const nextEmailError = validateEmailAddress(email);
    const nextPasswordError = password.length < 6 ? '密码长度不够，请至少输入 6 位' : null;
    const nextConfirmPasswordError = password !== confirmPassword ? '两次密码不一致' : null;

    if (nextEmailError || nextPasswordError || nextConfirmPasswordError) {
      setError(nextEmailError ?? nextPasswordError ?? nextConfirmPasswordError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const createdSession = await session.signUp(email.trim(), password);
      if (createdSession?.accessToken) {
        router.replace('/my');
        return;
      }
      setDone(true);
    } catch (err) {
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        const candidate = err as {
          name?: unknown;
          message?: unknown;
          status?: unknown;
          code?: unknown;
          error_description?: unknown;
        };
        console.log('[auth_signup_failed_debug]', {
          hasEmail: Boolean(email.trim()),
          errorName: typeof candidate?.name === 'string' ? candidate.name : null,
          errorMessage: typeof candidate?.message === 'string' ? candidate.message : null,
          errorStatus: typeof candidate?.status === 'number' ? candidate.status : null,
          errorCode: typeof candidate?.code === 'string' ? candidate.code : null,
          errorDescription: typeof candidate?.error_description === 'string' ? candidate.error_description : null,
          errorKeys: err && typeof err === 'object' ? Object.keys(err as Record<string, unknown>) : [],
        });
      }
      setError(normalizeAuthErrorMessage(err, '注册失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAppleSignIn = async (identityToken: string, nonce?: string) => {
    await session.signInWithApple(identityToken, nonce);
    router.replace('/my');
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
        <AuthFormCard
          title={done ? '注册成功' : '注册 EchoLingo'}
          subtitle={done ? '请前往邮箱完成验证，验证后即可登录。' : '创建账号后即可同步学习记录与购买权益。'}
        >
          {done ? (
            <ActionButton
              label="去登录"
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
                  placeholder="输入邮箱"
                  placeholderTextColor={theme.textSecondary}
                  style={tabletInputStyle}
                />
                {emailError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{emailError}</AppText> : null}
              </View>
              <View style={{ gap: 8 }}>
                <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>密码（至少 6 位）</AppText>
                <TextInput
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholder="设置密码"
                  placeholderTextColor={theme.textSecondary}
                  style={tabletInputStyle}
                />
                {passwordError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{passwordError}</AppText> : null}
              </View>
              <View style={{ gap: 8 }}>
                <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>确认密码</AppText>
                <TextInput
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="再输一次"
                  placeholderTextColor={theme.textSecondary}
                  style={tabletInputStyle}
                />
                {confirmPasswordError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{confirmPasswordError}</AppText> : null}
              </View>
              {error ? <AppText style={{ color: COLOR_RED, fontSize: 13 }}>{error}</AppText> : null}
              <AppText style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary }}>
                注册即代表你同意
                <AppText style={{ color: theme.textPrimary }} onPress={() => void openPolicyLink('https://echolingo.cn/terms', '用户协议暂时不可用')}>《用户协议》</AppText>
                和
                <AppText style={{ color: theme.textPrimary }} onPress={() => void openPolicyLink('https://echolingo.cn/privacy', '隐私政策暂时不可用')}>《隐私政策》</AppText>
                。
              </AppText>
              <ActionButton
                label={submitting ? '注册中…' : '注册'}
                variant="dark"
                onPress={() => void handleSignUp()}
                disabled={submitting || !canSubmit}
                style={{ minHeight: 54, borderRadius: 18 }}
                labelStyle={{ fontSize: 16 }}
              />
              <AppleSignInButton onSuccess={handleAppleSignIn} onError={handleAppleSignInError} />
              {submitting ? <ActivityIndicator color={theme.textSecondary} /> : null}
              <Pressable onPress={() => router.replace('/auth/sign-in')} style={{ alignItems: 'center', paddingVertical: 6 }}>
                <AppText style={{ fontSize: 14, color: theme.textSecondary }}>已有账号？去登录</AppText>
              </Pressable>
            </View>
          )}
        </AuthFormCard>
      </AuthTabletShell>
    );
  }

  return (
    <AppScreenShell contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false} includeBottomInset={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <BackLink label="返回" onPress={() => router.back()} />
        </View>
        <PageHeader title={done ? '注册成功' : '注册 EchoLingo'} subtitle={done ? '请前往邮箱完成验证，验证后即可登录。' : '创建账号后即可同步学习记录与购买权益。'} />
        <View style={{ paddingHorizontal: 20 }}>
          <SurfaceCard style={{ marginHorizontal: 0 }}>
            {done ? (
              <ActionButton label="去登录" variant="dark" onPress={() => router.replace('/auth/sign-in')} />
            ) : (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 6 }}>
                  <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>邮箱</AppText>
                  <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="输入邮箱" placeholderTextColor={theme.textSecondary} style={[baseInputStyle, { borderColor: theme.border, backgroundColor: theme.secondaryCardBackground, color: theme.textPrimary }]} />
                  {emailError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{emailError}</AppText> : null}
                </View>
                <View style={{ gap: 6 }}>
                  <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>密码（至少 6 位）</AppText>
                  <TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="设置密码" placeholderTextColor={theme.textSecondary} style={[baseInputStyle, { borderColor: theme.border, backgroundColor: theme.secondaryCardBackground, color: theme.textPrimary }]} />
                  {passwordError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{passwordError}</AppText> : null}
                </View>
                <View style={{ gap: 6 }}>
                  <AppText style={{ fontSize: FONT_CALLOUT, color: theme.textSecondary }}>确认密码</AppText>
                  <TextInput secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} placeholder="再输一次" placeholderTextColor={theme.textSecondary} style={[baseInputStyle, { borderColor: theme.border, backgroundColor: theme.secondaryCardBackground, color: theme.textPrimary }]} />
                  {confirmPasswordError ? <AppText style={{ fontSize: 12, color: COLOR_RED }}>{confirmPasswordError}</AppText> : null}
                </View>
                {error ? <AppText style={{ color: COLOR_RED, fontSize: 13 }}>{error}</AppText> : null}
                <AppText style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary }}>
                  注册即代表你同意
                  <AppText style={{ color: theme.textPrimary }} onPress={() => void openPolicyLink('https://echolingo.cn/terms', '用户协议暂时不可用')}>《用户协议》</AppText>
                  和
                  <AppText style={{ color: theme.textPrimary }} onPress={() => void openPolicyLink('https://echolingo.cn/privacy', '隐私政策暂时不可用')}>《隐私政策》</AppText>
                  。
                </AppText>
                <ActionButton
                  label={submitting ? '注册中…' : '注册'}
                  variant="dark"
                  onPress={() => void handleSignUp()}
                  disabled={submitting || !canSubmit}
                />
                <AppleSignInButton onSuccess={handleAppleSignIn} onError={handleAppleSignInError} />
                {submitting ? <ActivityIndicator color={theme.textSecondary} /> : null}
                <Pressable onPress={() => router.replace('/auth/sign-in')} style={{ alignItems: 'center', paddingVertical: 4 }}>
                  <AppText style={{ fontSize: 13, color: theme.textSecondary }}>已有账号？去登录</AppText>
                </Pressable>
              </View>
            )}
          </SurfaceCard>
        </View>
    </AppScreenShell>
  );
}
