import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { safeBack } from '@/navigation/safeBack';
import { fetchCurrentUserProfile, updateUserProfile, type UserProfileSnapshot } from '@/services/api/profile';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  BG_CARD,
  BG_CARD_SOFT,
  BORDER_SOFT,
  COLOR_RED,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';

function extractErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function isExpiredSessionError(error: unknown) {
  const message = extractErrorText(error).toLowerCase();
  return (
    message.includes('jwt expired') ||
    message.includes('pgrst303') ||
    message.includes('401') ||
    message.includes('auth session missing') ||
    message.includes('invalid jwt') ||
    message.includes('unauthorized')
  );
}

function getInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '我';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return trimmed.slice(0, 1).toUpperCase();
}

function buildLearningCompanionText(createdAt?: string | null) {
  if (!createdAt) return 'EchoLingo 正陪你一点点进步';

  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) {
    return 'EchoLingo 正陪你一点点进步';
  }

  const now = new Date();
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfCreated = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
  const diffMs = startOfNow.getTime() - startOfCreated.getTime();
  const diffDays = Math.floor(diffMs / 86400000) + 1;
  const learningDays = Math.max(1, diffDays);

  return `EchoLingo 已陪你学习 ${learningDays} 天`;
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

function resolveAccountStatusLabel(isLoggedIn?: boolean) {
  return isLoggedIn ? '已登录' : '游客';
}

function StateCard({
  icon,
  title,
  subtitle,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <SurfaceCard style={styles.stateCard}>
      <View
        style={[
          styles.stateIconWrap,
          {
            backgroundColor: theme.fillTertiary,
            borderColor: theme.border,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={theme.textSecondary} />
      </View>
      <AppText style={styles.stateTitle}>{title}</AppText>
      <AppText style={styles.stateSubtitle}>{subtitle}</AppText>

      {primaryLabel || secondaryLabel ? (
        <View style={styles.stateActions}>
          {primaryLabel && onPrimary ? (
            <Pressable
              onPress={onPrimary}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.primaryButtonText}>{primaryLabel}</AppText>
            </Pressable>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <Pressable
              onPress={onSecondary}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  backgroundColor: theme.secondaryCardBackground,
                  borderColor: theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.secondaryButtonText}>{secondaryLabel}</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SurfaceCard>
  );
}

function ProfileInfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <AppText style={styles.infoLabel}>{label}</AppText>
      <AppText style={styles.infoValue}>{value}</AppText>
    </View>
  );
}

function buildFallbackName(value?: string | null) {
  return value?.trim() || '未设置昵称';
}

export function ProfileScreen() {
  const session = useAppSession();
  const { theme } = useAppTheme();
  const [profile, setProfile] = useState<UserProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSignature, setDraftSignature] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isLoggedIn = session.status === 'authenticated';
  const sessionExpired = session.authStateReason === 'expired';

  const load = useCallback(async () => {
    const currentSession = session.session;
    if (!currentSession) return;

    setLoading(true);
    setLoadError(false);
    try {
      const next = await fetchCurrentUserProfile(currentSession);
      setProfile(next);
    } catch (error) {
      if (isExpiredSessionError(error)) {
        setProfile(null);
        await session.invalidateSession();
        return;
      }
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!isLoggedIn) {
      setProfile(null);
      setLoading(false);
      if (!sessionExpired) {
        setLoadError(false);
      }
      return;
    }
    void load();
  }, [isLoggedIn, load, sessionExpired]);

  const displayName =
    profile?.name ??
    session.user?.displayName ??
    session.user?.email?.split('@')[0] ??
    '未设置昵称';
  const email = profile?.email ?? session.user?.email ?? '未绑定邮箱';
  const avatarUrl = session.user?.avatarUrl ?? profile?.avatarUrl ?? null;
  const signature = getSignature(profile?.preferences) ?? '还没有个性签名';
  const accountStatusLabel = resolveAccountStatusLabel(isLoggedIn);
  const sessionUserCreatedAt =
    session.user && typeof (session.user as { createdAt?: unknown }).createdAt === 'string'
      ? (session.user as { createdAt?: string }).createdAt
      : null;
  const learningCompanionText = buildLearningCompanionText(profile?.createdAt ?? sessionUserCreatedAt);

  const openEditor = () => {
    setDraftName(buildFallbackName(profile?.name ?? session.user?.displayName ?? session.user?.email?.split('@')[0]));
    setDraftSignature(getSignature(profile?.preferences) ?? '');
    setSaveError(null);
    setEditorVisible(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorVisible(false);
    setSaveError(null);
  };

  const handleSave = useCallback(async () => {
    const currentSession = session.session;
    if (!currentSession) return;

    const nextName = draftName.trim();
    const nextSignature = draftSignature.trim();

    if (!nextName) {
      setSaveError('昵称不能为空');
      return;
    }
    if (nextName.length > 24) {
      setSaveError('昵称最多 24 个字符');
      return;
    }
    if (nextSignature.length > 60) {
      setSaveError('个性签名最多 60 个字符');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const nextProfile = await updateUserProfile(currentSession, {
        displayName: nextName,
        signature: nextSignature,
      });
      setProfile(nextProfile);
      await session.updateSessionUser({ displayName: nextProfile.name ?? nextName });
      setEditorVisible(false);
    } catch (error) {
      if (isExpiredSessionError(error)) {
        setEditorVisible(false);
        await session.invalidateSession();
        return;
      }
      setSaveError('资料保存失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  }, [draftName, draftSignature, session]);

  const header = (
    <View style={styles.header}>
      <View style={styles.backRow}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my')} accessibilityLabel="返回我的" />
      </View>
    </View>
  );

  if (!isLoggedIn && !sessionExpired) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <StateCard
          icon="person-circle-outline"
          title="登录后查看个人资料"
          subtitle="登录后可以管理头像、昵称和学习资料。"
          primaryLabel="去登录"
          onPrimary={() => router.push('/auth/sign-in')}
        />
      </AppScreenShell>
    );
  }

  if (sessionExpired) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <StateCard
          icon="shield-checkmark-outline"
          title="登录状态已失效"
          subtitle="请重新登录后继续使用。"
          primaryLabel="去登录"
          onPrimary={() => router.push('/auth/sign-in')}
          secondaryLabel="返回我的"
          onSecondary={() => router.replace('/my')}
        />
      </AppScreenShell>
    );
  }

  if (loadError && !loading) {
    return (
      <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <StateCard
          icon="cloud-offline-outline"
          title="个人资料暂时不可用"
          subtitle="请稍后重试。"
          primaryLabel="重新加载"
          onPrimary={() => {
            void load();
          }}
        />
      </AppScreenShell>
    );
  }

  return (
    <AppScreenShell header={header} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false} headerScrollFade>
      <SurfaceCard style={styles.profileCard}>
        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color={TEXT_SECONDARY} />
            <AppText style={styles.loadingText}>正在整理你的资料信息…</AppText>
          </View>
        ) : (
          <View style={styles.profileRow}>
            <View style={styles.avatarCircle}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} contentFit="cover" style={styles.avatarImage} />
              ) : (
                <AppText style={styles.avatarText}>{getInitials(displayName)}</AppText>
              )}
            </View>

            <View style={styles.profileMain}>
              <View style={styles.profileTitleRow}>
                <AppText style={styles.profileName}>{displayName}</AppText>
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: theme.fillTertiary,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <AppText style={styles.statusPillText}>{accountStatusLabel}</AppText>
                </View>
              </View>
              <AppText style={styles.profileEmail}>{email}</AppText>
              <AppText style={styles.profileSignature}>{signature}</AppText>
              <AppText style={styles.profileFootnote}>{learningCompanionText}</AppText>
            </View>
          </View>
        )}
      </SurfaceCard>

      <SurfaceCard style={styles.infoCard}>
        <AppText style={styles.sectionTitle}>资料信息</AppText>
        <View style={styles.infoGroup}>
          <ProfileInfoRow label="昵称" value={displayName} />
          <ProfileInfoRow label="邮箱" value={email} />
          <ProfileInfoRow label="个性签名" value={signature} />
          <ProfileInfoRow label="账号状态" value={accountStatusLabel} />
        </View>
      </SurfaceCard>

      <SurfaceCard style={styles.editCard}>
        <View style={styles.editHeader}>
          <View
            style={[
              styles.editBadge,
              {
                backgroundColor: theme.fillTertiary,
                borderColor: theme.border,
              },
            ]}
          >
            <Ionicons name="create-outline" size={16} color={theme.textPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText style={styles.editTitle}>编辑资料</AppText>
            <AppText style={styles.editSubtitle}>可修改昵称和个性签名。头像可在“我的”页头像入口更换。</AppText>
          </View>
        </View>

        <Pressable
          onPress={openEditor}
          style={({ pressed }) => [
            styles.editButton,
            {
              backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
            },
            pressed && styles.pressed,
          ]}
        >
          <AppText style={styles.editButtonText}>编辑资料</AppText>
        </Pressable>
      </SurfaceCard>

      <Modal animationType="slide" transparent visible={editorVisible} onRequestClose={closeEditor}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeEditor} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <AppText style={styles.sheetTitle}>编辑资料</AppText>
              <AppText style={styles.sheetSubtitle}>保存后会立即同步到当前资料页。</AppText>
            </View>

            <View style={styles.fieldBlock}>
              <AppText style={styles.fieldLabel}>昵称</AppText>
              <TextInput
                value={draftName}
                onChangeText={(value) => {
                  setDraftName(value);
                  if (saveError) setSaveError(null);
                }}
                placeholder="输入昵称"
                placeholderTextColor={TEXT_TERTIARY}
                maxLength={24}
                style={styles.input}
              />
              <AppText style={styles.fieldCount}>{draftName.trim().length}/24</AppText>
            </View>

            <View style={styles.fieldBlock}>
              <AppText style={styles.fieldLabel}>个性签名</AppText>
              <TextInput
                value={draftSignature}
                onChangeText={(value) => {
                  setDraftSignature(value);
                  if (saveError) setSaveError(null);
                }}
                placeholder="说一句你的学习状态"
                placeholderTextColor={TEXT_TERTIARY}
                maxLength={60}
                multiline
                textAlignVertical="top"
                style={styles.textarea}
              />
              <AppText style={styles.fieldCount}>{draftSignature.trim().length}/60</AppText>
            </View>

            {saveError ? <AppText style={styles.errorText}>{saveError}</AppText> : null}

            <View style={styles.sheetActions}>
              <Pressable
                onPress={closeEditor}
                disabled={saving}
                style={({ pressed }) => [
                  styles.sheetSecondaryButton,
                  {
                    backgroundColor: theme.secondaryCardBackground,
                    borderColor: theme.border,
                  },
                  pressed && !saving && styles.pressed,
                  saving && styles.buttonDisabled,
                ]}
              >
                <AppText style={styles.sheetSecondaryButtonText}>取消</AppText>
              </Pressable>
              <Pressable
                onPress={() => {
                  void handleSave();
                }}
                disabled={saving}
                style={({ pressed }) => [
                  styles.sheetPrimaryButton,
                  {
                    backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
                  },
                  pressed && !saving && styles.pressed,
                  saving && styles.buttonDisabled,
                ]}
              >
                <AppText style={styles.sheetPrimaryButtonText}>{saving ? '保存中…' : '保存'}</AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 28,
    gap: 16,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 0,
  },
  backRow: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 6,
    paddingBottom: 8,
  },
  profileCard: {
    padding: 22,
  },
  loadingBlock: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: FONT_BODY,
    color: TEXT_SECONDARY,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD_SOFT,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT_PRIMARY,
  },
  profileMain: {
    flex: 1,
    gap: 6,
  },
  profileTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  profileName: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
  },
  profileEmail: {
    fontSize: FONT_BODY,
    lineHeight: 21,
    color: TEXT_SECONDARY,
  },
  profileSignature: {
    fontSize: FONT_CALLOUT,
    lineHeight: 20,
    color: TEXT_PRIMARY,
  },
  profileFootnote: {
    marginTop: 2,
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 0.5,
  },
  statusPillText: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
    color: TEXT_SECONDARY,
  },
  infoCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  infoGroup: {
    marginTop: 10,
  },
  infoRow: {
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER_SOFT,
    gap: 6,
  },
  infoLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  infoValue: {
    fontSize: FONT_BODY,
    lineHeight: 21,
    color: TEXT_PRIMARY,
  },
  editCard: {
    padding: 20,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  editBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  editTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  editSubtitle: {
    marginTop: 4,
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  editButton: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEXT_PRIMARY,
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.20)',
  },
  modalBackdrop: {
    flex: 1,
  },
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 26,
    backgroundColor: BG_CARD,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: TEXT_TERTIARY,
    marginBottom: 14,
  },
  sheetHeader: {
    marginBottom: 18,
  },
  sheetTitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  sheetSubtitle: {
    marginTop: 4,
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  fieldBlock: {
    marginBottom: 14,
  },
  fieldLabel: {
    marginBottom: 8,
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    fontWeight: '600',
    color: TEXT_SECONDARY,
  },
  input: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 14,
    fontSize: FONT_BODY,
    lineHeight: 20,
    color: TEXT_PRIMARY,
    backgroundColor: BG_CARD_SOFT,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  textarea: {
    minHeight: 104,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: FONT_BODY,
    lineHeight: 20,
    color: TEXT_PRIMARY,
    backgroundColor: BG_CARD_SOFT,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  fieldCount: {
    marginTop: 6,
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_TERTIARY,
    textAlign: 'right',
  },
  errorText: {
    marginBottom: 10,
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: COLOR_RED,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  sheetSecondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  sheetSecondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  sheetPrimaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEXT_PRIMARY,
  },
  sheetPrimaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  stateCard: {
    padding: 22,
    alignItems: 'flex-start',
  },
  stateIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  stateTitle: {
    marginTop: 16,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: TEXT_PRIMARY,
  },
  stateSubtitle: {
    marginTop: 8,
    fontSize: FONT_BODY,
    lineHeight: 22,
    color: TEXT_SECONDARY,
  },
  stateActions: {
    width: '100%',
    gap: 10,
    marginTop: 18,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEXT_PRIMARY,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  pressed: {
    opacity: 0.72,
  },
});
