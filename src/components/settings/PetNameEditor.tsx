'use client';

import { useState } from 'react';
import { usePetStore } from '@/store/usePetStore';
import PixelButton from '@/components/ui/PixelButton';

interface PetNameEditorProps {
  onStatus: (msg: string) => void;
}

export default function PetNameEditor({ onStatus }: PetNameEditorProps) {
  const petName = usePetStore((s) => s.name);
  const [name, setName] = useState(petName);

  const handleSave = async () => {
    if (name === petName) return;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pet_name: name }),
      });
      if (res.ok) {
        usePetStore.getState().setSpeechBubble(`Call me ${name}!`, 3000);
        onStatus('Name saved');
      } else {
        onStatus('Failed to save name');
      }
    } catch {
      onStatus('Network error');
    }
  };

  return (
    <div>
      <label className="text-[10px] text-gold-dim/60 uppercase block mb-1">Pet Name</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 bg-surface border border-gold-dim/30 px-3 py-2 text-[12px] font-pixel text-white focus:border-gold outline-none"
        />
        {name !== petName && (
          <PixelButton onClick={handleSave} variant="ghost">Save</PixelButton>
        )}
      </div>
    </div>
  );
}
