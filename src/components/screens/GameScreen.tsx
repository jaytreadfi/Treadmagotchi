'use client';

import { useState } from 'react';
import PetCanvas from '@/components/pet/PetCanvas';
import StatusBar from '@/components/ui/StatusBar';
import StatBars from '@/components/ui/StatBars';
import EvolutionProgress from '@/components/ui/EvolutionProgress';
import ModeToggle from '@/components/ui/ModeToggle';
import ActionButtons from '@/components/ui/ActionButtons';
import ActiveBots from '@/components/trading/ActiveBots';
import DecisionCountdown from '@/components/trading/DecisionCountdown';
import PnLDisplay from '@/components/trading/PnLDisplay';
import SettingsPanel from '@/components/screens/SettingsPanel';
import StatsScreen from '@/components/screens/StatsScreen';
import ReconnectBanner from '@/components/ui/ReconnectBanner';

type Overlay = 'none' | 'stats' | 'config';

interface GameScreenProps {
  connected: boolean;
  clockOffset: number;
}

export default function GameScreen({ connected, clockOffset }: GameScreenProps) {
  const [overlay, setOverlay] = useState<Overlay>('none');

  if (overlay === 'config') {
    return <SettingsPanel onClose={() => setOverlay('none')} />;
  }

  if (overlay === 'stats') {
    return <StatsScreen onClose={() => setOverlay('none')} />;
  }

  return (
    <div className="min-h-screen bg-pixel-bg flex flex-col">
      {!connected && <ReconnectBanner />}
      <StatusBar />
      <DecisionCountdown clockOffset={clockOffset} />

      {/* Main pet area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-4">
        <PetCanvas />
        <StatBars />
        <EvolutionProgress />
      </div>

      {/* Trading info */}
      <div className="px-4 py-2">
        <PnLDisplay />
        <div className="mt-2">
          <ActiveBots />
        </div>
      </div>

      {/* Controls */}
      <div className="py-3 border-t border-white/10">
        <div className="flex justify-center mb-2">
          <ModeToggle />
        </div>
        <ActionButtons
          onStatsClick={() => setOverlay('stats')}
          onConfigClick={() => setOverlay('config')}
        />
      </div>
    </div>
  );
}
