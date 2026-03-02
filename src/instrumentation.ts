/**
 * Next.js instrumentation — boots the trading engine on server start.
 * Runs once per process start, NOT on HMR.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Guard against serverless
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      console.error('[Treadmagotchi] Requires a persistent process. Serverless is not supported.');
      return;
    }

    // Guard against PM2 cluster mode (duplicate engines = duplicate trades)
    if (Number(process.env.NODE_APP_INSTANCE) > 0) {
      console.error('[Treadmagotchi] FATAL: Cluster mode detected. instances MUST be 1.');
      process.exit(1);
    }

    const { engine } = await import('./server/engine/index');
    const { getConfig } = await import('./server/db/configStore');
    // Start engine if already onboarded
    if (getConfig('onboarded')) {
      try {
        await engine.start();
        console.log('[Treadmagotchi] Engine started successfully');
      } catch (err) {
        console.error('[Treadmagotchi] Engine failed to start:', err);
      }
    } else {
      console.log('[Treadmagotchi] Not yet onboarded — engine will start after setup');
    }

    // Process error handlers
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');

    process.on('unhandledRejection', (err) => {
      console.error('[FATAL] Unhandled rejection:', err);
      try {
        engine.saveStateAndDegrade();
      } catch (degradeErr) {
        console.error('[FATAL] saveStateAndDegrade failed:', degradeErr);
      }
    });

    process.on('uncaughtException', (err) => {
      console.error('[FATAL] Uncaught exception:', err);
      try {
        engine.saveStateAndDegrade();
      } catch (degradeErr) {
        console.error('[FATAL] saveStateAndDegrade failed:', degradeErr);
      }
    });

    // Graceful shutdown
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');

    const { closeDb } = await import('./server/db/index');

    const gracefulShutdown = async (signal: string) => {
      console.log(`[Shutdown] Received ${signal}`);
      engine.stop();
      const deadline = Date.now() + 10_000;
      while (engine.isLoopInProgress() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      closeDb();
      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }
}
