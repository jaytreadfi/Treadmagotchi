/**
 * Per-mood particle effects rendered over the character.
 *
 * Each mood has a lightweight particle system drawn relative to
 * the character's position. Effects are purely visual — no state
 * outside the frame counter.
 */

import type { PetMood } from '@/lib/types';

/** Draw mood-specific particle effects above/around the character. */
export function drawMoodEffect(
  ctx: CanvasRenderingContext2D,
  mood: PetMood,
  x: number,
  y: number,
  frame: number,
): void {
  // Center offset for 24x24 character sprite
  const cx = x + 12;
  const cy = y + 4;

  switch (mood) {
    case 'happy':
    case 'excited':
      drawHearts(ctx, cx, cy, frame);
      break;
    case 'angry':
      drawSteam(ctx, cx, cy, frame);
      break;
    case 'sad':
      drawTear(ctx, cx, cy, frame);
      break;
    case 'sick':
      drawSwirl(ctx, cx, cy, frame);
      break;
    case 'sleeping':
      drawZzz(ctx, cx, cy, frame);
      break;
    case 'hungry':
    case 'starving':
      drawDots(ctx, cx, cy, frame);
      break;
    case 'proud':
      drawSparkles(ctx, cx, cy, frame);
      break;
    case 'determined':
      drawFlame(ctx, cx, cy, frame);
      break;
    case 'bored':
      drawDots(ctx, cx, cy, frame, true);
      break;
    case 'content':
      drawGlow(ctx, cx, cy, frame);
      break;
    default:
      break;
  }
}

// ── Individual effect renderers ──

function drawHearts(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  ctx.fillStyle = '#ff6b8a';
  for (let i = 0; i < 3; i++) {
    const angle = (frame * 0.04) + (i * Math.PI * 2 / 3);
    const dist = 14 + Math.sin(frame * 0.06 + i) * 3;
    const hx = cx + Math.cos(angle) * dist;
    const hy = cy - 4 + Math.sin(angle) * dist * 0.5;
    const alpha = (Math.sin(frame * 0.08 + i) + 1) / 2;
    ctx.globalAlpha = alpha * 0.8;
    // Tiny heart shape (pixel art style — just a 3x3 shape)
    ctx.fillRect(hx - 1, hy, 1, 1);
    ctx.fillRect(hx + 1, hy, 1, 1);
    ctx.fillRect(hx - 2, hy - 1, 2, 1);
    ctx.fillRect(hx + 1, hy - 1, 2, 1);
    ctx.fillRect(hx, hy + 1, 1, 1);
  }
  ctx.restore();
}

function drawSteam(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  ctx.fillStyle = '#ff4444';
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 2; i++) {
    const offset = i === 0 ? -5 : 5;
    const rise = (frame * 0.5 + i * 20) % 12;
    const px = cx + offset;
    const py = cy - 8 - rise;
    const alpha = 1 - rise / 12;
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillRect(px, py, 2, 2);
    ctx.fillRect(px - 1, py - 2, 2, 1);
  }
  ctx.restore();
}

function drawTear(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  ctx.fillStyle = '#60a5fa';
  const fall = (frame * 0.8) % 16;
  const alpha = 1 - fall / 16;
  ctx.globalAlpha = alpha * 0.8;
  const ty = cy + fall - 4;
  // Tear drop shape
  ctx.fillRect(cx + 6, ty, 1, 2);
  ctx.fillRect(cx + 5, ty + 2, 3, 1);
  ctx.restore();
}

function drawSwirl(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  ctx.fillStyle = '#4ade80';
  for (let i = 0; i < 3; i++) {
    const angle = frame * 0.06 + (i * Math.PI * 2 / 3);
    const dist = 10;
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy - 2 + Math.sin(angle) * dist * 0.4;
    ctx.globalAlpha = 0.5 + Math.sin(frame * 0.1 + i) * 0.3;
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.restore();
}

function drawZzz(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  ctx.fillStyle = '#a5b4fc';
  ctx.font = '5px monospace';
  ctx.textAlign = 'center';

  const zCount = 3;
  for (let i = 0; i < zCount; i++) {
    const phase = (frame * 0.02 + i * 0.4) % 1;
    const zx = cx + 8 + i * 3;
    const zy = cy - 6 - phase * 16;
    ctx.globalAlpha = (1 - phase) * 0.7;
    const size = 4 + i;
    ctx.font = `${size}px monospace`;
    ctx.fillText('z', zx, zy);
  }
  ctx.restore();
}

function drawDots(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number, slow = false): void {
  ctx.save();
  ctx.fillStyle = '#94a3b8';
  const speed = slow ? 0.02 : 0.04;
  const phase = (frame * speed) % 1;
  const numDots = Math.floor(phase * 3) + 1;
  for (let i = 0; i < numDots; i++) {
    ctx.globalAlpha = 0.6;
    ctx.fillRect(cx - 4 + i * 4, cy - 10, 2, 2);
  }
  ctx.restore();
}

function drawSparkles(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  ctx.fillStyle = '#fcd34d';
  for (let i = 0; i < 5; i++) {
    const angle = frame * 0.05 + (i * Math.PI * 2 / 5);
    const dist = 12 + Math.sin(frame * 0.1 + i * 2) * 4;
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy - 2 + Math.sin(angle) * dist * 0.6;
    const alpha = (Math.sin(frame * 0.12 + i) + 1) / 2;
    ctx.globalAlpha = alpha * 0.9;
    // Cross sparkle
    ctx.fillRect(sx, sy - 1, 1, 3);
    ctx.fillRect(sx - 1, sy, 3, 1);
  }
  ctx.restore();
}

function drawFlame(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  // Small flickering flame under character
  const flicker = Math.sin(frame * 0.2) * 2;
  ctx.fillStyle = '#f97316';
  ctx.globalAlpha = 0.7;
  ctx.fillRect(cx - 2, cy + 18 + flicker, 2, 3);
  ctx.fillRect(cx, cy + 17 + flicker, 2, 4);
  ctx.fillRect(cx + 2, cy + 18 + flicker, 2, 3);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(cx - 1, cy + 19 + flicker, 3, 2);
  ctx.restore();
}

function drawGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save();
  const alpha = 0.1 + Math.sin(frame * 0.03) * 0.05;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(cx, cy + 8, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
