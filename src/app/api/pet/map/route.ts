/**
 * POST /api/pet/map
 *
 * Change the pet's background map. Pass { map_id: "space-station" } or { map_id: null } to clear.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { getPetState, updatePetState } from '@/server/db/repository';
import { sseEmitter } from '@/server/engine/sseEmitter';
import { MAPS } from '@/lib/maps';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (request: Request) => {
  try {
    const body = await request.json();
    const { map_id } = body as { map_id: string | null };

    // Validate map_id
    if (map_id !== null && !MAPS.some((m) => m.id === map_id)) {
      return NextResponse.json(
        { error: `Unknown map_id: ${map_id}` },
        { status: 400 },
      );
    }

    const pet = getPetState();
    if (!pet) {
      return NextResponse.json(
        { error: 'Pet not initialized' },
        { status: 404 },
      );
    }

    updatePetState({ map_id: map_id });
    sseEmitter.emit('pet_updated', { map_id });

    return NextResponse.json({ success: true, map_id });
  } catch (err) {
    console.error('[api/pet/map] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to update map' },
      { status: 500 },
    );
  }
});
