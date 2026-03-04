'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { usePetStore } from '@/store/usePetStore';
import { CANVAS_LOGICAL_SIZE } from '@/lib/constants';
import { getCharacterById } from '@/lib/characters';
import { preloadImage, preloadEgg, preloadShadow } from '@/lib/sprites';
import {
  createCharacterState,
  tickCharacter,
  triggerHappyBurst,
  drawCharacter,
  drawEgg,
  type CharacterState,
} from './characterAnimator';
import { drawMoodEffect } from './moodEffects';

const EVOLUTION_FLASH_DURATION_MS = 8000;
const HATCH_DURATION_FRAMES = 180; // ~3 sec at 60fps

export default function PetCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const charStateRef = useRef<CharacterState>(createCharacterState());
  const hatchFrameRef = useRef(0);

  const stage = usePetStore((s) => s.stage);
  const mood = usePetStore((s) => s.mood);
  const isAlive = usePetStore((s) => s.is_alive);
  const speechBubble = usePetStore((s) => s.speech_bubble);
  const speechBubbleUntil = usePetStore((s) => s.speech_bubble_until);
  const evolvedAt = usePetStore((s) => s.evolved_at);
  const eggId = usePetStore((s) => s.egg_id);
  const characterId = usePetStore((s) => s.character_id);

  const [assetsReady, setAssetsReady] = useState(false);
  const [isHatching, setIsHatching] = useState(false);
  const prevStageRef = useRef(stage);
  const prevSpeechRef = useRef<string | null>(null);

  // ── Preload assets ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const promises: Promise<unknown>[] = [
        preloadShadow(),
      ];

      if (eggId) {
        promises.push(preloadEgg(eggId));
      }

      if (characterId) {
        const charDef = getCharacterById(characterId);
        if (charDef) {
          promises.push(preloadImage(charDef.sheet));
        }
      }

      await Promise.all(promises);
      if (!cancelled) {
        setAssetsReady(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [eggId, characterId]);

  // ── Detect EGG→CRITTER hatching ──
  useEffect(() => {
    if (prevStageRef.current === 'EGG' && stage !== 'EGG') {
      setIsHatching(true);
      hatchFrameRef.current = 0;
      const timer = setTimeout(() => setIsHatching(false), 3000);
      prevStageRef.current = stage;
      return () => clearTimeout(timer);
    }
    prevStageRef.current = stage;
  }, [stage]);

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

  // ── Main draw callback ──
  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: number) => {
    const S = CANVAS_LOGICAL_SIZE;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, S, S);

    // ── HATCHING ANIMATION ──
    if (isHatching) {
      hatchFrameRef.current++;
      const hf = hatchFrameRef.current;
      const progress = hf / HATCH_DURATION_FRAMES;

      if (progress < 0.5) {
        // Phase 1: Egg shakes intensely (no background)
        const intensity = 2 + progress * 16;
        if (eggId) {
          drawEgg(ctx, `/sprites/eggs/${eggId}.png`, frame, intensity);
        }
        // Crack lines appear
        if (progress > 0.25) {
          ctx.save();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.globalAlpha = (progress - 0.25) / 0.25;
          ctx.beginPath();
          ctx.moveTo(74, 76); ctx.lineTo(80, 68); ctx.lineTo(86, 78);
          ctx.moveTo(78, 82); ctx.lineTo(82, 72);
          ctx.moveTo(72, 84); ctx.lineTo(76, 74); ctx.lineTo(84, 82);
          ctx.stroke();
          ctx.restore();
        }
      } else if (progress < 0.65) {
        // Phase 2: White flash fades out
        const flashProgress = (progress - 0.5) / 0.15;
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 1 - flashProgress;
        ctx.fillRect(0, 0, S, S);
        ctx.restore();
      } else {
        // Phase 3: Character fades in with sparkles
        const fadeProgress = Math.min(1, (progress - 0.65) / 0.15);
        if (characterId) {
          const charDef = getCharacterById(characterId);
          if (charDef) {
            ctx.save();
            ctx.globalAlpha = fadeProgress;
            drawCharacter(ctx, charStateRef.current, charDef.sheet, 'content', true);
            ctx.restore();
          }
        }
        // Sparkle burst
        const sparkleAlpha = 1 - (progress - 0.65) / 0.35;
        if (sparkleAlpha > 0) {
          ctx.save();
          ctx.fillStyle = '#fcd34d';
          ctx.globalAlpha = sparkleAlpha * 0.9;
          for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI * 2) / 8 + frame * 0.02;
            const dist = 8 + (progress - 0.65) * 100;
            const sx = 80 + Math.cos(angle) * dist;
            const sy = 80 + Math.sin(angle) * dist;
            ctx.fillRect(sx - 1, sy - 1, 3, 3);
          }
          ctx.restore();
        }
      }
      drawSpeechBubble(ctx, visibleSpeech, 80, 50);
      return;
    }

    // ── EGG STAGE — No background, just floating egg ──
    if (stage === 'EGG') {
      if (eggId) {
        // Gentle floating bob animation
        const bob = Math.sin(frame * 0.04) * 4;
        drawEgg(ctx, `/sprites/eggs/${eggId}.png`, frame, 1.5, bob);
      }
      drawSpeechBubble(ctx, visibleSpeech, 80, 50);
      return;
    }

    // ── POST-HATCH: Walking character (no background) ──
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

        // Mood particles
        if (isAlive && mood !== 'content') {
          drawMoodEffect(ctx, mood, cs.x, cs.y, frame);
        }

        // Speech bubble anchored above character
        drawSpeechBubble(ctx, visibleSpeech, cs.x + 12, cs.y - 14);
      }
    }
  }, [stage, mood, isAlive, visibleSpeech, isEvolving, isHatching, eggId, characterId]);

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
      width={CANVAS_LOGICAL_SIZE}
      height={CANVAS_LOGICAL_SIZE}
      className="w-80 h-80 mx-auto"
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
  const bubbleX = Math.max(2, Math.min(158 - bubbleW, anchorX - bubbleW / 2));
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
