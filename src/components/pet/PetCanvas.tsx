'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { usePetStore } from '@/store/usePetStore';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@/lib/constants';
import { getCharacterById } from '@/lib/characters';
import { getMapById } from '@/lib/maps';
import { preloadImage, preloadShadow, preloadMap, getCached } from '@/lib/sprites';
import {
  createCharacterState,
  tickCharacter,
  triggerHappyBurst,
  drawCharacter,
  type CharacterState,
} from './characterAnimator';
import { drawMoodEffect } from './moodEffects';

const EVOLUTION_FLASH_DURATION_MS = 8000;

export default function PetCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const charStateRef = useRef<CharacterState>(createCharacterState());

  const stage = usePetStore((s) => s.stage);
  const mood = usePetStore((s) => s.mood);
  const isAlive = usePetStore((s) => s.is_alive);
  const speechBubble = usePetStore((s) => s.speech_bubble);
  const speechBubbleUntil = usePetStore((s) => s.speech_bubble_until);
  const evolvedAt = usePetStore((s) => s.evolved_at);
  const characterId = usePetStore((s) => s.character_id);
  const mapId = usePetStore((s) => s.map_id);

  const [assetsReady, setAssetsReady] = useState(false);
  const prevSpeechRef = useRef<string | null>(null);

  // ── Preload assets ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const promises: Promise<unknown>[] = [
        preloadShadow(),
      ];

      if (characterId) {
        const charDef = getCharacterById(characterId);
        if (charDef) {
          promises.push(preloadImage(charDef.sheet));
        }
      }

      if (mapId) {
        const mapDef = getMapById(mapId);
        if (mapDef) {
          promises.push(preloadMap(mapDef.src));
        }
      }

      await Promise.all(promises);
      if (!cancelled) {
        setAssetsReady(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [characterId, mapId]);

  // ── Speech bubble expiry ──
  const [visibleSpeech, setVisibleSpeech] = useState<string | null>(speechBubble);

  useEffect(() => {
    setVisibleSpeech(speechBubble);
    if (!speechBubble || !speechBubbleUntil) return;
    const remaining = speechBubbleUntil - Date.now();
    if (remaining <= 0) { setVisibleSpeech(null); return; }
    const timeout = setTimeout(() => setVisibleSpeech(null), remaining);
    return () => clearTimeout(timeout);
  }, [speechBubble, speechBubbleUntil]);

  // ── Happy burst on new speech bubble ──
  useEffect(() => {
    if (speechBubble && speechBubble !== prevSpeechRef.current && isAlive && mood !== 'dead') {
      charStateRef.current = triggerHappyBurst(charStateRef.current);
    }
    prevSpeechRef.current = speechBubble;
  }, [speechBubble, isAlive, mood]);

  // ── Evolution flash ──
  const [isEvolving, setIsEvolving] = useState(false);

  useEffect(() => {
    if (evolvedAt != null && Date.now() - evolvedAt < EVOLUTION_FLASH_DURATION_MS) {
      setIsEvolving(true);
      const remaining = EVOLUTION_FLASH_DURATION_MS - (Date.now() - evolvedAt);
      const timer = setTimeout(() => setIsEvolving(false), remaining);
      return () => clearTimeout(timer);
    } else {
      setIsEvolving(false);
    }
  }, [evolvedAt]);

  // ── Resolve map image src ──
  const mapSrc = mapId ? getMapById(mapId)?.src ?? null : null;

  // ── Main draw callback ──
  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: number) => {
    const W = CANVAS_WIDTH;
    const H = CANVAS_HEIGHT;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    // Draw map background
    if (mapSrc) {
      const mapImg = getCached(mapSrc);
      if (mapImg) ctx.drawImage(mapImg, 0, 0, W, H);
    }

    // ── Walking character ──
    if (characterId) {
      const charDef = getCharacterById(characterId);
      if (charDef) {
        charStateRef.current = tickCharacter(charStateRef.current, mood);
        const cs = charStateRef.current;

        if (isEvolving) {
          ctx.save();
          const flashPhase = Math.sin(frame * 0.3);
          ctx.globalAlpha = 0.5 + flashPhase * 0.5;
        }

        drawCharacter(ctx, cs, charDef.sheet, mood, isAlive);

        if (isEvolving) {
          ctx.restore();
        }

        if (isAlive && mood !== 'content') {
          drawMoodEffect(ctx, mood, cs.x, cs.y, frame);
        }

        drawSpeechBubble(ctx, visibleSpeech, cs.x + 12, cs.y - 14);
      }
    }
  }, [stage, mood, isAlive, visibleSpeech, isEvolving, characterId, mapSrc]);

  // ── Animation loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsReady) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const animate = () => {
      frameRef.current++;
      draw(ctx, frameRef.current);
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [draw, assetsReady]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="w-full h-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

// ── Speech bubble helper ──

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  text: string | null,
  anchorX: number,
  anchorY: number,
): void {
  if (!text) return;

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1;

  const bubbleW = Math.min(120, text.length * 5 + 16);
  const bubbleH = 18;
  const bubbleX = Math.max(2, Math.min(CANVAS_WIDTH - 2 - bubbleW, anchorX - bubbleW / 2));
  const bubbleY = Math.max(2, anchorY - 10);

  ctx.beginPath();
  ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 4);
  ctx.fill();
  ctx.stroke();

  // Tail
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  const tailX = Math.max(bubbleX + 4, Math.min(bubbleX + bubbleW - 4, anchorX));
  ctx.moveTo(tailX - 3, bubbleY + bubbleH);
  ctx.lineTo(tailX, bubbleY + bubbleH + 5);
  ctx.lineTo(tailX + 3, bubbleY + bubbleH);
  ctx.fill();

  // Text
  ctx.fillStyle = '#1a1a2e';
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, bubbleX + bubbleW / 2, bubbleY + 12);
  ctx.restore();
}
