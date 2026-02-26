'use client';

import { useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { validateToken } from '@/clients/treadApi';
import PixelButton from '@/components/ui/PixelButton';

export default function SetupScreen() {
  const setApiKey = useConfigStore((s) => s.setApiKey);
  const setAnthropicKey = useConfigStore((s) => s.setAnthropicKey);
  const setPetName = useConfigStore((s) => s.setPetName);
  const setOnboarded = useConfigStore((s) => s.setOnboarded);
  const setAccountName = useConfigStore((s) => s.setAccountName);

  const [treadKey, setTreadKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [petName, setPetNameLocal] = useState('Tready');
  const [accountName, setAccountNameLocal] = useState('Paradex');
  const [status, setStatus] = useState('');
  const [validating, setValidating] = useState(false);

  const handleSubmit = async () => {
    if (!treadKey) {
      setStatus('Tread API key is required');
      return;
    }

    setValidating(true);
    setStatus('Validating...');

    // Temporarily store key for validation
    localStorage.setItem('treadfi_api_key', treadKey);
    localStorage.setItem('treadfi_account_name', accountName);

    const valid = await validateToken();
    if (!valid) {
      setStatus('Invalid Tread API key — check and try again');
      localStorage.removeItem('treadfi_api_key');
      setValidating(false);
      return;
    }

    setApiKey(treadKey);
    if (claudeKey) setAnthropicKey(claudeKey);
    setPetName(petName || 'Tready');
    setAccountName(accountName || 'Paradex');
    setOnboarded(true);
    setValidating(false);
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

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-[8px] opacity-70 block mb-1">Pet Name</label>
            <input
              type="text"
              value={petName}
              onChange={(e) => setPetNameLocal(e.target.value)}
              className="w-full bg-pixel-bg border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
              placeholder="Tready"
            />
          </div>

          <div>
            <label className="text-[8px] opacity-70 block mb-1">Account Name</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountNameLocal(e.target.value)}
              className="w-full bg-pixel-bg border border-white/20 rounded px-2 py-1 text-[10px] focus:border-pixel-accent outline-none"
              placeholder="Paradex"
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

          <PixelButton onClick={handleSubmit} disabled={validating}>
            {validating ? 'Checking...' : 'Hatch My Pet!'}
          </PixelButton>
        </div>
      </div>
    </div>
  );
}
