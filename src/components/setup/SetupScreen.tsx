'use client';

import { useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import PixelButton from '@/components/ui/PixelButton';
import type { TreadAccount } from '@/lib/types';

export default function SetupScreen() {
  const [treadKey, setTreadKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [petName, setPetName] = useState('Tready');
  const [status, setStatus] = useState('');
  const [validating, setValidating] = useState(false);
  const [accounts, setAccounts] = useState<TreadAccount[]>([]);
  const [step, setStep] = useState<'keys' | 'accounts'>('keys');

  const handleValidateKey = async () => {
    if (!treadKey) {
      setStatus('Tread API key is required');
      return;
    }

    setValidating(true);
    setStatus('Validating...');

    try {
      const keysBody: Record<string, string> = { treadfi_api_key: treadKey };
      if (claudeKey) keysBody.anthropic_api_key = claudeKey;

      const keysRes = await fetch('/api/config/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keysBody),
      });

      if (!keysRes.ok) {
        setStatus('Failed to save keys');
        setValidating(false);
        return;
      }

      const valRes = await fetch('/api/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treadfi_api_key: treadKey }),
      });

      if (!valRes.ok) {
        setStatus('Invalid Tread API key -- check and try again');
        setValidating(false);
        return;
      }

      setStatus('Fetching accounts...');
      const accRes = await fetch('/api/config/accounts/refresh', {
        method: 'POST',
      });

      if (accRes.ok) {
        const accData = await accRes.json();
        const fetched: TreadAccount[] = accData.accounts || [];
        setAccounts(fetched);
        setStatus(`Found ${fetched.length} accounts`);
      } else {
        setStatus('Could not fetch accounts -- continue anyway');
      }

      setValidating(false);
      setStep('accounts');
    } catch {
      setStatus('Network error -- is the server running?');
      setValidating(false);
    }
  };

  const toggleAccount = (name: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.name === name ? { ...a, enabled: !a.enabled } : a)),
    );
  };

  const handleFinish = async () => {
    const enabledAccounts = accounts.filter((a) => a.enabled);
    if (!enabledAccounts.length) {
      setStatus('Enable at least one account');
      return;
    }

    setStatus('Setting up...');

    try {
      const res = await fetch('/api/config/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pet_name: petName || 'Tready',
          accounts,
          treadfi_api_key: treadKey,
          anthropic_api_key: claudeKey || '',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(data.error || 'Onboarding failed');
        return;
      }

      useConfigStore.getState().hydrate({ onboarded: true });
    } catch {
      setStatus('Network error -- is the server running?');
    }
  };

  const inputCls =
    'w-full bg-surface border border-gold-dim/30 px-3 py-2.5 text-[12px] font-pixel text-white focus:border-gold outline-none';

  return (
    <div className="min-h-screen flex items-center justify-center bg-void p-4">
      <div className="w-full max-w-md rpg-frame p-8">
        <h1 className="text-gold text-center text-sm mb-3">TREADMAGOTCHI</h1>
        <p className="text-[10px] text-center text-white/40 mb-8">
          Your pixel pet that trades for you
        </p>

        {step === 'keys' && (
          <div className="flex flex-col gap-5">
            <div>
              <label className="text-[10px] text-gold-dim uppercase block mb-1.5">Pet Name</label>
              <input
                type="text"
                value={petName}
                onChange={(e) => setPetName(e.target.value)}
                className={inputCls}
                placeholder="Tready"
              />
            </div>

            <div>
              <label className="text-[10px] text-gold-dim uppercase block mb-1.5">
                Tread API Key <span className="text-hp">*</span>
              </label>
              <input
                type="password"
                value={treadKey}
                onChange={(e) => setTreadKey(e.target.value)}
                className={inputCls}
                placeholder="Token xxxxxxxx"
              />
            </div>

            <div>
              <label className="text-[10px] text-gold-dim uppercase block mb-1.5">
                Anthropic API Key <span className="text-white/20">(optional)</span>
              </label>
              <input
                type="password"
                value={claudeKey}
                onChange={(e) => setClaudeKey(e.target.value)}
                className={inputCls}
                placeholder="sk-ant-..."
              />
              <p className="text-[9px] text-white/30 mt-1">
                Without this, uses rule-based decisions instead of AI
              </p>
            </div>

            {status && (
              <p className={`text-[11px] text-center ${
                status.includes('Invalid') || status.includes('error') ? 'text-hp' : 'text-hunger'
              }`}>
                {status}
              </p>
            )}

            <PixelButton onClick={handleValidateKey} disabled={validating}>
              {validating ? 'Checking...' : 'Next'}
            </PixelButton>
          </div>
        )}

        {step === 'accounts' && (
          <div className="flex flex-col gap-5">
            <p className="text-[11px] text-white/50 text-center">
              Select which accounts the bot can trade on
            </p>

            <div className="flex flex-col gap-1.5">
              {accounts.map((account) => (
                <button
                  key={account.name}
                  onClick={() => toggleAccount(account.name)}
                  className={`flex items-center justify-between px-3 py-2.5 text-[11px] font-pixel border transition-colors cursor-pointer ${
                    account.enabled
                      ? 'border-joy/50 bg-joy/5 text-white'
                      : 'border-white/10 bg-surface/50 text-white/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={account.enabled ? 'text-joy' : 'text-white/20'}>
                      {account.enabled ? 'ON' : 'OFF'}
                    </span>
                    <span>{account.name}</span>
                  </div>
                  <span className="text-white/30">{account.exchange}</span>
                </button>
              ))}
            </div>

            {status && (
              <p className={`text-[11px] text-center ${
                status.includes('Enable') ? 'text-hp' : 'text-joy'
              }`}>
                {status}
              </p>
            )}

            <div className="flex gap-3">
              <PixelButton onClick={() => setStep('keys')} variant="ghost">
                Back
              </PixelButton>
              <PixelButton onClick={handleFinish} className="flex-1">
                Hatch My Pet!
              </PixelButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
