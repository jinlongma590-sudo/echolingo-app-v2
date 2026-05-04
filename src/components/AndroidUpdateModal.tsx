import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import {
  BackHandler,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppText } from '@/components/AppText';
import type { AndroidUpdateInfo } from '@/hooks/useAndroidAppUpdateCheck';

type AndroidUpdateModalProps = {
  updateInfo: AndroidUpdateInfo | null;
  onDismiss: () => void;
};

export function AndroidUpdateModal({ updateInfo, onDismiss }: AndroidUpdateModalProps) {
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (!updateInfo?.forceUpdate) return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [updateInfo?.forceUpdate]);

  if (!updateInfo) {
    return null;
  }

  const cardWidth = Math.min(width - 40, 340);

  const handleUpdate = () => {
    void Linking.openURL(updateInfo.apkUrl).catch(() => {
      // Keep the modal visible if Android cannot open the download URL.
    });
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={updateInfo.forceUpdate ? undefined : onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { width: cardWidth }]}>
          <View style={styles.iconHalo}>
            <Ionicons name="arrow-down-circle" size={32} color="#0A84FF" />
          </View>

          <AppText style={styles.title}>发现新版本</AppText>
          <AppText style={styles.subtitle}>EchoLingo {updateInfo.latestVersionName} 已可用</AppText>
          <AppText style={styles.message}>{updateInfo.message}</AppText>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="立即更新"
              onPress={handleUpdate}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <AppText style={styles.primaryButtonText}>立即更新</AppText>
            </Pressable>

            {!updateInfo.forceUpdate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="稍后再说"
                onPress={onDismiss}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
              >
                <AppText style={styles.secondaryButtonText}>稍后再说</AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  card: {
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    shadowColor: '#111827',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
  },
  iconHalo: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    marginBottom: 18,
    backgroundColor: 'rgba(10, 132, 255, 0.10)',
  },
  title: {
    color: '#111827',
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 7,
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  message: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 22,
  },
  primaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 25,
    backgroundColor: '#0A84FF',
    shadowColor: '#0A84FF',
    shadowOpacity: 0.26,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: '#F3F4F6',
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  secondaryPressed: {
    backgroundColor: '#E5E7EB',
  },
});
