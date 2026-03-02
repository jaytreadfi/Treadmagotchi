/**
 * SSE streaming route -- GET /api/events
 *
 * Validates the host header (DNS rebinding protection), then opens an
 * infinite ReadableStream that forwards all SSEEmitter events as
 * standard SSE text frames.
 *
 * Includes a 30-second heartbeat to keep the connection alive and
 * allow clients to distinguish "no data" from "disconnected".
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { validateHost } from '@/server/middleware/auth';
import { sseEmitter, type SSEEvent } from '@/server/engine/sseEmitter';

const HEARTBEAT_INTERVAL_MS = 30_000;
const RETRY_MS = 3_000;

export async function GET(request: Request): Promise<Response> {
  // Host validation
  if (!validateHost(request)) {
    return new Response(JSON.stringify({ error: 'Forbidden: invalid host' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  // Shared cleanup references -- populated in start(), invoked in cancel()
  let unsubscribe: (() => void) | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  function cleanup(): void {
    if (closed) return;
    closed = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (heartbeatId !== null) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      // Helper to write a well-formed SSE frame
      function send(eventType: string, data: string): void {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventType}\ndata: ${data}\n\n`),
          );
        } catch {
          // Controller already closed -- trigger cleanup
          cleanup();
        }
      }

      // Send retry directive as the very first frame
      try {
        controller.enqueue(encoder.encode(`retry: ${RETRY_MS}\n\n`));
      } catch {
        cleanup();
        return;
      }

      // Subscribe to SSE emitter
      unsubscribe = sseEmitter.subscribe((event: SSEEvent) => {
        send(event.type, JSON.stringify({
          data: event.data,
          seq: event.seq,
          server_epoch: event.server_epoch,
        }));
      });

      // 30s heartbeat keeps the connection alive through proxies/load balancers
      heartbeatId = setInterval(() => {
        send('ping', JSON.stringify({}));
      }, HEARTBEAT_INTERVAL_MS);
    },

    cancel() {
      // Called when the client disconnects or the stream is cancelled
      cleanup();
    },
  });

  // Safety net: also clean up if the request is aborted (e.g. Next.js
  // terminates the handler). This handles edge cases where cancel()
  // is not called (TCP reset, laptop lid close).
  request.signal.addEventListener('abort', cleanup, { once: true });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
