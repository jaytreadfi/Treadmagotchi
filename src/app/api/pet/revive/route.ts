/**
 * POST /api/pet/revive
 *
 * Revive a dead pet. Resets vitals to full, sets is_alive=true,
 * and clears evolved_at. Only works if the pet is currently dead.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { getPetState, saveActivity } from '@/server/db/repository';
import { sseEmitter } from '@/server/engine/sseEmitter';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request: Request) => {
  try {
    const pet = getPetState();

    if (!pet) {
      return NextResponse.json(
        { error: 'Pet not initialized' },
        { status: 404 },
      );
    }

    if (pet.is_alive) {
      return NextResponse.json(
        { error: 'Pet is already alive' },
        { status: 400 },
      );
    }

    const { revivePet } = await import('@/server/engine/pet/petStateMachine');
    revivePet();

    saveActivity({
      timestamp: Date.now(),
      category: 'engine',
      action: 'revive',
      pair: null,
      detail: JSON.stringify({ revivedAt: Date.now() }),
    });

    // Emit SSE so dashboard updates immediately
    const updatedPet = getPetState();
    sseEmitter.emit('pet_updated', updatedPet);

    return NextResponse.json({
      success: true,
      pet: updatedPet,
    });
  } catch (err) {
    console.error('[api/pet/revive] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to revive pet' },
      { status: 500 },
    );
  }
});
