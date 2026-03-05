'use client';

interface PixelButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
}

export default function PixelButton({
  onClick,
  children,
  variant = 'primary',
  disabled = false,
  className = '',
}: PixelButtonProps) {
  const base =
    'px-5 py-3 text-sm font-pixel border-2 transition-all cursor-pointer ' +
    'disabled:opacity-30 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none ' +
    'active:translate-y-[4px] active:shadow-none';

  const variants = {
    primary:
      'border-gold-dim text-gold bg-panel shadow-[0_4px_0_theme(colors.gold-dim)] ' +
      'hover:bg-raised hover:border-gold',
    danger:
      'border-hp text-hp bg-panel shadow-[0_4px_0_theme(colors.hp)] ' +
      'hover:bg-hp/10',
    ghost:
      'border-white/20 text-white/70 bg-transparent shadow-[0_4px_0_rgba(255,255,255,0.1)] ' +
      'hover:border-white/40 hover:text-white/90',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
