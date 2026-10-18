"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Decoding readout.
 *
 * Rule: **the effect may never add latency.** It only decorates the wait the
 * network already imposes.
 *
 *   subject changes, data unknown  → noise        (free: the user is waiting anyway)
 *   data arrives                   → the real value, immediately
 *   data never arrives             → placeholder after a ceiling, never a spin
 *
 * There is deliberately NO minimum noise duration and NO settle animation on
 * arrival. Both would be self-inflicted delay: the first makes a fast response
 * feel slow, the second keeps the true number unreadable after it is known.
 *
 * The only timer is the ceiling, so a dead feed cannot roll forever.
 */

const DIGITS = "0123456789";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Punctuation holds its place so the string keeps its exact width. */
const FIXED = /[\s,.%+\-—·:/]/;

const isPlaceholder = (v: string): boolean => v === "—" || v === "--" || v === "";

function glyphFor(ch: string, position: number, frame: number): string {
  if (FIXED.test(ch)) return ch;
  const seed = position * 31 + frame * 17;
  if (ch >= "0" && ch <= "9") return DIGITS[(seed * 7919) % DIGITS.length] ?? ch;
  if (/[A-Za-z]/.test(ch)) return LETTERS[(seed * 6151) % LETTERS.length] ?? ch;
  return ch;
}

function noise(template: string, frame: number): string {
  return [...template].map((ch, i) => glyphFor(ch, i, frame)).join("");
}

export type DecodePhase = "idle" | "noise";

/** Hard stop for the rolling state when the data never shows up. */
const NOISE_CEILING_MS = 2200;

export function Decoded({
  value,
  trigger,
  className,
}: {
  value: string;
  /** Changing this restarts the cycle. */
  trigger?: string;
  className?: string;
}): React.JSX.Element {
  const [display, setDisplay] = useState(value);
  const [phase, setPhase] = useState<DecodePhase>("idle");

  const raf = useRef<number | null>(null);
  const mounted = useRef(false);
  const lastTrigger = useRef(trigger);
  const lastValue = useRef(value);
  const rolling = useRef(false);
  const noiseStart = useRef(0);
  const truth = useRef(value);

  const stopRoll = (): void => {
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    rolling.current = false;
    setPhase("idle");
  };

  useEffect(() => {
    const triggerChanged = lastTrigger.current !== trigger;
    const valueChanged = lastValue.current !== value;
    lastTrigger.current = trigger;
    lastValue.current = value;
    truth.current = value;

    if (!mounted.current) {
      mounted.current = true;
      setDisplay(value);
      return;
    }

    if (!triggerChanged && !valueChanged) return;

    const showNow = (v: string): void => {
      stopRoll();
      setDisplay(v);
    };

    const startRoll = (template: string): void => {
      if (rolling.current) return;      // already rolling; just keep going
      stopRoll();
      rolling.current = true;
      setPhase("noise");
      noiseStart.current = performance.now();
      const frame = (now: number): void => {
        if (!rolling.current) return;
        if (now - noiseStart.current > NOISE_CEILING_MS) {
          // The feed never answered. Stop pretending and show the truth.
          rolling.current = false;
          setDisplay(isPlaceholder(truth.current) ? "—" : truth.current);
          setPhase("idle");
          raf.current = null;
          return;
        }
        setDisplay(noise(template, Math.floor(now / 46)));
        raf.current = requestAnimationFrame(frame);
      };
      raf.current = requestAnimationFrame(frame);
    };

    if (triggerChanged) {
      // A new subject: if we already have its value (cache / same tick) show it
      // at once; otherwise roll — the roll runs only while we truly have nothing.
      if (isPlaceholder(value)) startRoll("0000.00");
      else showNow(value);
      return;
    }

    // Same subject, the value moved.
    if (isPlaceholder(value)) {
      startRoll("0000.00");
      return;
    }

    // Data landed. Show it this frame — no minimum wait, no settle.
    showNow(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, trigger]);

  useEffect(() => stopRoll, []);

  return (
    <span className={className} data-phase={phase} aria-label={value}>
      <span aria-hidden="true">{display}</span>
    </span>
  );
}
