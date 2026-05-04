import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { fetchCurrentUserProfile, updateUserProfile, type UserProfileSnapshot } from '@/services/api/profile';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';

type MyProfilePanelProps = {
  displayName: string;
  avatarUrl?: string | null;
  email: string;
  signature: string;
  isAuthenticated: boolean;
  isActivated: boolean;
  avatarUploading?: boolean;
  avatarFeedback?: {
    tone: 'info' | 'success' | 'error';
    text: string;
  } | null;
  onAvatarPress?: (event: Parameters<NonNullable<React.ComponentProps<typeof Pressable>['onPress']>>[0]) => void;
};

function getInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '我';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return trimmed.slice(0, 1).toUpperCase();
}

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.12 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 2,
  } as const;
}

function getSignature(preferences: Record<string, unknown> | null | undefined) {
  if (!preferences) return null;
  const candidates = ['signature', 'bio', 'tagline', 'intro'];
  for (const key of candidates) {
    const value = preferences[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function InfoCard({
  icon,
  label,
  value,
  tint,
  background,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  tint: string;
  background: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.infoCard,
        {
          backgroundColor:
            theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
          borderColor: 'rgba(15,23,42,0.08)',
        },
      ]}
    >
      <View style={[styles.infoIconWrap, { backgroundColor: background }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <AppText style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</AppText>
      <AppText style={[styles.infoValue, { color: theme.textPrimary }]} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

export function MyProfilePanel({
  displayName,
  avatarUrl,
  email,
  signature,
  isAuthenticated,
  isActivated,
  avatarUploading = false,
  avatarFeedback = null,
  onAvatarPress,
}: MyProfilePanelProps) {
  const { theme } = useAppTheme();
  const session = useAppSession();
  const initials = getInitials(displayName);

  const [profile, setProfile] = useState<UserProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(displayName);
  const [draftSignature, setDraftSignature] = useState(signature === '还没有设置个性签名' ? '' : signature);

  useEffect(() => {
    let cancelled = false;

    if (session.status !== 'authenticated' || !session.session) {
      setProfile(null);
      setDraftName(displayName);
      setDraftSignature(signature === '还没有设置个性签名' ? '' : signature);
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setLoading(true);
      try {
        const next = await fetchCurrentUserProfile(session.session!);
        if (!cancelled) {
          setProfile(next);
          setDraftName(next?.name ?? displayName);
          setDraftSignature(getSignature(next?.preferences) ?? '');
        }
      } catch (error) {
        if (!cancelled) {
          setStatusText(error instanceof Error ? error.message : '资料读取失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [displayName, session.session, session.status, signature]);

  const resolvedName = profile?.name ?? displayName;
  const resolvedEmail = profile?.email ?? email;
  const resolvedAvatarUrl = avatarUrl ?? profile?.avatarUrl ?? null;
  const resolvedSignature = getSignature(profile?.preferences) ?? signature;
  const hasEmail = Boolean(resolvedEmail && resolvedEmail !== '未绑定邮箱');
  const hasSignature = Boolean(resolvedSignature && resolvedSignature !== '还没有设置个性签名');
  const completedFields = [Boolean(resolvedName), Boolean(resolvedAvatarUrl), hasEmail, hasSignature].filter(Boolean).length;
  const completeness = `${completedFields}/4 项已完善`;
  const canSave = draftName.trim().length > 0 && !saving && session.status === 'authenticated' && Boolean(session.session);

  const dirty = useMemo(() => {
    return (
      draftName.trim() !== (profile?.name ?? displayName).trim() ||
      draftSignature.trim() !== (getSignature(profile?.preferences) ?? '').trim()
    );
  }, [displayName, draftName, draftSignature, profile]);

  async function handleSave() {
    if (!session.session || !canSave || !dirty) return;
    setSaving(true);
    setStatusText(null);
    try {
      const nextProfile = await updateUserProfile(session.session, {
        displayName: draftName,
        signature: draftSignature,
      });
      setProfile(nextProfile);
      await session.updateSessionUser({ displayName: nextProfile.name ?? draftName.trim() });
      setStatusText('资料已保存');
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '资料保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>个人资料</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          管理头像、昵称、邮箱与个性签名
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View
          style={[
            styles.mainCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor),
            },
          ]}
        >
          <Pressable
            disabled={!onAvatarPress || avatarUploading}
            hitSlop={10}
            onPress={onAvatarPress}
            style={({ pressed }) => [styles.avatarButton, pressed && !avatarUploading && styles.avatarButtonPressed]}
          >
            <View style={styles.avatarWrap}>
              {resolvedAvatarUrl ? (
                <Image source={{ uri: resolvedAvatarUrl }} contentFit="cover" style={styles.avatarImage} />
              ) : (
                <AppText style={styles.avatarText}>{initials}</AppText>
              )}
              {avatarUploading ? (
                <View style={styles.avatarLoadingOverlay}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            <View
              style={[
                styles.avatarBadge,
                {
                  backgroundColor:
                    theme.colorScheme === 'dark' ? theme.cardBackground : 'rgba(255,255,255,0.94)',
                  borderColor: 'rgba(15,23,42,0.08)',
                },
              ]}
            >
              {avatarUploading ? (
                <ActivityIndicator size="small" color={theme.textPrimary} />
              ) : (
                <Ionicons name="camera-outline" size={12} color={theme.textPrimary} />
              )}
            </View>
          </Pressable>
          <View style={styles.mainTextWrap}>
            <AppText style={[styles.nameText, { color: theme.textPrimary }]} numberOfLines={1}>
              {resolvedName}
            </AppText>
            <AppText style={[styles.emailText, { color: theme.textSecondary }]} numberOfLines={1}>
              {resolvedEmail || '未绑定邮箱'}
            </AppText>
            <AppText style={[styles.signatureText, { color: theme.textSecondary }]} numberOfLines={2}>
              {resolvedSignature || '还没有设置个性签名'}
            </AppText>
            {avatarFeedback ? (
              <AppText
                style={[
                  styles.avatarFeedbackText,
                  {
                    color:
                      avatarFeedback.tone === 'success'
                        ? '#247A47'
                        : avatarFeedback.tone === 'error'
                          ? theme.destructive
                          : theme.textSecondary,
                  },
                ]}
                numberOfLines={1}
              >
                {avatarFeedback.text}
              </AppText>
            ) : null}
          </View>
        </View>

        <View style={styles.infoGrid}>
          <InfoCard
            icon="shield-checkmark-outline"
            label="登录状态"
            value={isAuthenticated ? '已登录' : '未登录'}
            tint={theme.primaryBlue}
            background="rgba(10,132,255,0.12)"
          />
          <InfoCard
            icon="mail-outline"
            label="邮箱状态"
            value={hasEmail ? '已绑定邮箱' : '未绑定邮箱'}
            tint="#34C759"
            background="rgba(52,199,89,0.12)"
          />
          <InfoCard
            icon="sparkles-outline"
            label="资料完整度"
            value={completeness}
            tint="#8B5CF6"
            background="rgba(139,92,246,0.12)"
          />
          <InfoCard
            icon="diamond-outline"
            label="会员状态"
            value={isActivated ? 'EchoLingo Pro' : 'EchoLingo Free'}
            tint="#0A84FF"
            background="rgba(10,132,255,0.12)"
          />
        </View>

        <View
          style={[
            styles.editorCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
            },
          ]}
        >
          <View style={styles.sectionHeader}>
            <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>资料编辑</AppText>
            {loading ? <ActivityIndicator color={theme.primaryBlue} /> : null}
          </View>
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor:
                  theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                borderColor: 'rgba(15,23,42,0.08)',
              },
            ]}
          >
            <AppText style={[styles.inputLabel, { color: theme.textSecondary }]}>昵称</AppText>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="输入昵称"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.textPrimary }]}
            />
          </View>
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor:
                  theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                borderColor: 'rgba(15,23,42,0.08)',
              },
            ]}
          >
            <AppText style={[styles.inputLabel, { color: theme.textSecondary }]}>个性签名</AppText>
            <TextInput
              value={draftSignature}
              onChangeText={setDraftSignature}
              placeholder="输入个性签名"
              placeholderTextColor={theme.textSecondary}
              style={[styles.textarea, { color: theme.textPrimary }]}
              multiline
            />
          </View>
          {statusText ? (
            <AppText style={[styles.statusText, { color: statusText === '资料已保存' ? '#34C759' : theme.destructive }]}>
              {statusText}
            </AppText>
          ) : null}
          <Pressable
            onPress={() => void handleSave()}
            disabled={!canSave || !dirty}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: canSave && dirty ? theme.primaryBlue : 'rgba(15,23,42,0.16)' },
              pressed && canSave && dirty && styles.buttonPressed,
            ]}
          >
            <AppText style={styles.primaryButtonText}>{saving ? '保存中…' : '保存资料'}</AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 0,
  },
  panelHeader: {
    marginBottom: 14,
  },
  panelTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  panelSubtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  panelContent: {
    gap: 12,
  },
  mainCard: {
    height: 220,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarButton: {
    marginRight: 0,
  },
  avatarButtonPressed: {
    opacity: 0.82,
  },
  avatarWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D8DEE8',
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,17,17,0.32)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  mainTextWrap: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 18,
  },
  nameText: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  emailText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  signatureText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  avatarFeedbackText: {
    marginTop: 8,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '500',
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  infoCard: {
    width: '48.9%',
    height: 96,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  infoIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  infoValue: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  editorCard: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  inputWrap: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    paddingVertical: 0,
  },
  textarea: {
    minHeight: 68,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlignVertical: 'top',
    paddingVertical: 0,
  },
  statusText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  primaryButton: {
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  buttonPressed: {
    opacity: 0.86,
  },
});
