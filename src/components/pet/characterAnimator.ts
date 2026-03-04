/**
 * Character behavior AI + sprite frame selection.
 *
 * 6-state machine: idle, walking, sitting, sleeping, happy, dead.
 * Mood-weighted dice rolls determine next state after idle expires.
 *
 * Sprite sheet layout (216x120 = 9 cols × 5 rows of 24x24):
 *   Row 0: Walking  (8 frames) — walk cycle
 *   Row 1: Sleep    (3 frames) — sleeping loop
 *   Row 2: Idle     (8 frames) — idle animation loop
 *   Row 3: Happy    (1 frame)  — positive mood
 *   Row 4: Sitdown (col 0), Die (col 1)
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
  WALK_BOUNDS_MIN,
  WALK_BOUNDS_MAX,
} from '@/lib/constants';

// Animation row indices
const ROW_WALK = 0;
const ROW_SLEEP = 1;
const ROW_IDLE = 2;
const ROW_HAPPY = 3;
const ROW_SIT_DIE = 4;

// Frame counts per row
const WALK_FRAMES = 8;
const SLEEP_FRAMES = 3;
const IDLE_FRAMES = 8;

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
}

// Mood-weighted transition probabilities: [walk%, sit%, stayIdle%]
interface MoodProfile {
  walk: number;
  sit: number;
  stay: number;
  speed: number;
}

function getMoodProfile(mood: PetMood): MoodProfile {
  switch (mood) {
    case 'happy':
    case 'excited':
      return { walk: 50, sit: 10, stay: 40, speed: 1.5 };
    case 'proud':
      return { walk: 40, sit: 20, stay: 40, speed: 1.2 };
    case 'angry':
    case 'determined':
      return { walk: 55, sit: 15, stay: 30, speed: 1.4 };
    case 'sad':
      return { walk: 15, sit: 55, stay: 30, speed: 0.5 };
    case 'bored':
      return { walk: 20, sit: 50, stay: 30, speed: 0.6 };
    case 'hungry':
    case 'starving':
      return { walk: 20, sit: 50, stay: 30, speed: 0.5 };
    case 'sick':
      return { walk: 10, sit: 60, stay: 30, speed: 0.3 };
    case 'sleeping':
      return { walk: 0, sit: 0, stay: 0, speed: 0 };
    case 'dead':
      return { walk: 0, sit: 0, stay: 0, speed: 0 };
    default: // content
      return { walk: 40, sit: 30, stay: 30, speed: 1.0 };
  }
}

/** Create initial character state centered in the clearing. */
export function createCharacterState(): CharacterState {
  return {
    x: 68,
    y: 68,
    targetX: 68,
    targetY: 68,
    state: 'idle',
    facingLeft: false,
    frame: 0,
    stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES),
    animTimer: 0,
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
  };
}

function randomRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

/** Pick a random walk target within the clearing bounds. */
function pickTarget(): { x: number; y: number } {
  return {
    x: WALK_BOUNDS_MIN + Math.random() * (WALK_BOUNDS_MAX - WALK_BOUNDS_MIN - FS),
    y: WALK_BOUNDS_MIN + Math.random() * (WALK_BOUNDS_MAX - WALK_BOUNDS_MIN - FS),
  };
}

/** Roll mood-weighted dice to pick the next state after idle expires. */
function rollNextState(mood: PetMood): { state: BehaviorState; timer: number } {
  const { walk, sit } = getMoodProfile(mood);
  const roll = Math.random() * 100;

  if (roll < walk) {
    return { state: 'walking', timer: 0 };
  } else if (roll < walk + sit) {
    return { state: 'sitting', timer: randomRange(SIT_MIN_FRAMES, SIT_MAX_FRAMES) };
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
    return { ...state, state: 'dead', frame: 0, animTimer: 0, stateTimer: 0 };
  }
  if (mood === 'sleeping' && state.state !== 'sleeping' && state.state !== 'happy') {
    return { ...state, state: 'sleeping', frame: 0, animTimer: 0, stateTimer: 0 };
  }

  // ── Dead: permanent ──
  if (state.state === 'dead') {
    return state;
  }

  // ── Sleeping: stay until mood changes ──
  if (state.state === 'sleeping') {
    if (mood !== 'sleeping') {
      return { ...state, state: 'idle', frame: 0, animTimer: 0, stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES) };
    }
    // Animate sleep frames slowly
    const framesPerTick = 3 / 60;
    const newAnimTimer = state.animTimer + framesPerTick;
    const newFrame = newAnimTimer >= 1
      ? (state.frame + 1) % SLEEP_FRAMES
      : state.frame;
    return {
      ...state,
      frame: newFrame,
      animTimer: newAnimTimer >= 1 ? 0 : newAnimTimer,
    };
  }

  // ── Happy burst: auto-expire ──
  if (state.state === 'happy') {
    const newTimer = state.stateTimer - 1;
    if (newTimer <= 0) {
      return { ...state, state: 'idle', frame: 0, animTimer: 0, stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES) };
    }
    return { ...state, stateTimer: newTimer };
  }

  // ── Sitting: wait for timer, then idle ──
  if (state.state === 'sitting') {
    const newTimer = state.stateTimer - 1;
    if (newTimer <= 0) {
      return { ...state, state: 'idle', frame: 0, animTimer: 0, stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES) };
    }
    return { ...state, stateTimer: newTimer };
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
        };
      }
      return {
        ...state,
        state: next.state,
        stateTimer: next.timer,
        animTimer: 0,
        frame: 0,
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

  // Reached target → idle
  if (dist < speed * 2) {
    return {
      ...state,
      x: state.targetX,
      y: state.targetY,
      state: 'idle',
      frame: 0,
      animTimer: 0,
      stateTimer: randomRange(IDLE_MIN_FRAMES, IDLE_MAX_FRAMES),
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

/**
 * Select the sprite sheet row and column based on character state and mood.
 */
function selectFrame(
  state: CharacterState,
  mood: PetMood,
  isAlive: boolean,
): { row: number; col: number } {
  if (!isAlive || state.state === 'dead') {
    return { row: ROW_SIT_DIE, col: 1 };
  }

  switch (state.state) {
    case 'walking':
      return { row: ROW_WALK, col: state.frame % WALK_FRAMES };
    case 'sleeping':
      return { row: ROW_SLEEP, col: state.frame % SLEEP_FRAMES };
    case 'sitting':
      return { row: ROW_SIT_DIE, col: 0 };
    case 'happy':
      return { row: ROW_HAPPY, col: 0 };
    case 'idle':
    default:
      return { row: ROW_IDLE, col: state.frame % IDLE_FRAMES };
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
  const cx = 80;
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
