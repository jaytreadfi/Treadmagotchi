/**
 * POST /api/pet/interact
 *
 * Boost the pet's happiness by +5 (capped at 100).
 * Rate-limited to 1 request per 3 minutes (180 seconds).
 * Updates vitals server-side and emits pet_updated SSE event.
 */
import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/server/middleware/auth';
import { getPetState, updatePetState } from '@/server/db/repository';
import { sseEmitter } from '@/server/engine/sseEmitter';

export const dynamic = 'force-dynamic';

const HAPPINESS_BOOST = 5;

export const POST = withAuth(async (_request: Request) => {
  // Rate limit: 1 per 3 minutes
  const rl = rateLimit('pet-interact', 1, 180_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limited. You can interact again shortly.', retryAfter: rl.retryAfter },
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
        { error: 'Cannot interact with a dead pet. Revive it first.' },
        { status: 400 },
      );
    }

    // Boost happiness (capped at 100)
    const newHappiness = Math.min(100, pet.happiness + HAPPINESS_BOOST);

    updatePetState({
      happiness: newHappiness,
      last_save_time: Date.now(),
    });

    // Fetch updated state and emit SSE
    const updatedPet = getPetState();
    sseEmitter.emit('pet_updated', updatedPet);

    return NextResponse.json({
      success: true,
      happiness: newHappiness,
      pet: updatedPet,
    });
  } catch (err) {
    console.error('[api/pet/interact] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to interact with pet' },
      { status: 500 },
    );
  }
});
