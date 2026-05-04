import React from 'react';
import { Animated } from 'react-native';

export function FocusSentenceOverlay({
  translateY,
  scale,
  children,
}: {
  translateY: Animated.Value;
  scale: Animated.Value;
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        zIndex: 4,
        transform: [{ translateY }, { scale }],
      }}
    >
      {children}
    </Animated.View>
  );
}
