'use client';

import { useState, useEffect } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { usePetStore } from '@/store/usePetStore';
import PixelButton from '@/components/ui/PixelButton';
import * as treadApi from '@/clients/treadApi';
import { stopEngine } from '@/engine/scheduler/loopScheduler';

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const config = useConfigStore();
  const petName = usePetStore((s) => s.name);

  const [treadKey, setTreadKey] = useState(config.treadfi_api_key);
  const [claudeKey, setClaudeKey] = useState(config.anthropic_api_key);
  const [name, setName] = useState(petName);
  const [status, setStatus] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const handleSave = async () => {
    if (treadKey !== config.treadfi_api_key) {
      localStorage.setItem('treadfi_api_key', treadKey);
      const valid = await treadApi.validateToken();
      if (!valid) {
        setStatus('Invalid Tread API key');
        return;
      }
      config.setApiKey(treadKey);
    }
    if (claudeKey !== config.anthropic_api_key) config.setAnthropicKey(claudeKey);
    if (name !== petName) usePetStore.getState().setSpeechBubble(`Call me ${name}!`, 3000);

    setStatus('Saved!');
    setTimeout(() => setStatus(''), 2000);
  };

  const handleRefreshAccounts = async () => {
    setRefreshing(true);
    const accounts = await treadApi.getAccounts();
    // Preserve enabled state for existing accounts
    const existing = new Map(config.accounts.map((a) => [a.name, a.enabled]));
    const merged = accounts.map((a) => ({
      ...a,
      enabled: existing.has(a.name) ? existing.get(a.name)! : true,
    }));
    config.setAccounts(merged);
    setRefreshing(false);
    setStatus(`Found ${merged.length} accounts`);
    setTimeout(() => setStatus(''), 2000);
  };

  const handleEmergencyStop = () => {
    stopEngine();
    treadApi.getActiveMmBots().then((bots) => {
      bots.forEach((bot) => {
        const id = String(bot.id || '');
        if (id) treadApi.pauseMultiOrder(id);
      });
    });
    setStatus('Emergency stop — all bots paused');
  };

  return (
    <div className="min-h-screen bg-pixel-bg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs text-pixel-accent">CONFIG</h2>
        <PixelButton onClick={onClose} variant="ghost">Back</PixelButton>
      </div>

      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        <div>
          <label className="text-[8px] opacity-70 block mb-1">Pet Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-pixel-dark border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
          />
        </div>

        <div>
          <label className="text-[8px] opacity-70 block mb-1">Tread API Key</label>
          <input
            type="password"
            value={treadKey}
            onChange={(e) => setTreadKey(e.target.value)}
            className="w-full bg-pixel-dark border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
          />
        </div>

        <div>
          <label className="text-[8px] opacity-70 block mb-1">Anthropic API Key</label>
          <input
            type="password"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            className="w-full bg-pixel-dark border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
          />
        </div>

        {/* Accounts */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[8px] opacity-70">Exchange Accounts</label>
            <button
              onClick={handleRefreshAccounts}
              disabled={refreshing}
              className="text-[7px] text-pixel-blue hover:text-pixel-accent transition-colors"
            >
              {refreshing ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          {config.accounts.length === 0 ? (
            <p className="text-[7px] opacity-30 text-center py-2">
              No accounts loaded. Click Refresh to fetch from Tread.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {config.accounts.map((account) => (
                <button
                  key={account.name}
                  onClick={() => config.toggleAccount(account.name)}
                  className={`flex items-center justify-between px-2 py-1.5 rounded text-[8px] border transition-colors ${
                    account.enabled
                      ? 'border-pixel-green/50 bg-pixel-green/5'
                      : 'border-white/10 bg-pixel-dark/50 opacity-40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={account.enabled ? 'text-pixel-green' : 'text-white/30'}>
                      {account.enabled ? 'ON' : 'OFF'}
                    </span>
                    <span>{account.name}</span>
                  </div>
                  <span className="opacity-50">{account.exchange}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {status && (
          <p className={`text-[8px] text-center ${status.includes('Invalid') || status.includes('Emergency') ? 'text-pixel-red' : 'text-pixel-green'}`}>
            {status}
          </p>
        )}

        <PixelButton onClick={handleSave}>Save</PixelButton>

        <div className="mt-4 pt-4 border-t border-white/10">
          <PixelButton onClick={handleEmergencyStop} variant="danger" className="w-full">
            EMERGENCY STOP
          </PixelButton>
          <p className="text-[7px] opacity-30 text-center mt-1">
            Pauses all bots and stops the engine
          </p>
        </div>
      </div>
    </div>
  );
}
