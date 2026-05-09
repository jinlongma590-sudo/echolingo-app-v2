import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { hideSplashSafe } from '@/lib/splashControl';

type RootErrorBoundaryProps = {
  children: React.ReactNode;
};

type RootErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string | null;
};

export class RootErrorBoundary extends React.Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown_error'),
    };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('[RootErrorBoundary] caught', JSON.stringify({
      message: error instanceof Error ? error.message : String(error ?? 'unknown'),
      componentStack: info?.componentStack ?? null,
    }));
    void hideSplashSafe('error_boundary');
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#F7F8FA',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#0F172A', marginBottom: 12 }}>
          App failed to start
        </Text>
        <Text
          style={{ fontSize: 14, color: '#475569', textAlign: 'center', marginBottom: 24 }}
          numberOfLines={4}
        >
          {this.state.errorMessage ?? 'An unexpected error occurred during startup.'}
        </Text>
        <Pressable
          onPress={this.handleReset}
          style={{
            backgroundColor: '#0F172A',
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '500' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }
}
