import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { fetchEpisodeDetail } from '@/services/api/episode';
import { useMobileMe } from '@/hooks/useMobileMe';
import { fetchUserLearningRecords, type LearningRecord } from '@/services/api/learning';
import { fetchVocabularyNotebook } from '@/services/api/vocabulary';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import * as avatarModule from '@/services/profile/avatar';
import type { AvatarInputSource } from '@/services/profile/avatar';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { normalizeCoverUrl } from '@/utils/mediaUrl';
import { MyAccountPanel } from '@/screens/my-panels/MyAccountPanel';
import { MyFavoritesPanel } from '@/screens/my-panels/MyFavoritesPanel';
import { MyMethodsPanel } from '@/screens/my-panels/MyMethodsPanel';
import { MyNotesPanel } from '@/screens/my-panels/MyNotesPanel';
import { MyProfilePanel } from '@/screens/my-panels/MyProfilePanel';
import { MyResourcesPanel } from '@/screens/my-panels/MyResourcesPanel';
import { MySettingsPanel } from '@/screens/my-panels/MySettingsPanel';
import { MyLearningPanel } from '@/screens/my-panels/MyLearningPanel';

const PAGE_HORIZONTAL_PADDING = 24;
const MAX_CONTENT_WIDTH = 1328;
const COLUMN_GAP = 18;
const CARD_RADIUS = 24;
const accountBadgeLightImage = require('../../assets/images/account/account_badge_v3_clean.png');
const accountBadgeDarkImage = require('../../assets/images/account/account2.png');

type MyScreenTabletProps = {
  displayName: string;
  avatarUrl?: string | null;
  onOpenProfile: () => void;
  onOpenAccount: () => void;
  onOpenNotes: () => void;
  onOpenResources: () => void;
  onOpenMethods: () => void;
  onOpenFavorites: () => void;
  onOpenSettings: () => void;
  onOpenCommunity: () => void;
  onOpenLeaderboard: () => void;
  onOpenFeedback: () => void;
  onOpenLearning: () => void;
};

type MySelectedPanel =
  | 'overview'
  | 'profile'
  | 'account'
  | 'notes'
  | 'resources'
  | 'methods'
  | 'favorites'
  | 'settings'
  | 'learning';

type MenuItem = {
  key: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  panel: Extract<MySelectedPanel, 'account' | 'notes' | 'resources' | 'methods' | 'favorites' | 'settings'>;
};

type QuickEntry = {
  key: string;
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  background: string;
  onPress: () => void;
};

type AvatarFeedback = {
  tone: 'info' | 'success' | 'error';
  text: string;
} | null;

const resolveUploadAvatarAndUpdateProfile =
  avatarModule.uploadAvatarAndUpdateProfile ??
  avatarModule.avatarService?.uploadAvatarAndUpdateProfile ??
  avatarModule.default?.uploadAvatarAndUpdateProfile;

function getInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '我';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return trimmed.slice(0, 1).toUpperCase();
}

function formatMembershipDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatFootprintDate(value?: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function learningStatusLabel(status: LearningRecord['status']) {
  if (status === 'mastered') return '已完成';
  return '继续学习';
}

function resolveEpisodeCover(record: LearningRecord, fallbackCover?: string | null) {
  const episode = ((record.episode ?? {}) as unknown) as Record<string, unknown>;
  return (
    fallbackCover ||
    (typeof episode.cover === 'string' ? episode.cover : null) ||
    (typeof episode.thumbnailUrl === 'string' ? episode.thumbnailUrl : null) ||
    (typeof episode.thumbnail_url === 'string' ? episode.thumbnail_url : null) ||
    (typeof episode.coverUrl === 'string' ? episode.coverUrl : null) ||
    (typeof episode.cover_url === 'string' ? episode.cover_url : null) ||
    (typeof episode.imageUrl === 'string' ? episode.imageUrl : null) ||
    (typeof episode.image_url === 'string' ? episode.image_url : null) ||
    null
  );
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

function DecorativeSparkline({ color }: { color: string }) {
  const width = 150;
  const height = 40;

  const backgroundPath = useMemo(() => {
    const path = Skia.Path.Make();
    path.moveTo(0, 28);
    path.cubicTo(10, 24, 24, 20, 48, 24);
    path.cubicTo(58, 25, 66, 16, 74, 14);
    path.cubicTo(92, 12, 116, 20, 150, 10);
    return path;
  }, []);

  return (
    <Canvas style={{ width, height }}>
      <Path path={backgroundPath} color="rgba(10,132,255,0.12)" style="stroke" strokeWidth={6} strokeCap="round" />
      <Path path={backgroundPath} color={color} style="stroke" strokeWidth={2.2} strokeCap="round" />
    </Canvas>
  );
}

function TabletLoginGatePanel() {
  const { theme } = useAppTheme();

  return (
    <View style={styles.loginGateWrap}>
      <View
        style={[
          styles.loginGateCard,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.border,
            ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
          },
        ]}
      >
        <View style={[styles.loginGateIconWrap, { backgroundColor: 'rgba(10,132,255,0.12)' }]}>
          <Ionicons name="person-circle-outline" size={30} color={theme.primaryBlue} />
        </View>
        <AppText style={[styles.loginGateTitle, { color: theme.textPrimary }]}>登录 EchoLingo</AppText>
        <AppText style={[styles.loginGateSubtitle, { color: theme.textSecondary }]}>
          登录后同步学习记录、会员权益、收藏与笔记。
        </AppText>
        <View style={styles.loginGateActionRow}>
          <Pressable
            onPress={() => router.push('/auth/sign-in')}
            style={({ pressed }) => [
              styles.loginGatePrimaryButton,
              { backgroundColor: theme.primaryBlue },
              pressed && styles.buttonPressed,
            ]}
          >
            <AppText style={styles.loginGatePrimaryButtonText}>去登录</AppText>
          </Pressable>
          <Pressable
            onPress={() => router.push('/auth/sign-up')}
            style={({ pressed }) => [
              styles.loginGateSecondaryButton,
              {
                backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                borderColor: theme.border,
              },
              pressed && styles.buttonPressed,
            ]}
          >
            <AppText style={[styles.loginGateSecondaryButtonText, { color: theme.textPrimary }]}>注册账号</AppText>
          </Pressable>
        </View>
        <View
          style={[
            styles.loginGateFootnoteCard,
            {
              backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
              borderColor: theme.border,
            },
          ]}
        >
          <AppText style={[styles.loginGateFootnoteText, { color: theme.textSecondary }]}>
            游客可浏览基础内容，登录后可查看账号权益、学习档案与云端同步状态。
          </AppText>
        </View>
      </View>
    </View>
  );
}

function MetricCard({
  label,
  value,
  unit,
  width,
  icon,
  iconTint,
  iconBackground,
  valueStyle,
}: {
  label: string;
  value: string;
  unit?: string;
  width: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconTint: string;
  iconBackground: string;
  valueStyle?: object;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.metricCard,
        {
          width,
          backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.72)',
          borderColor: 'rgba(15,23,42,0.08)',
        },
      ]}
    >
      <View style={[styles.metricIconWrap, { backgroundColor: iconBackground }]}>
        <Ionicons name={icon} size={21} color={iconTint} />
      </View>
      <AppText style={[styles.metricLabel, { color: theme.textSecondary }]} numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.metricValueRow}>
        <AppText style={[styles.metricValue, { color: theme.textPrimary }, valueStyle]} numberOfLines={1}>
          {value}
        </AppText>
        {unit ? (
          <AppText style={[styles.metricUnit, { color: theme.textSecondary }]} numberOfLines={1}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export function MyScreenTablet({
  displayName,
  avatarUrl,
  onOpenProfile,
  onOpenAccount,
  onOpenNotes,
  onOpenResources,
  onOpenMethods,
  onOpenFavorites,
  onOpenSettings,
  onOpenCommunity,
  onOpenLeaderboard,
  onOpenFeedback,
  onOpenLearning,
}: MyScreenTabletProps) {
  const { width, height } = useWindowDimensions();
  const { theme } = useAppTheme();
  const floatingInsets = useFloatingTabInsets();
  const session = useAppSession();
  const mobileMe = useMobileMe();
  const updateSessionUser = session.updateSessionUser;

  const [learningRecords, setLearningRecords] = useState<LearningRecord[]>([]);
  const [learningLoading, setLearningLoading] = useState(false);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [myWordsCount, setMyWordsCount] = useState<number | null>(null);
  const [footprintCoverOverrides, setFootprintCoverOverrides] = useState<Record<string, string | null>>({});
  const [failedFootprintCoverIds, setFailedFootprintCoverIds] = useState<Record<string, boolean>>({});
  const [selectedPanel, setSelectedPanel] = useState<MySelectedPanel>('overview');
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

  const showAvatarFeedback = useCallback(
    (tone: NonNullable<AvatarFeedback>['tone'], text: string, durationMs = 2200) => {
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
    },
    [],
  );

  const loadLearningData = useCallback(async () => {
    if (session.status !== 'authenticated' || !session.session) {
      setLearningRecords([]);
      setLearningLoading(false);
      setLearningError(null);
      setMyWordsCount(null);
      setFootprintCoverOverrides({});
      setFailedFootprintCoverIds({});
      return;
    }

    setLearningLoading(true);
    setLearningError(null);
    try {
      const [records, vocabulary] = await Promise.all([
        fetchUserLearningRecords(session.session!),
        fetchVocabularyNotebook(session.session!).catch(() => null),
      ]);
      setLearningRecords(records);
      setMyWordsCount(vocabulary ? vocabulary.stats.all : null);
    } catch (error) {
      setLearningRecords([]);
      setLearningError(error instanceof Error ? error.message : '学习档案同步失败');
      setMyWordsCount(null);
    } finally {
      setLearningLoading(false);
    }
  }, [session.session, session.status]);

  const runAvatarUpdate = useCallback(
    async (source: AvatarInputSource) => {
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
        console.warn('[avatar][tablet] update failed', error);
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
                  : '上传失败，请重试';
        showAvatarFeedback('error', userMessage, 2600);
      } finally {
        setAvatarUploading(false);
      }
    },
    [session.session, session.status, showAvatarFeedback, updateSessionUser],
  );

  const handleChangeAvatarPress = useCallback(() => {
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
  }, [avatarUploading, runAvatarUpdate]);

  const handleAvatarPress = useCallback(
    (event?: Parameters<NonNullable<React.ComponentProps<typeof Pressable>['onPress']>>[0]) => {
      event?.stopPropagation?.();
      handleChangeAvatarPress();
    },
    [handleChangeAvatarPress],
  );

  useEffect(() => {
    void loadLearningData();
  }, [loadLearningData]);

  const headerTopPadding = Math.max(floatingInsets.top - 42, 52);
  const contentWidth = Math.min(width - PAGE_HORIZONTAL_PADDING * 2, MAX_CONTENT_WIDTH);
  const leftColumnWidth = Math.floor(contentWidth * 0.47);
  const rightColumnWidth = contentWidth - leftColumnWidth - COLUMN_GAP;
  const contentAreaHeight = Math.max(height - headerTopPadding - 46 - 10 - 8, 680);
  const accountBadgeImage = theme.colorScheme === 'dark' ? accountBadgeDarkImage : accountBadgeLightImage;

  const membershipExpiry = formatMembershipDate(mobileMe.data?.entitlements.membershipExpireAt);
  const isActivated = mobileMe.data?.entitlements.isActivated ?? false;
  const resolvedDisplayName =
    mobileMe.data?.user.displayName ??
    displayName ??
    session.user?.email?.split('@')[0] ??
    'EchoLingo 用户';
  const resolvedAvatarUrl =
    avatarUrl ??
    mobileMe.data?.user.avatarUrl ??
    mobileMe.data?.user.avatar_url ??
    mobileMe.data?.user.avatar ??
    mobileMe.data?.user.imageUrl ??
    mobileMe.data?.user.photoURL ??
    null;
  const resolvedEmail = mobileMe.data?.user.email ?? session.user?.email ?? '未绑定邮箱';
  const resolvedSignature = '还没有设置个性签名';
  const completedRecords = learningRecords.filter((item) => item.status === 'mastered');
  const metricWidth = Math.max((rightColumnWidth - 40 - 36) / 4, 100);
  const footprintCardWidth = Math.max((rightColumnWidth - 36 - 24) / 3, 126);
  const learningFootprints = [...learningRecords]
    .sort((a, b) => {
      const at = a.lastReviewedAt ? new Date(a.lastReviewedAt).getTime() : 0;
      const bt = b.lastReviewedAt ? new Date(b.lastReviewedAt).getTime() : 0;
      return bt - at;
    })
    .slice(0, 3);
  const initials = getInitials(resolvedDisplayName);
  const isAuthenticated = session.status === 'authenticated' && Boolean(session.user);

  useEffect(() => {
    let cancelled = false;

    const targets = learningFootprints.filter((record) => {
      const episodeId = record.episode.id;
      if (!episodeId) return false;
      if (Object.prototype.hasOwnProperty.call(footprintCoverOverrides, episodeId)) {
        return false;
      }
      const current = resolveEpisodeCover(record, null);
      return !normalizeCoverUrl(current);
    });

    if (targets.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    async function hydrateMissingFootprintCovers() {
      const results = await Promise.all(
        targets.map(async (record) => {
          try {
            const detail = await fetchEpisodeDetail(record.episode.id);
            return [record.episode.id, detail.episode.cover ?? null] as const;
          } catch (error) {
            console.warn('[MyScreenTablet] footprint cover hydrate failed', {
              id: record.episode.id,
              title: record.episode.title,
              error: error instanceof Error ? error.message : String(error),
            });
            return [record.episode.id, null] as const;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setFootprintCoverOverrides((current) => {
        const next = { ...current };
        results.forEach(([episodeId, cover]) => {
          if (!Object.prototype.hasOwnProperty.call(next, episodeId)) {
            next[episodeId] = cover;
          }
        });
        return next;
      });
    }

    void hydrateMissingFootprintCovers();

    return () => {
      cancelled = true;
    };
  }, [footprintCoverOverrides, learningFootprints]);

  const menuItems = useMemo<MenuItem[]>(
    () => [
      { key: 'account', title: '账号与权益', icon: 'person-circle-outline', panel: 'account' },
      { key: 'notes', title: '我的笔记', icon: 'document-text-outline', panel: 'notes' },
      { key: 'resources', title: '学习资源', icon: 'library-outline', panel: 'resources' },
      { key: 'methods', title: '学习方法', icon: 'school-outline', panel: 'methods' },
      { key: 'favorites', title: '我的收藏', icon: 'heart-outline', panel: 'favorites' },
      { key: 'settings', title: '设置', icon: 'settings-outline', panel: 'settings' },
    ],
    [],
  );

  const quickEntries = useMemo<QuickEntry[]>(
    () => [
      {
        key: 'community',
        title: '学习社区',
        subtitle: '敬请期待',
        icon: 'people-outline',
        tint: '#8B5CF6',
        background: 'rgba(139,92,246,0.12)',
        onPress: onOpenCommunity,
      },
      {
        key: 'leaderboard',
        title: '排行榜',
        subtitle: '查看名次',
        icon: 'trophy-outline',
        tint: '#0A84FF',
        background: 'rgba(10,132,255,0.12)',
        onPress: onOpenLeaderboard,
      },
      {
        key: 'feedback',
        title: '反馈',
        subtitle: '告诉我们',
        icon: 'chatbubble-ellipses-outline',
        tint: '#34C759',
        background: 'rgba(52,199,89,0.12)',
        onPress: onOpenFeedback,
      },
    ],
    [onOpenCommunity, onOpenFeedback, onOpenLeaderboard],
  );

  const renderOverviewPanel = () => (
    <>
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
          <View style={styles.membershipEyebrowRow}>
            <Ionicons name="sparkles-outline" size={16} color={theme.primaryBlue} />
            <AppText style={[styles.membershipEyebrow, { color: theme.textSecondary }]}>会员权益</AppText>
          </View>
          <AppText style={[styles.membershipTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {isActivated ? 'EchoLingo Pro' : 'EchoLingo Free'}
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
          <Pressable
            onPress={() => setSelectedPanel('account')}
            style={({ pressed }) => [
              styles.membershipButton,
              {
                backgroundColor: theme.primaryBlue,
                shadowColor: theme.primaryBlue,
                shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.14,
              },
              pressed && styles.buttonPressed,
            ]}
          >
            <AppText style={styles.membershipButtonText}>查看权益</AppText>
          </Pressable>
        </View>
      </View>

      <View
        style={[
          styles.archiveCard,
          {
            backgroundColor: theme.cardBackground,
            borderColor: 'rgba(15,23,42,0.08)',
            ...cardShadow(theme.colorScheme, theme.shadowColor),
          },
        ]}
      >
        <View style={styles.cardHeaderRow}>
          <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>学习档案</AppText>
          <Pressable onPress={() => setSelectedPanel('learning')} hitSlop={8}>
            <AppText style={[styles.cardLink, { color: theme.primaryBlue }]}>查看全部</AppText>
          </Pressable>
        </View>

        <View style={styles.metricGridRow}>
          <MetricCard
            label="学习记录"
            value={String(learningRecords.length)}
            unit="条"
            width={metricWidth}
            icon="albums-outline"
            iconTint="#0A84FF"
            iconBackground="rgba(10,132,255,0.12)"
          />
          <MetricCard
            label="已完成"
            value={String(completedRecords.length)}
            unit="条"
            width={metricWidth}
            icon="checkmark-done-outline"
            iconTint="#34C759"
            iconBackground="rgba(52,199,89,0.12)"
          />
          <MetricCard
            label="累计单词"
            value={myWordsCount === null ? '--' : String(myWordsCount)}
            unit={myWordsCount === null ? undefined : '词'}
            width={metricWidth}
            icon="book-outline"
            iconTint="#8B5CF6"
            iconBackground="rgba(139,92,246,0.12)"
          />
          <MetricCard
            label="会员状态"
            value={isActivated ? '已激活' : '未激活'}
            unit="权益"
            width={metricWidth}
            icon="sparkles-outline"
            iconTint={theme.primaryBlue}
            iconBackground="rgba(10,132,255,0.12)"
            valueStyle={styles.metricValueCompact}
          />
        </View>

        <View style={styles.archiveFooterRow}>
          <View style={styles.archiveTrendInfo}>
            <Ionicons
              name="trending-up-outline"
              size={18}
              color={learningError ? theme.destructive : theme.primaryBlue}
            />
            <AppText
              style={[
                styles.archiveStatusText,
                { color: learningError ? theme.destructive : theme.textSecondary },
              ]}
              numberOfLines={1}
            >
              {learningError
                ? learningError
                : learningLoading
                  ? '正在同步学习档案…'
                  : learningRecords.length > 0
                    ? '最近学习记录已同步'
                    : '暂无学习档案数据'}
            </AppText>
          </View>
          <DecorativeSparkline color={theme.primaryBlue} />
        </View>
      </View>

      <View
        style={[
          styles.quickEntryCard,
          {
            backgroundColor: theme.cardBackground,
            borderColor: 'rgba(15,23,42,0.08)',
            ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
          },
        ]}
      >
        <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>快捷入口</AppText>
        <View style={styles.quickEntryRow}>
          {quickEntries.map((entry) => (
            <Pressable
              key={entry.key}
              onPress={entry.onPress}
              style={({ pressed }) => [
                styles.quickEntryItem,
                {
                  backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.78)',
                  borderColor: 'rgba(15,23,42,0.08)',
                },
                pressed && styles.cardPressed,
              ]}
            >
              <View style={[styles.quickEntryIconWrap, { backgroundColor: entry.background }]}>
                <Ionicons name={entry.icon} size={18} color={entry.tint} />
              </View>
              <View style={styles.quickEntryTextWrap}>
                <AppText style={[styles.quickEntryTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                  {entry.title}
                </AppText>
                <AppText style={[styles.quickEntrySubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                  {entry.subtitle}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
            </Pressable>
          ))}
        </View>
      </View>

      <View
        style={[
          styles.footprintCard,
          {
            backgroundColor: theme.cardBackground,
            borderColor: 'rgba(15,23,42,0.08)',
            ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
          },
        ]}
      >
        <View style={styles.cardHeaderRow}>
          <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>学习足迹</AppText>
          <Pressable onPress={() => setSelectedPanel('learning')} hitSlop={8}>
            <AppText style={[styles.cardLink, { color: theme.primaryBlue }]}>查看全部</AppText>
          </Pressable>
        </View>

        {learningFootprints.length > 0 ? (
          <View style={styles.footprintRow}>
            {learningFootprints.map((record) => {
              const progress =
                record.totalSentences > 0
                  ? Math.min(1, Math.max(0, record.reviewedSentences / record.totalSentences))
                  : 0;
              const imageUri = normalizeCoverUrl(
                resolveEpisodeCover(record, footprintCoverOverrides[record.episode.id] ?? null),
              );
              const imageSource = imageUri && !failedFootprintCoverIds[record.episode.id] ? { uri: imageUri } : null;
              return (
                <Pressable
                  key={record.episode.id}
                  onPress={() =>
                    router.push({
                      pathname: '/episode/[id]',
                      params: record.lastSentenceId
                        ? { id: record.episode.id, sentence: String(record.lastSentenceId) }
                        : { id: record.episode.id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.footprintItem,
                    {
                      width: footprintCardWidth,
                      backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.76)',
                      borderColor: 'rgba(15,23,42,0.08)',
                    },
                    pressed && styles.cardPressed,
                  ]}
                >
                  {imageSource ? (
                    <Image
                      source={imageSource}
                      contentFit="cover"
                      style={styles.footprintThumb}
                      onError={() => {
                        console.warn('[MyScreenTablet] footprint cover image failed', {
                          id: record.episode.id,
                          title: record.episode.title,
                          coverUrl: imageUri,
                        });
                        setFailedFootprintCoverIds((current) => ({
                          ...current,
                          [record.episode.id]: true,
                        }));
                      }}
                    />
                  ) : (
                    <View style={[styles.footprintThumb, styles.footprintThumbFallback]}>
                      <Ionicons name="image-outline" size={18} color="#0A84FF" />
                    </View>
                  )}
                  <View style={styles.footprintInfo}>
                    <AppText style={[styles.footprintTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                      {record.episode.title}
                    </AppText>
                    <AppText style={[styles.footprintMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                      {learningStatusLabel(record.status)} · {formatFootprintDate(record.lastReviewedAt)}
                    </AppText>
                    <View style={[styles.footprintProgressTrack, { backgroundColor: 'rgba(15,23,42,0.08)' }]}>
                      <View style={[styles.footprintProgressFill, { width: `${progress * 100}%`, backgroundColor: theme.primaryBlue }]} />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.footprintEmptyWrap}>
            <AppText style={[styles.footprintEmptyText, { color: theme.textSecondary }]}>
              暂无学习足迹，完成一次精听后会显示在这里。
            </AppText>
          </View>
        )}
      </View>
    </>
  );

  const renderSelectedPanel = () => {
    if (
      !isAuthenticated &&
      selectedPanel !== 'resources' &&
      selectedPanel !== 'methods' &&
      selectedPanel !== 'settings'
    ) {
      return <TabletLoginGatePanel />;
    }

    switch (selectedPanel) {
      case 'profile':
        return (
          <MyProfilePanel
            displayName={resolvedDisplayName}
            avatarUrl={resolvedAvatarUrl}
            email={resolvedEmail}
            signature={resolvedSignature}
            isAuthenticated={session.status === 'authenticated'}
            isActivated={isActivated}
            avatarUploading={avatarUploading}
            avatarFeedback={avatarFeedback}
            onAvatarPress={handleAvatarPress}
          />
        );
      case 'account':
        return (
          <MyAccountPanel
            isActivated={isActivated}
            membershipType={mobileMe.data?.entitlements.membershipType ?? null}
            membershipExpiry={membershipExpiry}
            canUseAiPractice={mobileMe.data?.entitlements.canUseAiPractice ?? false}
            canUsePremiumLibrary={mobileMe.data?.entitlements.canUsePremiumLibrary ?? false}
            canUseVocabulary={mobileMe.data?.entitlements.canUseVocabulary ?? false}
            hasLearningSync={session.status === 'authenticated'}
            speakingCredits={mobileMe.data?.entitlements.speakingCredits ?? 0}
            accessToken={session.session?.accessToken ?? null}
            refreshAccount={mobileMe.refresh}
          />
        );
      case 'settings':
        return (
          <MySettingsPanel
            onOpenFeedback={onOpenFeedback}
            onRefreshData={async () => {
              await Promise.all([mobileMe.refresh(), loadLearningData()]);
            }}
            isAuthenticated={isAuthenticated}
            onSignedOut={() => setSelectedPanel('overview')}
            onAccountDeleted={() => {
              setSelectedPanel('overview');
              router.replace('/auth/sign-in');
            }}
            syncSummary={
              learningLoading
                ? '学习记录正在同步中。'
                : learningError
                  ? `学习记录同步异常：${learningError}`
                  : `已同步 ${learningRecords.length} 条学习记录。`
            }
          />
        );
      case 'resources':
        return <MyResourcesPanel />;
      case 'methods':
        return <MyMethodsPanel />;
      case 'notes':
        return <MyNotesPanel />;
      case 'favorites':
        return <MyFavoritesPanel />;
      case 'learning':
        return (
          <MyLearningPanel
            records={learningRecords}
            loading={learningLoading}
            error={learningError}
            onReload={loadLearningData}
          />
        );
      case 'overview':
      default:
        return renderOverviewPanel();
    }
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
      <View style={[styles.page, { paddingTop: headerTopPadding, paddingHorizontal: PAGE_HORIZONTAL_PADDING }]}>
        <View style={[styles.pageInner, { width: contentWidth }]}>
          <View style={styles.headerRow}>
            <View>
              <AppText style={[styles.headerTitle, { color: theme.textPrimary }]}>我的</AppText>
              <AppText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                管理你的账号、学习与个性化设置
              </AppText>
            </View>
            <TopRightAvatarButton onPress={() => setSelectedPanel('profile')} />
          </View>

          <View style={[styles.columnsFrame, { height: contentAreaHeight }]}>
            <View style={[styles.leftColumn, { width: leftColumnWidth }]}>
              <Pressable
                onPress={() => setSelectedPanel('profile')}
                style={({ pressed }) => [
                  styles.profileCard,
                  {
                    backgroundColor:
                      selectedPanel === 'profile'
                        ? theme.colorScheme === 'dark'
                          ? theme.secondaryCardBackground
                          : 'rgba(255,255,255,0.96)'
                        : theme.cardBackground,
                    borderColor:
                      selectedPanel === 'profile'
                        ? theme.colorScheme === 'dark'
                          ? 'rgba(10,132,255,0.24)'
                          : 'rgba(0,122,255,0.22)'
                        : 'rgba(15,23,42,0.08)',
                    ...cardShadow(theme.colorScheme, theme.shadowColor),
                  },
                  pressed && styles.sidebarCardPressed,
                ]}
              >
                <Pressable
                  disabled={avatarUploading}
                  hitSlop={10}
                  onPress={handleAvatarPress}
                  style={({ pressed }) => [
                    styles.profileAvatarButton,
                    pressed && !avatarUploading && styles.buttonPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.profileAvatarWrap,
                      selectedPanel === 'profile' && styles.profileAvatarWrapSelected,
                    ]}
                  >
                    {resolvedAvatarUrl ? (
                      <Image source={{ uri: resolvedAvatarUrl }} contentFit="cover" style={styles.profileAvatarImage} />
                    ) : (
                      <AppText style={styles.profileAvatarText}>{initials}</AppText>
                    )}
                    {avatarUploading ? (
                      <View style={styles.profileAvatarLoadingOverlay}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.profileAvatarBadge,
                      {
                        backgroundColor:
                          theme.colorScheme === 'dark' ? theme.cardBackground : 'rgba(255,255,255,0.94)',
                        borderColor:
                          theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)',
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
                <View style={styles.profileTextWrap}>
                  <AppText
                    style={[
                      styles.profileName,
                      { color: selectedPanel === 'profile' ? '#0A84FF' : theme.textPrimary },
                    ]}
                    numberOfLines={1}
                  >
                    {resolvedDisplayName}
                  </AppText>
                  <AppText style={[styles.profileSubtitle, { color: theme.textSecondary }]} numberOfLines={2}>
                    头像、资料与个性签名
                  </AppText>
                  {avatarFeedback ? (
                    <AppText
                      style={[
                        styles.profileAvatarFeedbackText,
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
                <Ionicons
                  name="chevron-forward"
                  size={24}
                  color={selectedPanel === 'profile' ? '#0A84FF' : theme.textSecondary}
                />
              </Pressable>

              <View
                style={[
                  styles.menuCard,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: 'rgba(15,23,42,0.08)',
                    ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                  },
                ]}
              >
                {menuItems.map((item, index) => {
                  const isSelected = selectedPanel === item.panel;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setSelectedPanel(item.panel)}
                      style={({ pressed }) => [
                        styles.menuRow,
                        {
                          backgroundColor: isSelected
                            ? 'rgba(0,122,255,0.08)'
                            : pressed
                              ? theme.secondaryCardBackground
                              : 'transparent',
                          shadowOpacity: 0,
                          elevation: 0,
                        },
                      ]}
                    >
                      <View style={styles.menuRowContent}>
                        <View
                          style={[
                            styles.menuIconWrap,
                            {
                              backgroundColor: isSelected ? 'rgba(0,122,255,0.12)' : theme.secondaryCardBackground,
                            },
                          ]}
                        >
                          <Ionicons name={item.icon} size={18} color={theme.primaryBlue} />
                        </View>
                        <AppText
                          style={[
                            styles.menuRowTitle,
                            { color: isSelected ? '#0A84FF' : theme.textPrimary },
                          ]}
                        >
                          {item.title}
                        </AppText>
                        <Ionicons
                          name="chevron-forward"
                          size={22}
                          color={isSelected ? '#0A84FF' : theme.textSecondary}
                        />
                      </View>
                      {index < menuItems.length - 1 ? (
                        <View style={[styles.menuDivider, { backgroundColor: 'rgba(15,23,42,0.08)' }]} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.rightPanelShell, { width: rightColumnWidth, height: contentAreaHeight }]}>
              <ScrollView
                style={styles.rightPanelScroller}
                contentContainerStyle={styles.rightPanelContent}
                showsVerticalScrollIndicator={false}
                bounces
              >
                {renderSelectedPanel()}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroller: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  page: {
    flex: 1,
  },
  pageInner: {
    alignSelf: 'center',
  },
  columnsFrame: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
    minHeight: 0,
  },
  headerRow: {
    height: 46,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
  },
  columns: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
  },
  columnsSingle: {
    flexDirection: 'column',
  },
  leftColumn: {
    minWidth: 0,
  },
  rightColumn: {
    minWidth: 0,
  },
  profileCard: {
    height: 150,
    borderRadius: CARD_RADIUS,
    paddingHorizontal: 26,
    paddingVertical: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profileAvatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D8DEE8',
  },
  profileAvatarButton: {
    marginRight: 0,
  },
  profileAvatarWrapSelected: {
    backgroundColor: 'rgba(0,122,255,0.12)',
  },
  profileAvatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,17,17,0.32)',
  },
  profileAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarText: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  profileAvatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileTextWrap: {
    flex: 1,
    paddingHorizontal: 18,
  },
  profileName: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  profileSubtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
  },
  profileAvatarFeedbackText: {
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '500',
  },
  menuCard: {
    marginTop: 16,
    borderRadius: CARD_RADIUS,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  menuRow: {
    minHeight: 68,
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: 10,
  },
  menuRowContent: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  menuRowTitle: {
    flex: 1,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
  },
  menuDivider: {
    marginLeft: 62,
    height: StyleSheet.hairlineWidth,
  },
  rightPanelShell: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  rightPanelScroller: {
    flex: 1,
  },
  rightPanelContent: {
    flexGrow: 1,
    paddingTop: 0,
    paddingBottom: 20,
  },
  loginGateWrap: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 520,
    paddingVertical: 12,
  },
  loginGateCard: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 28,
    paddingVertical: 30,
    alignItems: 'center',
  },
  loginGateIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  loginGateTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  loginGateSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 520,
  },
  loginGateActionRow: {
    marginTop: 24,
    flexDirection: 'row',
    gap: 12,
  },
  loginGatePrimaryButton: {
    height: 46,
    minWidth: 132,
    borderRadius: 23,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginGatePrimaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loginGateSecondaryButton: {
    height: 46,
    minWidth: 132,
    borderRadius: 23,
    paddingHorizontal: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginGateSecondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  loginGateFootnoteCard: {
    marginTop: 18,
    width: '100%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  loginGateFootnoteText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    textAlign: 'center',
  },
  membershipCard: {
    position: 'relative',
    height: 168,
    borderRadius: CARD_RADIUS,
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
  membershipContent: {
    position: 'relative',
    width: '58%',
    zIndex: 2,
  },
  membershipEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  membershipEyebrow: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  membershipTitle: {
    marginTop: 6,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  membershipSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  membershipButton: {
    marginTop: 14,
    width: 106,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  membershipButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  archiveCard: {
    marginTop: 12,
    height: 238,
    borderRadius: CARD_RADIUS,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardHeaderRow: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  cardLink: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  metricGridRow: {
    marginTop: 12,
    height: 116,
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    height: 116,
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
  },
  metricIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  metricValueRow: {
    gap: 2,
  },
  metricValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  metricValueCompact: {
    fontSize: 20,
    lineHeight: 26,
  },
  metricUnit: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  archiveFooterRow: {
    marginTop: 14,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  archiveTrendInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  archiveStatusText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  quickEntryCard: {
    marginTop: 12,
    height: 112,
    borderRadius: CARD_RADIUS,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  quickEntryRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
  },
  quickEntryItem: {
    flex: 1,
    height: 52,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickEntryIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  quickEntryTextWrap: {
    flex: 1,
  },
  quickEntryTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  quickEntrySubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
  },
  footprintCard: {
    marginTop: 12,
    height: 138,
    borderRadius: CARD_RADIUS,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  footprintRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 12,
  },
  footprintItem: {
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  footprintThumb: {
    width: 54,
    height: 38,
    borderRadius: 10,
    marginRight: 10,
  },
  footprintThumbFallback: {
    backgroundColor: 'rgba(0,122,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footprintInfo: {
    flex: 1,
  },
  footprintTitle: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
  },
  footprintMeta: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
  },
  footprintProgressTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  footprintProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  footprintEmptyWrap: {
    height: 66,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footprintEmptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.86,
  },
  cardPressed: {
    opacity: 0.82,
  },
  sidebarCardPressed: {
    opacity: 0.94,
  },
});
