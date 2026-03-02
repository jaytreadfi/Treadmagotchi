'use client';

import { useState, useRef, useEffect } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { usePetStore } from '@/store/usePetStore';
import PixelButton from '@/components/ui/PixelButton';
import type { TreadAccount } from '@/lib/types';

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const config = useConfigStore();
  const petName = usePetStore((s) => s.name);

  const [name, setName] = useState(petName);
  const [newTreadKey, setNewTreadKey] = useState('');
  const [newClaudeKey, setNewClaudeKey] = useState('');
  const [showTreadReplace, setShowTreadReplace] = useState(false);
  const [showClaudeReplace, setShowClaudeReplace] = useState(false);
  const [status, setStatus] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [emergencyStopping, setEmergencyStopping] = useState(false);
  const [togglingAccount, setTogglingAccount] = useState<string | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const showStatus = (msg: string, durationMs = 3000) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus(msg);
    if (durationMs > 0) {
      statusTimerRef.current = setTimeout(() => setStatus(''), durationMs);
    }
  };

  const handleReplaceTreadKey = async () => {
    if (!newTreadKey.trim()) return;
    try {
      const res = await fetch('/api/config/keys', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treadfi_api_key: newTreadKey.trim() }),
      });
      if (!res.ok) {
        showStatus('Failed to update Tread key');
        return;
      }
      setNewTreadKey('');
      setShowTreadReplace(false);
      showStatus('Tread key updated');
    } catch {
      showStatus('Network error');
    }
  };

  const handleReplaceClaudeKey = async () => {
    if (!newClaudeKey.trim()) return;
    try {
      const res = await fetch('/api/config/keys', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropic_api_key: newClaudeKey.trim() }),
      });
      if (!res.ok) {
        showStatus('Failed to update Anthropic key');
        return;
      }
      setNewClaudeKey('');
      setShowClaudeReplace(false);
      showStatus('Anthropic key updated');
    } catch {
      showStatus('Network error');
    }
  };

  const handleSaveName = async () => {
    if (name === petName) return;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pet_name: name }),
      });
      if (res.ok) {
        usePetStore.getState().setSpeechBubble(`Call me ${name}!`, 3000);
        showStatus('Name saved');
      } else {
        showStatus('Failed to save name');
      }
    } catch {
      showStatus('Network error');
    }
  };

  const handleRefreshAccounts = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/config/accounts/refresh', {
        method: 'POST',

      });
      if (res.ok) {
        const data = await res.json();
        const accounts: TreadAccount[] = data.accounts || [];
        // SSE will hydrate the store, but also update locally for immediate feedback
        useConfigStore.getState().setAccounts(accounts);
        showStatus(`Found ${accounts.length} accounts`);
      } else {
        showStatus('Failed to refresh accounts');
      }
    } catch {
      showStatus('Network error');
    }
    setRefreshing(false);
  };

  const handleToggleAccount = async (accountName: string) => {
    setTogglingAccount(accountName);
    // Optimistic update
    const prevAccounts = [...config.accounts];
    config.toggleAccount(accountName);

    // Read the toggled state from the store (config is stale after toggle)
    const updatedAccounts = useConfigStore.getState().accounts;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: updatedAccounts }),
      });
      if (!res.ok) {
        // Rollback
        useConfigStore.getState().setAccounts(prevAccounts);
        showStatus('Failed to toggle account');
      }
    } catch {
      // Rollback
      useConfigStore.getState().setAccounts(prevAccounts);
      showStatus('Network error');
    }
    setTogglingAccount(null);
  };

  const handleStopEngine = async () => {
    setStopping(true);
    try {
      const res = await fetch('/api/engine/stop', {
        method: 'POST',

      });
      if (res.ok) {
        showStatus('Engine stopped');
      } else {
        showStatus('Failed to stop engine');
      }
    } catch {
      showStatus('Network error');
    }
    setStopping(false);
  };

  const handleEmergencyStop = async () => {
    setEmergencyStopping(true);
    try {
      const res = await fetch('/api/engine/emergency-stop', {
        method: 'POST',

      });
      if (res.ok) {
        showStatus('Emergency stop -- all bots paused', 0);
      } else {
        showStatus('Emergency stop failed -- check manually!', 0);
      }
    } catch {
      showStatus('Network error -- check bot status manually!', 0);
    }
    setEmergencyStopping(false);
  };

  return (
    <div className="min-h-screen bg-pixel-bg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs text-pixel-accent">CONFIG</h2>
        <PixelButton onClick={onClose} variant="ghost">Back</PixelButton>
      </div>

      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {/* Pet name */}
        <div>
          <label className="text-[8px] opacity-70 block mb-1">Pet Name</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 bg-pixel-dark border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
            />
            {name !== petName && (
              <PixelButton onClick={handleSaveName} variant="ghost">Save</PixelButton>
            )}
          </div>
        </div>

        {/* Tread API key */}
        <div>
          <label className="text-[8px] opacity-70 block mb-1">Tread API Key</label>
          <div className="flex items-center gap-2">
            <span className={`text-[8px] ${config.treadfi_api_key_configured ? 'text-pixel-green' : 'text-pixel-red'}`}>
              {config.treadfi_api_key_configured ? 'Configured' : 'Not set'}
            </span>
            <button
              onClick={() => setShowTreadReplace(!showTreadReplace)}
              className="text-[7px] text-pixel-blue hover:text-pixel-accent transition-colors"
            >
              {showTreadReplace ? 'Cancel' : 'Replace Key'}
            </button>
          </div>
          {showTreadReplace && (
            <div className="flex gap-2 mt-1">
              <input
                type="password"
                value={newTreadKey}
                onChange={(e) => setNewTreadKey(e.target.value)}
                className="flex-1 bg-pixel-dark border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
                placeholder="Token xxxxxxxx"
              />
              <PixelButton onClick={handleReplaceTreadKey} variant="ghost">Save</PixelButton>
            </div>
          )}
        </div>

        {/* Anthropic API key */}
        <div>
          <label className="text-[8px] opacity-70 block mb-1">Anthropic API Key</label>
          <div className="flex items-center gap-2">
            <span className={`text-[8px] ${config.anthropic_api_key_configured ? 'text-pixel-green' : 'text-pixel-yellow'}`}>
              {config.anthropic_api_key_configured ? 'Configured' : 'Not set (rule-based)'}
            </span>
            <button
              onClick={() => setShowClaudeReplace(!showClaudeReplace)}
              className="text-[7px] text-pixel-blue hover:text-pixel-accent transition-colors"
            >
              {showClaudeReplace ? 'Cancel' : 'Replace Key'}
            </button>
          </div>
          {showClaudeReplace && (
            <div className="flex gap-2 mt-1">
              <input
                type="password"
                value={newClaudeKey}
                onChange={(e) => setNewClaudeKey(e.target.value)}
                className="flex-1 bg-pixel-dark border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
                placeholder="sk-ant-..."
              />
              <PixelButton onClick={handleReplaceClaudeKey} variant="ghost">Save</PixelButton>
            </div>
          )}
        </div>

        {/* Accounts */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[8px] opacity-70">Exchange Accounts</label>
            <button
              onClick={handleRefreshAccounts}
              disabled={refreshing}
              className="text-[7px] text-pixel-blue hover:text-pixel-accent transition-colors disabled:opacity-30"
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
                  onClick={() => handleToggleAccount(account.name)}
                  disabled={togglingAccount === account.name}
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
          <p className={`text-[8px] text-center ${
            status.includes('Failed') || status.includes('Emergency') || status.includes('error')
              ? 'text-pixel-red'
              : 'text-pixel-green'
          }`}>
            {status}
          </p>
        )}

        {/* Engine controls */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-2">
          <PixelButton onClick={handleStopEngine} variant="ghost" disabled={stopping} className="w-full">
            {stopping ? 'Stopping...' : 'Stop Engine'}
          </PixelButton>
          <PixelButton onClick={handleEmergencyStop} variant="danger" disabled={emergencyStopping} className="w-full">
            {emergencyStopping ? 'STOPPING...' : 'EMERGENCY STOP'}
          </PixelButton>
          <p className="text-[7px] opacity-30 text-center mt-1">
            Emergency stop pauses all bots and stops the engine
          </p>
        </div>
      </div>
    </div>
  );
}
