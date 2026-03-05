'use client';

import { useEffect, useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { useSSE } from '@/hooks/useSSE';
import SetupScreen from '@/components/setup/SetupScreen';
import AppShell from '@/components/shell/AppShell';
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

  useEffect(() => {
    if (!onboarded || sse.loading || sse.error) return;
    if (migrationChecked) return;

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

  if (sse.loading) {
    return <LoadingScreen />;
  }

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

  return (
    <>
      {migrationNeeded && migrationChecked && (
        <MigrationBanner
          onComplete={() => {
            setMigrationNeeded(false);
            window.location.reload();
          }}
        />
      )}
      <AppShell connected={sse.connected} clockOffset={sse.clockOffset} />
    </>
  );
}
