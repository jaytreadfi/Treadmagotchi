'use client';

import { useEffect, useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { useSSE } from '@/hooks/useSSE';
import SetupScreen from '@/components/screens/SetupScreen';
import GameScreen from '@/components/screens/GameScreen';
import LoadingScreen from '@/components/screens/LoadingScreen';
import ErrorScreen from '@/components/screens/ErrorScreen';
import MigrationBanner, {
  hasLegacyIndexedDBData,
  serverHasNoTrades,
} from '@/components/screens/MigrationBanner';

export default function Home() {
  const sse = useSSE();
  const onboarded = useConfigStore((s) => s.onboarded);

  // Migration detection state
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [migrationChecked, setMigrationChecked] = useState(false);

  // Check whether we should show the migration banner once the user is
  // onboarded and SSE is connected (i.e. server is ready).
  useEffect(() => {
    if (!onboarded || sse.loading || sse.error) return;
    if (migrationChecked) return;

    // If the user already dismissed the banner this session, skip.
    if (sessionStorage.getItem('migration-dismissed') === '1') {
      setMigrationChecked(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [hasLocal, serverEmpty] = await Promise.all([
          hasLegacyIndexedDBData(),
          serverHasNoTrades(),
        ]);
        if (!cancelled) {
          setMigrationNeeded(hasLocal && serverEmpty);
          setMigrationChecked(true);
        }
      } catch {
        if (!cancelled) {
          setMigrationChecked(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onboarded, sse.loading, sse.error, migrationChecked]);

  // Tri-state loading gate
  if (sse.loading) {
    return <LoadingScreen />;
  }

  // Connection errors -- show error screen with retry
  if (sse.error) {
    return (
      <ErrorScreen
        message={sse.error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!onboarded) {
    return <SetupScreen />;
  }

  // Show migration banner above the game screen when needed
  return (
    <>
      {migrationNeeded && migrationChecked && (
        <MigrationBanner
          onComplete={() => {
            setMigrationNeeded(false);
            // Force a full reload so the game picks up migrated server data
            window.location.reload();
          }}
        />
      )}
      <GameScreen connected={sse.connected} clockOffset={sse.clockOffset} />
    </>
  );
}
