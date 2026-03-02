'use client';

import PixelButton from '@/components/ui/PixelButton';

interface ErrorScreenProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-pixel-bg gap-6 p-4">
      <div className="text-pixel-red text-xs">ERROR</div>
      <div className="w-full max-w-sm bg-pixel-dark border-2 border-pixel-red/50 rounded-lg p-6">
        <p className="text-[9px] text-center opacity-70 mb-4 break-words">
          {message}
        </p>
        {onRetry && (
          <PixelButton onClick={onRetry} variant="danger">
            Retry
          </PixelButton>
        )}
      </div>
    </div>
  );
}
