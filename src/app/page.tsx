'use client';

import { useConfigStore } from '@/store/useConfigStore';
import SetupScreen from '@/components/screens/SetupScreen';
import GameScreen from '@/components/screens/GameScreen';

export default function Home() {
  const onboarded = useConfigStore((s) => s.onboarded);

  if (!onboarded) {
    return <SetupScreen />;
  }

  return <GameScreen />;
}
