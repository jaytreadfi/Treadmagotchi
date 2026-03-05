'use client';

import { useState, useEffect, useCallback } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { usePetStore } from '@/store/usePetStore';
import PixelButton from '@/components/ui/PixelButton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

const PET_COOLDOWN_MS = 3 * 60 * 1000;

export default function ActionsPanel() {
  const mode = useConfigStore((s) => s.mode);
  const isAlive = usePetStore((s) => s.is_alive);

  const [feeding, setFeeding] = useState(false);
  const [reviving, setReviving] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [showRerollConfirm, setShowRerollConfirm] = useState(false);
  const [petCooldownLeft, setPetCooldownLeft] = useState(0);
  const [lastPetTime, setLastPetTime] = useState(0);
  const [modeLoading, setModeLoading] = useState(false);

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
    try { await fetch('/api/pet/feed', { method: 'POST' }); } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  }, [petOnCooldown]);

  const handleRevive = async () => {
    if (reviving) return;
    setReviving(true);
    try { await fetch('/api/pet/revive', { method: 'POST' }); } catch { /* ignore */ }
    setReviving(false);
  };

  const handleReroll = async () => {
    if (rerolling) return;
    setRerolling(true);
    setShowRerollConfirm(false);
    try { await fetch('/api/pet/reroll', { method: 'POST' }); } catch { /* ignore */ }
    setRerolling(false);
  };

  const handleModeToggle = async () => {
    if (modeLoading) return;
    const newMode = mode === 'auto' ? 'manual' : 'auto';
    const prevMode = mode;
    useConfigStore.getState().setMode(newMode);
    setModeLoading(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) useConfigStore.getState().setMode(prevMode);
    } catch {
      useConfigStore.getState().setMode(prevMode);
    }
    setModeLoading(false);
  };

  return (
    <div className="p-5 flex flex-col gap-5">
      <h3 className="text-sm text-gold uppercase">Actions</h3>

      {/* Mode toggle */}
      <button
        onClick={handleModeToggle}
        disabled={modeLoading}
        className={`w-full py-4 text-sm font-pixel border-2 transition-all cursor-pointer disabled:opacity-50 ${
          mode === 'auto'
            ? 'border-joy text-joy shadow-[0_4px_0_theme(colors.joy)] hover:bg-joy/10'
            : 'border-hunger text-hunger shadow-[0_4px_0_theme(colors.hunger)] hover:bg-hunger/10'
        } active:translate-y-[4px] active:shadow-none`}
      >
        {modeLoading ? '...' : mode === 'auto' ? 'AUTO MODE' : 'MANUAL MODE'}
      </button>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {!isAlive ? (
          <PixelButton onClick={handleRevive} variant="danger" disabled={reviving} className="flex-1">
            {reviving ? '...' : 'Revive'}
          </PixelButton>
        ) : (
          <>
            {mode === 'manual' && (
              <PixelButton onClick={handleFeed} disabled={feeding} className="flex-1">
                {feeding ? '...' : 'Feed'}
              </PixelButton>
            )}
            <PixelButton onClick={handlePet} variant="ghost" disabled={petOnCooldown} className="flex-1">
              {petOnCooldown ? `Pet ${Math.ceil(petCooldownLeft / 1000)}s` : 'Pet'}
            </PixelButton>
            <PixelButton
              onClick={() => setShowRerollConfirm(true)}
              variant="ghost"
              disabled={rerolling || showRerollConfirm}
              className="flex-1"
            >
              {rerolling ? '...' : 'Reroll'}
            </PixelButton>
          </>
        )}
      </div>

      <ConfirmDialog
        open={showRerollConfirm}
        message="Reroll your pet's appearance?"
        onConfirm={handleReroll}
        onCancel={() => setShowRerollConfirm(false)}
      />
    </div>
  );
}
