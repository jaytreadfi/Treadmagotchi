'use client';

import { useState, useEffect, useCallback } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { usePetStore } from '@/store/usePetStore';
import { triggerManualFeed } from '@/engine/scheduler/loopScheduler';
import { revivePet } from '@/engine/pet/petStateMachine';
import PixelButton from './PixelButton';

const PET_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

interface ActionButtonsProps {
  onStatsClick: () => void;
  onConfigClick: () => void;
}

export default function ActionButtons({ onStatsClick, onConfigClick }: ActionButtonsProps) {
  const mode = useConfigStore((s) => s.mode);
  const isAlive = usePetStore((s) => s.is_alive);
  const [feeding, setFeeding] = useState(false);

  const handleFeed = async () => {
    if (feeding) return;
    setFeeding(true);
    try {
      await triggerManualFeed();
      usePetStore.getState().setSpeechBubble('Yum!', 3000);
    } catch {
      usePetStore.getState().setSpeechBubble('Nothing good to eat!', 3000);
    }
    setFeeding(false);
  };

  const handlePet = () => {
    const pet = usePetStore.getState();
    pet.setVitals({ happiness: Math.min(100, pet.vitals.happiness + 5) });
    pet.setSpeechBubble('Thanks!', 3000);
  };

  const handleRevive = () => {
    revivePet();
  };

  if (!isAlive) {
    return (
      <div className="flex justify-center gap-2 px-4">
        <PixelButton onClick={handleRevive} variant="danger">
          Revive
        </PixelButton>
        <PixelButton onClick={onStatsClick} variant="ghost">
          Stats
        </PixelButton>
      </div>
    );
  }

  return (
    <div className="flex justify-center gap-2 px-4 flex-wrap">
      {mode === 'manual' && (
        <PixelButton onClick={handleFeed} disabled={feeding}>
          {feeding ? '...' : 'Feed'}
        </PixelButton>
      )}
      <PixelButton onClick={handlePet} variant="ghost">
        Pet
      </PixelButton>
      <PixelButton onClick={onStatsClick} variant="ghost">
        Stats
      </PixelButton>
      <PixelButton onClick={onConfigClick} variant="ghost">
        Config
      </PixelButton>
    </div>
  );
}
