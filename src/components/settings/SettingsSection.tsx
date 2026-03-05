'use client';

import { useState } from 'react';

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function SettingsSection({ title, children, defaultOpen = true }: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gold-dim/20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 text-[11px] text-gold-dim uppercase cursor-pointer hover:text-gold transition-colors"
      >
        <span>{title}</span>
        <span className="text-[9px]">{open ? 'v' : '>'}</span>
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}
