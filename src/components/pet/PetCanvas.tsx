'use client';

import { useRef, useEffect, useCallback } from 'react';
import { usePetStore } from '@/store/usePetStore';
import { CANVAS_LOGICAL_SIZE } from '@/lib/constants';
import type { EvolutionStage, PetMood } from '@/lib/types';

// Placeholder colors per evolution stage
const STAGE_COLORS: Record<EvolutionStage, string> = {
  EGG: '#fbbf24',
  CRITTER: '#60a5fa',
  CREATURE: '#f472b6',
  BEAST: '#fb923c',
  MYTHIC: '#fcd34d',
};

const STAGE_SIZES: Record<EvolutionStage, number> = {
  EGG: 24, CRITTER: 38, CREATURE: 48, BEAST: 56, MYTHIC: 64,
};

// Mood-based eye/expression rendering
const MOOD_EYES: Record<string, string> = {
  dead: 'X X', happy: '^ ^', excited: '* *', angry: '> <',
  sad: '; ;', hungry: 'o o', starving: 'x x', sick: '~ ~',
  sleeping: '- -', bored: '. .', content: '• •', proud: '★ ★',
  determined: '= =',
};

export default function PetCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const stage = usePetStore((s) => s.stage);
  const mood = usePetStore((s) => s.mood);
  const isAlive = usePetStore((s) => s.is_alive);
  const speechBubble = usePetStore((s) => s.speech_bubble);

  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: number) => {
    const S = CANVAS_LOGICAL_SIZE;
    ctx.clearRect(0, 0, S, S);

    const cx = S / 2;
    const cy = S / 2 + 10;
    const size = STAGE_SIZES[stage];
    const color = STAGE_COLORS[stage];

    // Bounce animation
    const bounce = Math.sin(frame * 0.08) * (isAlive ? 3 : 0);
    const wobble = Math.sin(frame * 0.05) * (stage === 'EGG' ? 2 : 0);

    ctx.save();
    ctx.translate(cx + wobble, cy + bounce);

    if (!isAlive) {
      // Dead: ghost effect
      ctx.globalAlpha = 0.4;
    }

    // Draw body shape based on stage
    ctx.fillStyle = color;
    if (stage === 'EGG') {
      // Oval egg
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.4, size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      // Crack line
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-size * 0.2, -2);
      ctx.lineTo(0, -6);
      ctx.lineTo(size * 0.15, 0);
      ctx.stroke();
    } else {
      // Rounded body
      const hw = size * 0.45;
      const hh = size * 0.5;
      ctx.beginPath();
      ctx.moveTo(-hw, hh * 0.3);
      ctx.quadraticCurveTo(-hw, -hh, 0, -hh);
      ctx.quadraticCurveTo(hw, -hh, hw, hh * 0.3);
      ctx.quadraticCurveTo(hw, hh, 0, hh);
      ctx.quadraticCurveTo(-hw, hh, -hw, hh * 0.3);
      ctx.fill();

      // Feet for CRITTER+
      if (['CRITTER', 'CREATURE', 'BEAST', 'MYTHIC'].includes(stage)) {
        const footBounce = Math.sin(frame * 0.15) * 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(-hw * 0.5, hh + 2 + footBounce, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hw * 0.5, hh + 2 - footBounce, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Eyes
    if (stage !== 'EGG') {
      const eyeY = -size * 0.15;
      const eyeSpacing = size * 0.2;
      ctx.fillStyle = '#1a1a2e';
      ctx.font = `${Math.max(6, size * 0.15)}px monospace`;
      ctx.textAlign = 'center';

      const eyes = MOOD_EYES[mood] || '• •';
      const [leftEye, rightEye] = eyes.split(' ');
      ctx.fillText(leftEye, -eyeSpacing, eyeY);
      ctx.fillText(rightEye, eyeSpacing, eyeY);

      // Mouth for some moods
      if (mood === 'happy' || mood === 'excited') {
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, eyeY + size * 0.15, size * 0.1, 0, Math.PI);
        ctx.stroke();
      } else if (mood === 'sad' || mood === 'sick') {
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, eyeY + size * 0.25, size * 0.08, Math.PI, 0);
        ctx.stroke();
      }
    }

    // Sparkles for BEAST+
    if (['BEAST', 'MYTHIC'].includes(stage) && isAlive) {
      for (let i = 0; i < 3; i++) {
        const angle = (frame * 0.03) + (i * Math.PI * 2 / 3);
        const dist = size * 0.7;
        const sx = Math.cos(angle) * dist;
        const sy = Math.sin(angle) * dist;
        const sparkleAlpha = (Math.sin(frame * 0.1 + i) + 1) / 2;
        ctx.fillStyle = `rgba(255, 255, 100, ${sparkleAlpha * 0.8})`;
        ctx.fillRect(sx - 1, sy - 1, 3, 3);
      }
    }

    ctx.restore();

    // Speech bubble
    if (speechBubble) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1;

      const bubbleW = Math.min(120, speechBubble.length * 5 + 16);
      const bubbleH = 18;
      const bubbleX = cx - bubbleW / 2;
      const bubbleY = cy - size * 0.5 - 35 + bounce;

      // Rounded rect
      ctx.beginPath();
      ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 4);
      ctx.fill();
      ctx.stroke();

      // Tail
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.moveTo(cx - 3, bubbleY + bubbleH);
      ctx.lineTo(cx, bubbleY + bubbleH + 5);
      ctx.lineTo(cx + 3, bubbleY + bubbleH);
      ctx.fill();

      // Text
      ctx.fillStyle = '#1a1a2e';
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(speechBubble, cx, bubbleY + 12);
    }
  }, [stage, mood, isAlive, speechBubble]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
  }, [draw]);

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
