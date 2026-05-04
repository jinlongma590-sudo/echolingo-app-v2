import React from 'react';

import { DevOnlyRoute } from '@/components/dev/DevOnlyRoute';
import { SpeakingV1UltraScreen } from '@/screens/SpeakingV1UltraScreen';

export default function SpeakingV1UltraRoute() {
  return (
    <DevOnlyRoute>
      <SpeakingV1UltraScreen />
    </DevOnlyRoute>
  );
}
