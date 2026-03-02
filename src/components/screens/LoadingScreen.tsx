'use client';

export default function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-pixel-bg gap-6">
      <div className="text-pixel-accent text-xs animate-pulse">
        TREADMAGOTCHI
      </div>
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-pixel-accent rounded-sm animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-pixel-accent rounded-sm animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-pixel-accent rounded-sm animate-bounce [animation-delay:300ms]" />
      </div>
      <p className="text-[8px] opacity-40">Loading...</p>
    </div>
  );
}
