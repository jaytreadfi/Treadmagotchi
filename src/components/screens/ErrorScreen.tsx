'use client';

import PixelButton from '@/components/ui/PixelButton';

interface ErrorScreenProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-void gap-6 p-4">
      <div className="text-hp text-sm font-pixel">ERROR</div>
      <div className="w-full max-w-sm rpg-frame p-6">
        <p className="text-[12px] text-center text-white/70 mb-5 break-words font-pixel">
          {message}
        </p>
        {onRetry && (
          <div className="flex justify-center">
            <PixelButton onClick={onRetry} variant="danger">
              Retry
            </PixelButton>
          </div>
        )}
      </div>
    </div>
  );
}
