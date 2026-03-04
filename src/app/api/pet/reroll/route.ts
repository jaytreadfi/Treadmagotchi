/**
 * POST /api/pet/reroll
 *
 * Re-randomize the pet's appearance. If EGG → new egg_id, if hatched → new character_id.
 * Pet must exist and be alive.
 */
import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/server/middleware/auth';
import { getPetState, saveActivity } from '@/server/db/repository';
import { sseEmitter } from '@/server/engine/sseEmitter';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request: Request) => {
  const rl = rateLimit('pet-reroll', 1, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limited. Try again shortly.', retryAfter: rl.retryAfter },
      { status: 429 },
    );
  }

  try {
    const pet = getPetState();

    if (!pet) {
      return NextResponse.json(
        { error: 'Pet not initialized' },
        { status: 404 },
      );
    }

    if (!pet.is_alive) {
      return NextResponse.json(
        { error: 'Pet is dead — revive first' },
        { status: 400 },
      );
    }

    const { rerollPet } = await import('@/server/engine/pet/petStateMachine');
    rerollPet();

    saveActivity({
      timestamp: Date.now(),
      category: 'engine',
      action: 'reroll',
      pair: null,
      detail: JSON.stringify({ rerolledAt: Date.now(), stage: pet.stage }),
    });

    // Emit SSE so dashboard updates immediately
    const updatedPet = getPetState();
    sseEmitter.emit('pet_updated', updatedPet);

    return NextResponse.json({
      success: true,
      pet: updatedPet,
    });
  } catch (err) {
    console.error('[api/pet/reroll] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to reroll pet' },
      { status: 500 },
    );
  }
});
