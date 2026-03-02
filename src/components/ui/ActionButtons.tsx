'use client';

import { useState, useEffect, useCallback } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { usePetStore } from '@/store/usePetStore';
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
  const [reviving, setReviving] = useState(false);
  const [petCooldownLeft, setPetCooldownLeft] = useState(0);
  const [lastPetTime, setLastPetTime] = useState(0);

  useEffect(() => {
    if (lastPetTime === 0) return;
    const tick = () => {
      const remaining = Math.max(0, PET_COOLDOWN_MS - (Date.now() - lastPetTime));
      setPetCooldownLeft(remaining);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lastPetTime]);

  const petOnCooldown = petCooldownLeft > 0;

  const handleFeed = async () => {
    if (feeding) return;
    setFeeding(true);
    try {
      const res = await fetch('/api/pet/feed', {
        method: 'POST',

      });
      if (res.ok) {
        // Server will update pet state via SSE
      }
    } catch {
      // Non-fatal -- SSE will sync state
    }
    setFeeding(false);
  };

  const handlePet = useCallback(async () => {
    if (petOnCooldown) return;
    setLastPetTime(Date.now());
    try {
      await fetch('/api/pet/interact', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pet' }),
      });
      // Server will update pet state via SSE
    } catch {
      // Non-fatal
    }
  }, [petOnCooldown]);

  const handleRevive = async () => {
    if (reviving) return;
    setReviving(true);
    try {
      await fetch('/api/pet/revive', {
        method: 'POST',

      });
      // Server will update pet state via SSE
    } catch {
      // Non-fatal
    }
    setReviving(false);
  };

  if (!isAlive) {
    return (
      <div className="flex justify-center gap-2 px-4">
        <PixelButton onClick={handleRevive} variant="danger" disabled={reviving}>
          {reviving ? '...' : 'Revive'}
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
      <PixelButton onClick={handlePet} variant="ghost" disabled={petOnCooldown}>
        {petOnCooldown ? `Pet ${Math.ceil(petCooldownLeft / 1000)}s` : 'Pet'}
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
