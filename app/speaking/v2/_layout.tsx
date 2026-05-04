import { Slot } from 'expo-router';
import React from 'react';

import { SpeakingV2RuntimeProvider } from '@/hooks/speaking/SpeakingV2RuntimeProvider';

export default function SpeakingV2Layout() {
  return (
    <SpeakingV2RuntimeProvider>
      <Slot />
    </SpeakingV2RuntimeProvider>
  );
}
