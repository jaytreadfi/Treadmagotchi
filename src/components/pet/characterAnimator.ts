/**
 * Character behavior AI + sprite frame selection.
 *
 * 6-state machine: idle, walking, sitting, sleeping, happy, dead.
 * Mood-weighted dice rolls determine next state after idle expires.
 *
 * Sprite sheet layout (5 rows of 24x24):
 *   Row 0: Idle     (8 frames) — idle loop
 *   Row 1: Walking  (8 frames) — walk cycle loop
 *   Row 2: Die/Sleep (8 frames) — fall-down, play once then hold last frame
 *   Row 3: Happy    (1 frame)  — positive mood / interacted
 *   Row 4: Sitting  (2 frames) — col 0 = look left, col 1 = look right
 */

import { getCached } from '@/lib/sprites';
import type { PetMood } from '@/lib/types';
import {
  CHARACTER_FRAME_SIZE as FS,
  WALK_SPEED,
  WALK_ANIM_FPS,
  IDLE_MIN_FRAMES,
  IDLE_MAX_FRAMES,
  SIT_MIN_FRAMES,
  SIT_MAX_FRAMES,
  HAPPY_BURST_FRAMES,
  WALK_BOUNDS_MIN_X,
  WALK_BOUNDS_MAX_X,
  WALK_BOUNDS_MIN_Y,
  WALK_BOUNDS_MAX_Y,
} from '@/lib/constants';

// Animation row indices (matches actual sprite sheet layout)
const ROW_IDLE = 0;
const ROW_WALK = 1;
const ROW_DIE_SLEEP = 2;
const ROW_HAPPY = 3;
const ROW_SIT = 4;

// Frame counts per row
const IDLE_FRAMES = 8;
const WALK_FRAMES = 4;
const DIE_SLEEP_FRAMES = 9;
const SIT_FRAMES = 2;

// Sitting: swap look direction every ~30sec at 60fps
const SIT_LOOK_SWAP_FRAMES = 1800;

// Sleep from bored: duration range
const SLEEP_MIN_FRAMES = 600;  // ~10 sec
const SLEEP_MAX_FRAMES = 1200; // ~20 sec

export type BehaviorState = 'idle' | 'walking' | 'sitting' | 'sleeping' | 'happy' | 'dead';

export interface CharacterState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: BehaviorState;
  facingLeft: boolean;
  frame: number;
  stateTimer: number;   // frames remaining in current timed state
  animTimer: number;     // accumulator for frame cycling
  animComplete: boolean; // true when die/sleep fall-down animation has finished
}

// Mood-weighted transition probabilities
interface MoodProfile {
  walk: number;
  sit: number;
  stay: number;
  sleep: number; // chance to nap (bored pets)
  speed: number;
}

function getMoodProfile(mood: PetMood): MoodProfile {
  switch (mood) {
    case 'happy':
    case 'excited':
      return { walk: 50, sit: 10, stay: 40, sleep: 0, speed: 1.5 };
    case 'proud':
      return { walk: 40, sit: 20, stay: 40, sleep: 0, speed: 1.2 };
    case 'angry':
    case 'determined':
      return { walk: 55, sit: 15, stay: 30, sleep: 0, speed: 1.4 };
    case 'sad':
      return { walk: 15, sit: 45, stay: 30, sleep: 10, speed: 0.5 };
    case 'bored':
      return { walk: 15, sit: 40, stay: 25, sleep: 20, speed: 0.6 };
    case 'hungry':
    case 'starving':
      return { walk: 20, sit: 40, stay: 30, sleep: 10, speed: 0.5 };
    case 'sick':
      return { walk: 10, sit: 40, stay: 30, sleep: 20, speed: 0.3 };
    case 'sleeping':
      return { walk: 0, sit: 0, stay: 0, sleep: 0, speed: 0 };
    case 'dead':
      return { walk: 0, sit: 0, stay: 0, sleep: 0, speed: 0 };
    default: // content
      return { walk: 40, sit: 25, stay: 30, sleep: 5, speed: 1.0 };
  }
}

/** Create initial character state centered in the clearing. */
export function createCharacterState(): CharacterState {
  return {
    x: 142,
    y: 68,
    targetX: 142,
    targetY: 68,
    state: 'idle',
    facingLeft: false,
    frame: 0,
    stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES),
    animTimer: 0,
    animComplete: false,
  };
}

/** Trigger a happy burst animation. Call from PetCanvas on speech bubble. */
export function triggerHappyBurst(state: CharacterState): CharacterState {
  if (state.state === 'dead' || state.state === 'sleeping') return state;
  return {
    ...state,
    state: 'happy',
    frame: 0,
    stateTimer: HAPPY_BURST_FRAMES,
    animTimer: 0,
    animComplete: false,
  };
}

function randomRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

/** Pick a random walk target within the clearing bounds. */
function pickTarget(): { x: number; y: number } {
  return {
    x: WALK_BOUNDS_MIN_X + Math.random() * (WALK_BOUNDS_MAX_X - WALK_BOUNDS_MIN_X - FS),
    y: WALK_BOUNDS_MIN_Y + Math.random() * (WALK_BOUNDS_MAX_Y - WALK_BOUNDS_MIN_Y - FS),
  };
}

/** Roll mood-weighted dice to pick the next state after idle expires. */
function rollNextState(mood: PetMood): { state: BehaviorState; timer: number } {
  const { walk, sit, sleep } = getMoodProfile(mood);
  const roll = Math.random() * 100;

  if (roll < walk) {
    return { state: 'walking', timer: 0 };
  } else if (roll < walk + sit) {
    return { state: 'sitting', timer: randomRange(SIT_MIN_FRAMES, SIT_MAX_FRAMES) };
  } else if (roll < walk + sit + sleep) {
    return { state: 'sleeping', timer: randomRange(SLEEP_MIN_FRAMES, SLEEP_MAX_FRAMES) };
  } else {
    // Stay idle — re-roll timer
    return { state: 'idle', timer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES) };
  }
}

/** Advance character state by one frame (called at ~60fps). */
export function tickCharacter(state: CharacterState, mood: PetMood): CharacterState {
  const profile = getMoodProfile(mood);

  // ── Force-override states ──
  if (mood === 'dead' && state.state !== 'dead') {
    return { ...state, state: 'dead', frame: 0, animTimer: 0, stateTimer: 0, animComplete: false };
  }
  if (mood === 'sleeping' && state.state !== 'sleeping' && state.state !== 'happy') {
    return { ...state, state: 'sleeping', frame: 0, animTimer: 0, stateTimer: 0, animComplete: false };
  }

  // ── Dead: play fall-down once, then hold last frame permanently ──
  if (state.state === 'dead') {
    if (state.animComplete) return state;
    return advanceDieSleepAnim(state);
  }

  // ── Sleeping ──
  if (state.state === 'sleeping') {
    // Mood-driven sleep: stay until mood changes
    // Dice-roll sleep: use stateTimer
    const isMoodSleep = mood === 'sleeping';

    if (!isMoodSleep && state.stateTimer > 0) {
      // Dice-roll nap: count down timer
      const newTimer = state.stateTimer - 1;
      if (newTimer <= 0 && state.animComplete) {
        // Wake up — transition to idle
        return { ...state, state: 'idle', frame: 0, animTimer: 0, stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES), animComplete: false };
      }
      if (state.animComplete) {
        return { ...state, stateTimer: newTimer };
      }
    } else if (!isMoodSleep && state.stateTimer <= 0 && state.animComplete) {
      // Mood changed away from sleeping, wake up
      return { ...state, state: 'idle', frame: 0, animTimer: 0, stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES), animComplete: false };
    }

    // Play fall-down animation, then hold last frame
    if (!state.animComplete) {
      return advanceDieSleepAnim(state);
    }
    return state;
  }

  // ── Happy burst: auto-expire ──
  if (state.state === 'happy') {
    const newTimer = state.stateTimer - 1;
    if (newTimer <= 0) {
      return { ...state, state: 'idle', frame: 0, animTimer: 0, stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES), animComplete: false };
    }
    return { ...state, stateTimer: newTimer };
  }

  // ── Sitting: hold frame, swap look direction every ~30s ──
  if (state.state === 'sitting') {
    const newTimer = state.stateTimer - 1;
    if (newTimer <= 0) {
      return { ...state, state: 'idle', frame: 0, animTimer: 0, stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES), animComplete: false };
    }
    // Accumulate timer for look-swap
    const newAnimTimer = state.animTimer + 1;
    if (newAnimTimer >= SIT_LOOK_SWAP_FRAMES) {
      // Swap direction
      return { ...state, stateTimer: newTimer, frame: (state.frame + 1) % SIT_FRAMES, animTimer: 0 };
    }
    return { ...state, stateTimer: newTimer, animTimer: newAnimTimer };
  }

  // ── Idle: count down, then roll dice ──
  if (state.state === 'idle') {
    const newTimer = state.stateTimer - 1;
    if (newTimer <= 0) {
      const next = rollNextState(mood);
      if (next.state === 'walking') {
        const target = pickTarget();
        return {
          ...state,
          state: 'walking',
          targetX: target.x,
          targetY: target.y,
          stateTimer: 0,
          animTimer: 0,
          frame: 0,
          animComplete: false,
        };
      }
      if (next.state === 'sleeping') {
        return {
          ...state,
          state: 'sleeping',
          stateTimer: next.timer,
          animTimer: 0,
          frame: 0,
          animComplete: false,
        };
      }
      return {
        ...state,
        state: next.state,
        stateTimer: next.timer,
        animTimer: 0,
        frame: 0,
        animComplete: false,
      };
    }
    // Animate idle frames (slow breathing)
    const framesPerTick = 6 / 60;
    const newAnimTimer = state.animTimer + framesPerTick;
    const newFrame = newAnimTimer >= 1
      ? (state.frame + 1) % IDLE_FRAMES
      : state.frame;
    return {
      ...state,
      stateTimer: newTimer,
      frame: newFrame,
      animTimer: newAnimTimer >= 1 ? 0 : newAnimTimer,
    };
  }

  // ── Walking: move toward target ──
  const speed = WALK_SPEED * profile.speed;
  const dx = state.targetX - state.x;
  const dy = state.targetY - state.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Reached target -> idle
  if (dist < speed * 2) {
    return {
      ...state,
      x: state.targetX,
      y: state.targetY,
      state: 'idle',
      frame: 0,
      animTimer: 0,
      stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES),
      animComplete: false,
    };
  }

  // Move toward target
  const nx = dx / dist;
  const ny = dy / dist;
  const newX = state.x + nx * speed;
  const newY = state.y + ny * speed;

  // Face direction of horizontal movement
  const facingLeft = dx < -0.1 ? true : dx > 0.1 ? false : state.facingLeft;

  // Advance walk animation frame
  const walkAnimSpeed = WALK_ANIM_FPS * profile.speed;
  const framesPerTick = walkAnimSpeed / 60;
  const newAnimTimer = state.animTimer + framesPerTick;
  const newFrame = newAnimTimer >= 1
    ? (state.frame + 1) % WALK_FRAMES
    : state.frame;

  return {
    ...state,
    x: newX,
    y: newY,
    facingLeft,
    frame: newFrame,
    animTimer: newAnimTimer >= 1 ? 0 : newAnimTimer,
  };
}

/** Advance the die/sleep fall-down animation by one tick. Plays once then marks complete. */
function advanceDieSleepAnim(state: CharacterState): CharacterState {
  const framesPerTick = 6 / 60; // slow fall-down
  const newAnimTimer = state.animTimer + framesPerTick;
  if (newAnimTimer >= 1) {
    const nextFrame = state.frame + 1;
    if (nextFrame >= DIE_SLEEP_FRAMES) {
      // Animation complete — hold last frame
      return { ...state, frame: DIE_SLEEP_FRAMES - 1, animTimer: 0, animComplete: true };
    }
    return { ...state, frame: nextFrame, animTimer: 0 };
  }
  return { ...state, animTimer: newAnimTimer };
}

/**
 * Select the sprite sheet row and column based on character state.
 */
function selectFrame(
  state: CharacterState,
  _mood: PetMood,
  isAlive: boolean,
): { row: number; col: number } {
  if (!isAlive || state.state === 'dead') {
    return { row: ROW_DIE_SLEEP, col: Math.min(state.frame, DIE_SLEEP_FRAMES - 1) };
  }

  switch (state.state) {
    case 'idle':
      return { row: ROW_IDLE, col: state.frame % IDLE_FRAMES };
    case 'walking':
      return { row: ROW_WALK, col: state.frame % WALK_FRAMES };
    case 'sleeping':
      return { row: ROW_DIE_SLEEP, col: Math.min(state.frame, DIE_SLEEP_FRAMES - 1) };
    case 'sitting':
      return { row: ROW_SIT, col: state.frame % SIT_FRAMES };
    case 'happy':
      return { row: ROW_HAPPY, col: 0 };
    default:
      return { row: ROW_IDLE, col: 0 };
  }
}

/**
 * Draw the character sprite onto the canvas.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  state: CharacterState,
  sheetSrc: string,
  mood: PetMood,
  isAlive: boolean,
): void {
  const sheet = getCached(sheetSrc);
  if (!sheet) return;

  const { row, col } = selectFrame(state, mood, isAlive);
  const sx = col * FS;
  const sy = row * FS;

  ctx.save();

  // Dead: ghost effect
  if (!isAlive || state.state === 'dead') {
    ctx.globalAlpha = 0.4;
  }

  // Draw shadow under character
  const shadowImg = getCached('/sprites/characters/shadow.png');
  if (shadowImg) {
    ctx.drawImage(shadowImg, Math.round(state.x) + 3, Math.round(state.y) + 20, 17, 6);
  }

  // Flip horizontally when facing left
  if (state.facingLeft) {
    ctx.translate(Math.round(state.x) + FS, Math.round(state.y));
    ctx.scale(-1, 1);
    ctx.drawImage(sheet, sx, sy, FS, FS, 0, 0, FS, FS);
  } else {
    ctx.drawImage(sheet, sx, sy, FS, FS, Math.round(state.x), Math.round(state.y), FS, FS);
  }

  ctx.restore();
}

/**
 * Draw an egg sprite with wobble and optional floating bob animation.
 * @param bob - Vertical offset for floating animation (0 = no bob)
 */
export function drawEgg(
  ctx: CanvasRenderingContext2D,
  eggSrc: string,
  frame: number,
  wobbleIntensity: number,
  bob = 0,
): void {
  const img = getCached(eggSrc);
  if (!img) return;

  const wobble = Math.sin(frame * 0.05) * wobbleIntensity;
  const cx = 142;
  const cy = 80 + bob;

  ctx.save();
  ctx.translate(cx + wobble, cy);

  // Shadow scales with bob height
  const shadowImg = getCached('/sprites/characters/shadow.png');
  if (shadowImg) {
    const shadowScale = 1 - Math.abs(bob) * 0.02;
    const sw = 17 * shadowScale;
    ctx.globalAlpha = 0.4 + shadowScale * 0.3;
    ctx.drawImage(shadowImg, -sw / 2, 16 - bob, sw, 6 * shadowScale);
    ctx.globalAlpha = 1;
  }

  ctx.drawImage(img, -16, -16, 32, 32);
  ctx.restore();
}
