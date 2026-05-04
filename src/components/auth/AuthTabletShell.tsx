import React from 'react';
import { View } from 'react-native';

import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton } from '@/components/ui/ApplePrimitives';

type AuthTabletShellProps = {
  children: React.ReactNode;
  onBack: () => void;
  backLabel?: string;
};

const PAGE_PADDING = 32;
const CONTENT_MAX_WIDTH = 560;

export function AuthTabletShell({
  children,
  onBack,
  backLabel = '返回',
}: AuthTabletShellProps) {
  return (
    <AppScreenShell
      includeBottomInset={false}
      disableTabletTopInset
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 36 }}
    >
      <View style={{ flexGrow: 1, minHeight: '100%', paddingHorizontal: PAGE_PADDING }}>
        <View style={{ paddingTop: 8, alignItems: 'flex-start' }}>
          <ChromeIconButton icon="chevron-back" onPress={onBack} accessibilityLabel={backLabel} />
        </View>
        <View
          style={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingTop: 24,
            paddingBottom: 72,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: CONTENT_MAX_WIDTH,
              alignSelf: 'center',
            }}
          >
            {children}
          </View>
        </View>
      </View>
    </AppScreenShell>
  );
}
