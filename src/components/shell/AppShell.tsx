'use client';

import { useState } from 'react';
import HeaderBar from './HeaderBar';
import ReconnectBanner from './ReconnectBanner';
import PetEnvironment from '@/components/pet/PetEnvironment';
import ActionsPanel from '@/components/panels/ActionsPanel';
import StatsPanel from '@/components/panels/StatsPanel';
import TradeHistoryPanel from '@/components/panels/TradeHistoryPanel';
import SettingsSidebar from '@/components/settings/SettingsSidebar';

interface AppShellProps {
  connected: boolean;
  clockOffset: number;
}

export default function AppShell({ connected, clockOffset }: AppShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-void flex flex-col">
      {!connected && <ReconnectBanner />}
      <HeaderBar clockOffset={clockOffset} onGearClick={() => setSettingsOpen(true)} />

      {/* Pet hero area */}
      <PetEnvironment />

      {/* Actions + Stats side by side */}
      <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-[2px] bg-gold-dim/20 border-t-2 border-gold-dim/40">
        <div className="rpg-panel flex flex-col">
          <ActionsPanel />
        </div>
        <div className="rpg-panel flex flex-col">
          <StatsPanel />
        </div>
      </div>

      {/* Trade history - full width */}
      <div className="rpg-panel flex-1 min-h-0 border-t-2 border-gold-dim/40">
        <TradeHistoryPanel />
      </div>

      <SettingsSidebar
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
