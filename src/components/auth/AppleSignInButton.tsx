import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';

type AppleSignInButtonProps = {
  onSuccess: (identityToken: string, nonce?: string) => Promise<void> | void;
  onError?: (message: string) => void;
};

const APPLE_SIGN_IN_UNAVAILABLE = 'Apple 登录暂不可用，请稍后重试';
const APPLE_SIGN_IN_CANCELLED = 'APPLE_SIGN_IN_CANCELLED';

export function AppleSignInButton({ onSuccess, onError }: AppleSignInButtonProps) {
  const { theme } = useAppTheme();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS !== 'ios') {
      setAvailable(false);
      return () => {
        cancelled = true;
      };
    }

    void AppleAuthentication.isAvailableAsync()
      .then((next) => {
        if (!cancelled) {
          setAvailable(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePress = async () => {
    if (loading) return;

    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[apple_sign_in_credential_debug]', {
          user: credential.user ?? null,
          state: credential.state ?? null,
          authorizationCodePresent: Boolean(credential.authorizationCode),
          identityTokenPresent: Boolean(credential.identityToken),
          emailPresent: Boolean(credential.email),
          fullNamePresent: Boolean(credential.fullName),
        });
      }

      if (!credential.identityToken) {
        throw new Error(APPLE_SIGN_IN_UNAVAILABLE);
      }

      await onSuccess(credential.identityToken);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : '';

      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[apple_sign_in_error_debug]', {
          code,
          message: error instanceof Error ? error.message : String(error ?? ''),
          keys: error && typeof error === 'object' ? Object.keys(error as Record<string, unknown>) : [],
        });
      }

      if (code === 'ERR_REQUEST_CANCELED' || code === '1001') {
        onError?.(APPLE_SIGN_IN_CANCELLED);
        return;
      }

      const rawMessage = error instanceof Error ? error.message : String(error ?? '');
      const normalized = rawMessage.toLowerCase();
      const message =
        rawMessage.includes(APPLE_SIGN_IN_UNAVAILABLE) ||
        normalized.includes('apple') ||
        normalized.includes('id token') ||
        normalized.includes('provider')
          ? APPLE_SIGN_IN_UNAVAILABLE
          : rawMessage || APPLE_SIGN_IN_UNAVAILABLE;

      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  if (!available || Platform.OS !== 'ios') {
    return null;
  }

  return (
    <View style={{ marginTop: 2, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 375 }}>
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={
            theme.colorScheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={18}
          style={{
            width: '100%',
            height: 50,
            opacity: loading ? 0.7 : 1,
          }}
          onPress={() => void handlePress()}
        />
      </View>
    </View>
  );
}
