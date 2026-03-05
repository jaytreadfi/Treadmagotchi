'use client';

import { useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import PixelButton from '@/components/ui/PixelButton';

interface ApiKeyManagerProps {
  onStatus: (msg: string) => void;
}

export default function ApiKeyManager({ onStatus }: ApiKeyManagerProps) {
  const treadConfigured = useConfigStore((s) => s.treadfi_api_key_configured);
  const claudeConfigured = useConfigStore((s) => s.anthropic_api_key_configured);

  const [showTread, setShowTread] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [newTreadKey, setNewTreadKey] = useState('');
  const [newClaudeKey, setNewClaudeKey] = useState('');

  const handleReplace = async (keyField: string, value: string, resetFn: () => void) => {
    if (!value.trim()) return;
    try {
      const res = await fetch('/api/config/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [keyField]: value.trim() }),
      });
      if (res.ok) {
        resetFn();
        onStatus(`${keyField === 'treadfi_api_key' ? 'Tread' : 'Anthropic'} key updated`);
      } else {
        onStatus('Failed to update key');
      }
    } catch {
      onStatus('Network error');
    }
  };

  const inputCls = 'flex-1 bg-surface border border-gold-dim/30 px-3 py-2 text-[12px] font-pixel text-white focus:border-gold outline-none';

  return (
    <div className="flex flex-col gap-4">
      {/* Tread API Key */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-gold-dim/60 uppercase">Tread API Key</label>
          <span className={`text-[10px] ${treadConfigured ? 'text-joy' : 'text-hp'}`}>
            {treadConfigured ? 'Set' : 'Missing'}
          </span>
        </div>
        {showTread ? (
          <div className="flex gap-2">
            <input
              type="password"
              value={newTreadKey}
              onChange={(e) => setNewTreadKey(e.target.value)}
              className={inputCls}
              placeholder="Token xxxxxxxx"
            />
            <PixelButton onClick={() => handleReplace('treadfi_api_key', newTreadKey, () => { setNewTreadKey(''); setShowTread(false); })} variant="ghost">
              Save
            </PixelButton>
            <button onClick={() => setShowTread(false)} className="text-[11px] text-white/30 hover:text-white cursor-pointer">X</button>
          </div>
        ) : (
          <button onClick={() => setShowTread(true)} className="text-[11px] text-energy hover:text-gold transition-colors cursor-pointer">
            Replace Key
          </button>
        )}
      </div>

      {/* Anthropic API Key */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-gold-dim/60 uppercase">Anthropic API Key</label>
          <span className={`text-[10px] ${claudeConfigured ? 'text-joy' : 'text-hunger'}`}>
            {claudeConfigured ? 'Set' : 'Rule-based'}
          </span>
        </div>
        {showClaude ? (
          <div className="flex gap-2">
            <input
              type="password"
              value={newClaudeKey}
              onChange={(e) => setNewClaudeKey(e.target.value)}
              className={inputCls}
              placeholder="sk-ant-..."
            />
            <PixelButton onClick={() => handleReplace('anthropic_api_key', newClaudeKey, () => { setNewClaudeKey(''); setShowClaude(false); })} variant="ghost">
              Save
            </PixelButton>
            <button onClick={() => setShowClaude(false)} className="text-[11px] text-white/30 hover:text-white cursor-pointer">X</button>
          </div>
        ) : (
          <button onClick={() => setShowClaude(true)} className="text-[11px] text-energy hover:text-gold transition-colors cursor-pointer">
            Replace Key
          </button>
        )}
      </div>
    </div>
  );
}
