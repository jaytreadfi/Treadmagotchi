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
  const base = 'px-3 py-2 text-[8px] font-pixel border-2 transition-all active:translate-y-0.5 disabled:opacity-30 disabled:cursor-not-allowed';

  const variants = {
    primary: 'border-pixel-accent text-pixel-accent hover:bg-pixel-accent/10',
    danger: 'border-pixel-red text-pixel-red hover:bg-pixel-red/10',
    ghost: 'border-white/20 text-white/70 hover:border-white/40',
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
