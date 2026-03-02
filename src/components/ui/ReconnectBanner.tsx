'use client';

export default function ReconnectBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-pixel-red/90 text-white text-[8px] text-center py-1.5 animate-pulse">
      Connection lost. Reconnecting...
    </div>
  );
}
