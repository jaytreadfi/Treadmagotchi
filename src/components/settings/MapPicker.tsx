'use client';

import { useState } from 'react';
import { usePetStore } from '@/store/usePetStore';
import { MAPS } from '@/lib/maps';

interface MapPickerProps {
  onStatus: (msg: string) => void;
}

export default function MapPicker({ onStatus }: MapPickerProps) {
  const currentMapId = usePetStore((s) => s.map_id);
  const [loading, setLoading] = useState(false);

  const selectMap = async (mapId: string | null) => {
    if (mapId === currentMapId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/pet/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_id: mapId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed');
      }
      onStatus('Room updated');
    } catch (err) {
      onStatus(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {MAPS.map((map) => (
        <button
          key={map.id}
          onClick={() => selectMap(map.id)}
          disabled={loading}
          className={`relative rounded border overflow-hidden cursor-pointer h-16 transition-all ${
            currentMapId === map.id
              ? 'border-gold ring-1 ring-gold/50'
              : 'border-white/10 hover:border-white/30'
          }`}
        >
          <img
            src={map.src}
            alt={map.name}
            className="w-full h-full object-cover"
            style={{ imageRendering: 'pixelated' }}
          />
          <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] text-white/80 text-center py-0.5">
            {map.name}
          </span>
        </button>
      ))}
    </div>
  );
}
