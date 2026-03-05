'use client';

export default function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-void gap-6">
      <div className="text-gold text-sm animate-pulse font-pixel">
        TREADMAGOTCHI
      </div>
      <div className="flex gap-2">
        <span className="w-3 h-3 bg-gold rounded-sm animate-bounce [animation-delay:0ms]" />
        <span className="w-3 h-3 bg-gold rounded-sm animate-bounce [animation-delay:150ms]" />
        <span className="w-3 h-3 bg-gold rounded-sm animate-bounce [animation-delay:300ms]" />
      </div>
      <p className="text-[11px] text-white/30 font-pixel">Connecting to server...</p>
    </div>
  );
}
