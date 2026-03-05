'use client';

import { useState } from 'react';
import PixelButton from '@/components/ui/PixelButton';

interface EngineControlsProps {
  onStatus: (msg: string) => void;
}

export default function EngineControls({ onStatus }: EngineControlsProps) {
  const [stopping, setStopping] = useState(false);
  const [emergency, setEmergency] = useState(false);

  const handleStop = async () => {
    setStopping(true);
    try {
      const res = await fetch('/api/engine/stop', { method: 'POST' });
      onStatus(res.ok ? 'Engine stopped' : 'Failed to stop');
    } catch {
      onStatus('Network error');
    }
    setStopping(false);
  };

  const handleEmergency = async () => {
    setEmergency(true);
    try {
      const res = await fetch('/api/engine/emergency-stop', { method: 'POST' });
      onStatus(res.ok ? 'Emergency stop -- all bots paused' : 'Emergency stop failed!');
    } catch {
      onStatus('Network error -- check bots manually!');
    }
    setEmergency(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <PixelButton onClick={handleStop} variant="ghost" disabled={stopping} className="w-full">
        {stopping ? 'Stopping...' : 'Stop Engine'}
      </PixelButton>
      <PixelButton onClick={handleEmergency} variant="danger" disabled={emergency} className="w-full">
        {emergency ? 'STOPPING...' : 'EMERGENCY STOP'}
      </PixelButton>
      <p className="text-[9px] text-white/20 text-center">
        Emergency stop pauses all bots and stops the engine
      </p>
    </div>
  );
}
