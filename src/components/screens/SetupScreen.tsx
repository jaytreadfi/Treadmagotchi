'use client';

import { useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import * as treadApi from '@/clients/treadApi';
import PixelButton from '@/components/ui/PixelButton';
import type { TreadAccount } from '@/lib/types';

export default function SetupScreen() {
  const config = useConfigStore();

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

    localStorage.setItem('treadfi_api_key', treadKey);

    const valid = await treadApi.validateToken();
    if (!valid) {
      setStatus('Invalid Tread API key — check and try again');
      localStorage.removeItem('treadfi_api_key');
      setValidating(false);
      return;
    }

    // Fetch accounts
    setStatus('Fetching accounts...');
    const fetched = await treadApi.getAccounts();
    setAccounts(fetched);
    setValidating(false);
    setStatus(`Found ${fetched.length} accounts`);
    setStep('accounts');
  };

  const toggleAccount = (name: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.name === name ? { ...a, enabled: !a.enabled } : a)),
    );
  };

  const handleFinish = () => {
    const enabledAccounts = accounts.filter((a) => a.enabled);
    if (!enabledAccounts.length) {
      setStatus('Enable at least one account');
      return;
    }

    config.setApiKey(treadKey);
    if (claudeKey) config.setAnthropicKey(claudeKey);
    config.setPetName(petName || 'Tready');
    config.setAccounts(accounts);
    config.setOnboarded(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-pixel-bg p-4">
      <div className="w-full max-w-sm bg-pixel-dark border-2 border-pixel-accent rounded-lg p-6">
        <h1 className="text-pixel-accent text-center text-xs mb-6">
          TREADMAGOTCHI
        </h1>
        <p className="text-[8px] text-center opacity-50 mb-6">
          Your pixel pet that trades for you
        </p>

        {step === 'keys' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[8px] opacity-70 block mb-1">Pet Name</label>
              <input
                type="text"
                value={petName}
                onChange={(e) => setPetName(e.target.value)}
                className="w-full bg-pixel-bg border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
                placeholder="Tready"
              />
            </div>

            <div>
              <label className="text-[8px] opacity-70 block mb-1">
                Tread API Key <span className="text-pixel-red">*</span>
              </label>
              <input
                type="password"
                value={treadKey}
                onChange={(e) => setTreadKey(e.target.value)}
                className="w-full bg-pixel-bg border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
                placeholder="Token xxxxxxxx"
              />
            </div>

            <div>
              <label className="text-[8px] opacity-70 block mb-1">
                Anthropic API Key <span className="opacity-30">(optional)</span>
              </label>
              <input
                type="password"
                value={claudeKey}
                onChange={(e) => setClaudeKey(e.target.value)}
                className="w-full bg-pixel-bg border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
                placeholder="sk-ant-..."
              />
              <p className="text-[7px] opacity-30 mt-1">
                Without this, uses rule-based decisions instead of AI
              </p>
            </div>

            {status && (
              <p className={`text-[8px] text-center ${status.includes('Invalid') ? 'text-pixel-red' : 'text-pixel-yellow'}`}>
                {status}
              </p>
            )}

            <PixelButton onClick={handleValidateKey} disabled={validating}>
              {validating ? 'Checking...' : 'Next'}
            </PixelButton>
          </div>
        )}

        {step === 'accounts' && (
          <div className="flex flex-col gap-4">
            <p className="text-[8px] opacity-70 text-center">
              Select which accounts the bot can trade on
            </p>

            <div className="flex flex-col gap-1">
              {accounts.map((account) => (
                <button
                  key={account.name}
                  onClick={() => toggleAccount(account.name)}
                  className={`flex items-center justify-between px-2 py-2 rounded text-[8px] border transition-colors ${
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

            {status && (
              <p className={`text-[8px] text-center ${status.includes('Enable') ? 'text-pixel-red' : 'text-pixel-green'}`}>
                {status}
              </p>
            )}

            <div className="flex gap-2">
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
