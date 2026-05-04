import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { MyScreenTablet } from '@/screens/MyScreenTablet';
import * as avatarModule from '@/services/profile/avatar';
import type { AvatarInputSource } from '@/services/profile/avatar';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { BG_CARD, BG_CARD_SOFT, BORDER_SOFT, SPACING_PAGE_H, TAB_SELECTED_TINT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY } from '@/theme/tokens';
import { openAppSafeUrl } from '@/utils/appSafeLink';

const ACCOUNT_ACTION_COLOR = TAB_SELECTED_TINT;

type ProfileCardProps = {
  name: string;
  subtitle: string;
  initials: string;
  avatarUrl?: string | null;
  avatarUploading?: boolean;
  onPress?: () => void;
  onAvatarPress?: (event: Parameters<NonNullable<React.ComponentProps<typeof Pressable>['onPress']>>[0]) => void;
};

type SettingsRowItem = {
  key: string;
  title: string;
  onPress?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tint?: string;
};

type SettingsGroupProps = {
  items: SettingsRowItem[];
};

type ActionTileProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  onPress?: () => void;
};

type AvatarFeedback = {
  tone: 'info' | 'success' | 'error';
  text: string;
} | null;

function getInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '我';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return trimmed.slice(0, 1).toUpperCase();
}

function noop() {
  // TODO: connect the destination when the target screen is confirmed.
}

const resolveUploadAvatarAndUpdateProfile =
  avatarModule.uploadAvatarAndUpdateProfile ??
  avatarModule.avatarService?.uploadAvatarAndUpdateProfile ??
  avatarModule.default?.uploadAvatarAndUpdateProfile;

function ProfileCard({ name, subtitle, initials, avatarUrl, avatarUploading = false, onPress, onAvatarPress }: ProfileCardProps) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileCard,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.profileRow}>
        <Pressable
          disabled={avatarUploading}
          hitSlop={10}
          onPress={onAvatarPress}
          style={({ pressed }) => [styles.avatarButton, pressed && styles.avatarPressed]}
        >
          <View style={[styles.avatarCircle, { backgroundColor: theme.secondaryCardBackground }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} contentFit="cover" style={styles.avatarImage} />
            ) : (
              <AppText style={[styles.avatarText, { color: theme.textPrimary }]}>{initials}</AppText>
            )}
            {avatarUploading ? (
              <View style={styles.avatarLoadingOverlay}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : null}
          </View>
          <View style={[styles.avatarBadge, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
            {avatarUploading ? (
              <ActivityIndicator size="small" color={theme.textPrimary} />
            ) : (
              <Ionicons name="camera-outline" size={10} color={theme.textPrimary} />
            )}
          </View>
        </Pressable>

        <View style={styles.profileMain}>
          <AppText numberOfLines={1} style={[styles.profileName, { color: theme.textPrimary }]}>
            {name}
          </AppText>
          <AppText numberOfLines={2} style={[styles.profileSubtitle, { color: theme.textSecondary }]}>
            {subtitle}
          </AppText>
        </View>

        <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
      </View>
    </Pressable>
  );
}

function SettingsGroup({ items }: SettingsGroupProps) {
  const { theme } = useAppTheme();

  return (
    <View style={[styles.groupCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const tint = item.tint ?? theme.textPrimary;
        const dividerInset = item.icon ? 52 : 18;
        return (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.groupRow,
              { backgroundColor: pressed ? theme.secondaryCardBackground : theme.cardBackground },
            ]}
          >
            <View style={styles.groupRowContent}>
              <View style={styles.groupRowLeading}>
                {item.icon ? <Ionicons name={item.icon} size={20} color={tint} /> : null}
                <AppText style={[styles.groupRowTitle, { color: tint }]}>{item.title}</AppText>
              </View>
              <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
            </View>
            {!isLast ? <View style={[styles.groupDivider, { marginLeft: dividerInset, backgroundColor: theme.border }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ActionTile({ icon, title, onPress }: ActionTileProps) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionTile,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
        pressed && styles.cardPressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.primaryBlue} />
      <AppText style={[styles.actionTileTitle, { color: theme.primaryBlue }]}>{title}</AppText>
    </Pressable>
  );
}

export function MyScreen() {
  const { shouldUseTabletLayout } = useDeviceClass();
  const { theme } = useAppTheme();
  const session = useAppSession();
  const updateSessionUser = session.updateSessionUser;
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState<AvatarFeedback>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const showAvatarFeedback = (tone: NonNullable<AvatarFeedback>['tone'], text: string, durationMs = 2200) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setAvatarFeedback({ tone, text });
    if (durationMs > 0) {
      feedbackTimerRef.current = setTimeout(() => {
        setAvatarFeedback(null);
        feedbackTimerRef.current = null;
      }, durationMs);
    }
  };

  const profileName = session.user?.displayName ?? session.user?.email?.split('@')[0] ?? '我的账户';
  const profileSubtitle = '头像、资料与个性签名';
  const profileInitials = getInitials(profileName);
  const profileAvatarUrl = session.user?.avatarUrl ?? null;

  const handleProfilePress = () => {
    router.push('/my/profile');
  };

  const handleMyAccountPress = () => {
    router.push('/my/account');
  };

  const handleMyNotesPress = () => {
    router.push('/my/notes');
  };

  const handleLearningResourcesPress = () => {
    router.push('/my/resources');
  };

  const handleLearningMethodsPress = () => {
    router.push('/my/methods');
  };

  const handleMyFavoritesPress = () => {
    router.push('/my/favorites');
  };

  const handleSettingsPress = () => {
    router.push('/my/settings');
  };

  const handleLearningPress = () => {
    router.push('/my/learning');
  };

  const handleCommunityPress = () => {
    Alert.alert('学习社区待开放', '学习社区入口正在准备中。');
  };

  const handleLeaderboardPress = () => {
    router.push('/my/leaderboard');
  };

  const handleFeedbackPress = () => {
    void (async () => {
      const target = 'https://echolingo.cn/feedback';
      try {
        await openAppSafeUrl(target);
      } catch (error) {
        const message =
          error instanceof Error && error.message === 'blocked_purchase_risk_url'
            ? '请在 App 内完成购买或账号相关操作。'
            : '请稍后再试，或前往 echolingo.cn/feedback 提交反馈。';
        Alert.alert('暂时无法打开', message);
      }
    })();
  };

  const runAvatarUpdate = async (source: AvatarInputSource) => {
    if (!session.session || session.status !== 'authenticated') {
      Alert.alert('暂不可用', '请先登录后再更换头像');
      return;
    }

    setAvatarUploading(true);
    showAvatarFeedback('info', '头像上传中…', 0);
    try {
      if (typeof resolveUploadAvatarAndUpdateProfile !== 'function') {
        throw new Error('头像上传模块未正确加载，请刷新页面后重试');
      }
      const result = await resolveUploadAvatarAndUpdateProfile(session.session, source);
      if (!result) {
        setAvatarFeedback(null);
        return;
      }
      if (typeof updateSessionUser !== 'function') {
        throw new Error('头像刷新能力未初始化，请重新进入页面后重试');
      }
      await updateSessionUser({ avatarUrl: result.avatarUrl });
      showAvatarFeedback('success', '头像已更新');
    } catch (error) {
      console.warn('[avatar] update failed', error);
      const message = error instanceof Error ? error.message : '';
      const userMessage =
        message.includes('相册')
          ? '请允许访问相册'
          : message.includes('相机')
            ? '请允许访问相机'
            : message.includes('只能选择图片')
              ? '请选择图片文件'
              : message.includes('模块') || message.includes('原生包')
                ? '请重新打开 App 后重试'
                : '头像上传失败，请重试';
      showAvatarFeedback('error', userMessage, 2600);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleChangeAvatarPress = () => {
    if (avatarUploading) return;

    Alert.alert('更换头像', '选择头像来源', [
      {
        text: '拍照',
        onPress: () => {
          void runAvatarUpdate('camera');
        },
      },
      {
        text: '从相册选择',
        onPress: () => {
          void runAvatarUpdate('library');
        },
      },
      {
        text: '取消',
        style: 'cancel',
      },
    ]);
  };

  const handleAvatarPress: ProfileCardProps['onAvatarPress'] = (event) => {
    event.stopPropagation();
    handleChangeAvatarPress();
  };

  const firstGroupItems = useMemo<SettingsRowItem[]>(
    () => [
      { key: 'account', title: '账号与权益', onPress: handleMyAccountPress },
      { key: 'notes', title: '我的笔记', onPress: handleMyNotesPress },
      { key: 'resources', title: '学习资源', onPress: handleLearningResourcesPress },
      { key: 'methods', title: '学习方法', onPress: handleLearningMethodsPress },
      { key: 'favorites', title: '我的收藏', onPress: handleMyFavoritesPress },
      { key: 'learning', title: '学习记录', onPress: handleLearningPress },
      { key: 'settings', title: '设置', onPress: handleSettingsPress },
    ],
    [],
  );

  const actionTiles = useMemo<ActionTileProps[]>(
    () => [
      { icon: 'people-outline', title: '学习社区', onPress: handleCommunityPress },
      { icon: 'trophy-outline', title: '排行榜', onPress: handleLeaderboardPress },
      { icon: 'chatbubble-ellipses-outline', title: '反馈', onPress: handleFeedbackPress },
    ],
    [],
  );

  if (shouldUseTabletLayout) {
    return (
      <MyScreenTablet
        displayName={profileName}
        avatarUrl={profileAvatarUrl}
        onOpenProfile={handleProfilePress}
        onOpenAccount={handleMyAccountPress}
        onOpenNotes={handleMyNotesPress}
        onOpenResources={handleLearningResourcesPress}
        onOpenMethods={handleLearningMethodsPress}
        onOpenFavorites={handleMyFavoritesPress}
        onOpenSettings={handleSettingsPress}
        onOpenCommunity={handleCommunityPress}
        onOpenLeaderboard={handleLeaderboardPress}
        onOpenFeedback={handleFeedbackPress}
        onOpenLearning={handleLearningPress}
      />
    );
  }

  return (
    <AppScreenShell
      showsVerticalScrollIndicator={false}
      headerScrollFade
      title="我的"
    >
      <View style={styles.pageContent}>
        <ProfileCard
          name={profileName}
          subtitle={profileSubtitle}
          initials={profileInitials}
          avatarUrl={profileAvatarUrl}
          avatarUploading={avatarUploading}
          onPress={handleProfilePress}
          onAvatarPress={handleAvatarPress}
        />

        {avatarFeedback ? (
          <View
            style={[
              styles.avatarFeedbackRow,
              avatarFeedback.tone === 'success'
                ? styles.avatarFeedbackSuccess
                : avatarFeedback.tone === 'error'
                  ? styles.avatarFeedbackError
                  : styles.avatarFeedbackInfo,
            ]}
          >
            {avatarFeedback.tone === 'info' ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
            <AppText
              style={[
                styles.avatarFeedbackText,
                { color: theme.textSecondary },
                avatarFeedback.tone === 'success'
                  ? { color: theme.success }
                  : avatarFeedback.tone === 'error'
                    ? { color: theme.destructive }
                    : null,
              ]}
            >
              {avatarFeedback.text}
            </AppText>
          </View>
        ) : null}

        <SettingsGroup items={firstGroupItems} />

        <View style={styles.actionsRow}>
          {actionTiles.map((item) => (
            <ActionTile key={item.title} icon={item.icon} title={item.title} onPress={item.onPress} />
          ))}
        </View>
        <AppText style={[styles.actionsFootnote, { color: theme.textTertiary }]}>学习社区待开放</AppText>
      </View>
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 0,
    paddingBottom: 18,
    gap: 16,
  },
  largeSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '400',
    color: TEXT_SECONDARY,
  },
  profileCard: {
    minHeight: 104,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 22,
    backgroundColor: BG_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER_SOFT,
  },
  cardPressed: {
    opacity: 0.8,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarButton: {
    marginRight: 16,
  },
  avatarPressed: {
    opacity: 0.82,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD_SOFT,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,17,17,0.32)',
  },
  avatarFeedbackRow: {
    minHeight: 24,
    marginTop: -2,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatarFeedbackInfo: {},
  avatarFeedbackSuccess: {},
  avatarFeedbackError: {},
  avatarFeedbackText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  avatarFeedbackTextSuccess: {
    color: '#247A47',
  },
  avatarFeedbackTextError: {
    color: '#B84A4A',
  },
  avatarText: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  avatarBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER_SOFT,
  },
  profileMain: {
    flex: 1,
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },
  profileSubtitle: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 15,
    fontWeight: '400',
    color: TEXT_SECONDARY,
  },
  groupCard: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: BG_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER_SOFT,
  },
  groupRow: {
    minHeight: 60,
    justifyContent: 'center',
    backgroundColor: BG_CARD,
  },
  rowPressed: {
    backgroundColor: BG_CARD_SOFT,
  },
  groupRowContent: {
    minHeight: 60,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupRowLeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingRight: 14,
  },
  groupRowTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '400',
    color: TEXT_PRIMARY,
  },
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER_SOFT,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  actionsFootnote: {
    marginTop: 2,
    marginBottom: 6,
    fontSize: 12,
    lineHeight: 15,
    color: TEXT_TERTIARY,
    textAlign: 'center',
  },
  actionTile: {
    flex: 1,
    minHeight: 82,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER_SOFT,
  },
  actionTileTitle: {
    marginTop: 8,
    fontSize: 13.5,
    lineHeight: 16,
    fontWeight: '500',
    color: ACCOUNT_ACTION_COLOR,
    textAlign: 'center',
  },
});
