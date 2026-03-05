'use client';

import { useState, useRef, useEffect } from 'react';
import SettingsSection from './SettingsSection';
import PetNameEditor from './PetNameEditor';
import ApiKeyManager from './ApiKeyManager';
import AccountList from './AccountList';
import EngineControls from './EngineControls';
import MapPicker from './MapPicker';

interface SettingsSidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsSidebar({ open, onClose }: SettingsSidebarProps) {
  const [status, setStatus] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showStatus = (msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus(msg);
    timerRef.current = setTimeout(() => setStatus(''), 3000);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 animate-fade-in"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-[360px] max-w-full bg-panel border-l border-gold-dim animate-slide-in-right overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm text-gold uppercase">Settings</h2>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white text-sm cursor-pointer w-8 h-8 flex items-center justify-center"
            >
              X
            </button>
          </div>

          {status && (
            <div className={`text-[11px] text-center py-2 mb-4 ${
              status.includes('Failed') || status.includes('error') || status.includes('failed')
                ? 'text-hp'
                : 'text-joy'
            }`}>
              {status}
            </div>
          )}

          <div className="flex flex-col">
            <SettingsSection title="Pet">
              <PetNameEditor onStatus={showStatus} />
            </SettingsSection>

            <SettingsSection title="Room">
              <MapPicker onStatus={showStatus} />
            </SettingsSection>

            <SettingsSection title="API Keys">
              <ApiKeyManager onStatus={showStatus} />
            </SettingsSection>

            <SettingsSection title="Accounts">
              <AccountList onStatus={showStatus} />
            </SettingsSection>

            <SettingsSection title="Engine">
              <EngineControls onStatus={showStatus} />
            </SettingsSection>
          </div>
        </div>
      </div>
    </>
  );
}
