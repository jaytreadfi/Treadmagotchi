'use client';

import { useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import type { TreadAccount } from '@/lib/types';

interface AccountListProps {
  onStatus: (msg: string) => void;
}

export default function AccountList({ onStatus }: AccountListProps) {
  const accounts = useConfigStore((s) => s.accounts);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/config/accounts/refresh', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const fetched: TreadAccount[] = data.accounts || [];
        useConfigStore.getState().setAccounts(fetched);
        onStatus(`Found ${fetched.length} accounts`);
      } else {
        onStatus('Failed to refresh');
      }
    } catch {
      onStatus('Network error');
    }
    setRefreshing(false);
  };

  const handleToggle = async (accountName: string) => {
    setToggling(accountName);
    const prev = [...accounts];
    useConfigStore.getState().toggleAccount(accountName);
    const updated = useConfigStore.getState().accounts;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: updated }),
      });
      if (!res.ok) {
        useConfigStore.getState().setAccounts(prev);
        onStatus('Failed to toggle');
      }
    } catch {
      useConfigStore.getState().setAccounts(prev);
      onStatus('Network error');
    }
    setToggling(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] text-gold-dim/60 uppercase">Accounts</label>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[11px] text-energy hover:text-gold transition-colors disabled:opacity-30 cursor-pointer"
        >
          {refreshing ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {accounts.length === 0 ? (
        <p className="text-[11px] text-white/20 text-center py-3">No accounts</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {accounts.map((account) => (
            <button
              key={account.name}
              onClick={() => handleToggle(account.name)}
              disabled={toggling === account.name}
              className={`flex items-center justify-between px-3 py-2 text-[11px] font-pixel border transition-colors cursor-pointer ${
                account.enabled
                  ? 'border-joy/40 bg-joy/5'
                  : 'border-white/10 bg-surface/50 opacity-40'
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
      )}
    </div>
  );
}
