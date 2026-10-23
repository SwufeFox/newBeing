"use client";

import { useEffect, useState } from "react";
import { Clock3, FastForward, LoaderCircle, Pause, Play, SkipForward, Square, RotateCcw } from "lucide-react";
import type { ReplayConfig, ReplaySession, Timeframe } from "@newbeing/core";
import { AkButton, AkTag, AkNotice, AkField, AkFieldLabel, AkInput, AkSelect, AkCard, AkNum } from "@swufefox/ak-ui-react";

interface ReplayControlsProps {
  symbol: string;
  timeframe: Timeframe;
  session: ReplaySession | null;
  startAt: string;
  limit: number;
  speed: number;
  playing: boolean;
  busy: boolean;
  error: string | null;
  onStartAtChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onStart: (config: ReplayConfig) => void;
  onTogglePlay: () => void;
  onStep: () => void;
  onFinish: () => void;
  onNewSession: () => void;
}

export function ReplayControls(props: ReplayControlsProps): React.JSX.Element {
  const {
    symbol, timeframe, session, startAt, limit, speed, playing, busy, error,
    onStartAtChange, onLimitChange, onSpeedChange, onStart, onTogglePlay, onStep, onFinish, onNewSession,
  } = props;
  const [initialCapital, setInitialCapital] = useState("10000");
  const [feeRate, setFeeRate] = useState("0.001");
  const [slippageRate, setSlippageRate] = useState("0.0005");
  const cursor = session?.bars.at(-1);

  // Global hotkeys for supreme tactile feel: Space = Play/Pause, ArrowRight/N = Step
  useEffect(() => {
    if (!session || session.status !== "active") return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;

      if (event.code === "Space") {
        event.preventDefault();
        onTogglePlay();
      } else if (event.code === "ArrowRight" || event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!busy && !playing) onStep();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session, playing, busy, onTogglePlay, onStep]);

  return (
    <div className="replay-controls bg-[var(--ak-surface-canvas)] border border-[var(--ak-border-strong)] px-2 py-1.5 relative">
      {/* This strip sits directly above the price chart, so every row it takes comes
          straight out of the candles. It used to stack four redundant announcements
          (title, TIME TRAVEL badge, a long trailing sentence, and a boxed panel).
          Keep the icon + name as the anchor and fold the guarantees into the title
          tooltip — they are reassurance, not controls the user reads each session. */}
      <div
        className="replay-title flex items-center gap-2 pb-1 mb-1.5 border-b border-[var(--ak-border-subtle)]"
        title="Future bars stay hidden; every step is deterministic and reads only the revealed snapshot."
      >
        <Clock3 size={13} className="text-[var(--ak-signal-info)]" />
        <strong className="tracking-wider text-[11px]">Replay simulation</strong>
        <span className="ml-auto text-[10px] font-mono text-[var(--ak-text-secondary)] opacity-60">
          future bars hidden
        </span>
      </div>

      {!session ? (
        <div className="space-y-3">
          <div className="replay-start-group grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 items-end">
            <AkField hint="PAST BOUNDARY">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)]">START AT · LOCAL TIME</AkFieldLabel>
                <AkInput
                  type="datetime-local"
                  aria-label="START AT · LOCAL TIME"
                  value={startAt}
                  onChange={(event) => onStartAtChange(event.target.value)}
                  className="text-xs h-8"
                />
              </label>
            </AkField>

            <AkField hint="SEED WINDOW">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)]">PAST BARS</AkFieldLabel>
                <AkSelect
                  aria-label="PAST BARS"
                  value={limit}
                  onChange={(event) => onLimitChange(Number(event.target.value))}
                  className="text-xs h-8"
                >
                  <option value={120}>120 bars</option>
                  <option value={200}>200 bars</option>
                  <option value={400}>400 bars</option>
                </AkSelect>
              </label>
            </AkField>

            <AkField hint="BASE CAPITAL">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)]">INITIAL CAPITAL · QUOTE</AkFieldLabel>
                <AkInput
                  type="number"
                  aria-label="INITIAL CAPITAL · QUOTE"
                  min="0.01"
                  value={initialCapital}
                  onChange={(event) => setInitialCapital(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </AkField>

            <AkField hint="PER FILL">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)]">FEE RATE</AkFieldLabel>
                <AkInput
                  type="number"
                  aria-label="FEE RATE"
                  min="0"
                  max="0.05"
                  step="0.0001"
                  value={feeRate}
                  onChange={(event) => setFeeRate(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </AkField>

            <AkField hint="ADVERSE">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)]">SLIPPAGE RATE</AkFieldLabel>
                <AkInput
                  type="number"
                  aria-label="SLIPPAGE RATE"
                  min="0"
                  max="0.05"
                  step="0.0001"
                  value={slippageRate}
                  onChange={(event) => setSlippageRate(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </AkField>

            <div className="flex flex-col justify-end">
              <AkButton
                data-testid="replay-seed"
                variant="action"
                disabled={busy}
                onClick={() => onStart({ initialCapital: Number(initialCapital), feeRate: Number(feeRate), slippageRate: Number(slippageRate) })}
                icon={busy ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}
                className="h-8 text-xs font-bold"
              >
                Seed {symbol} · {timeframe}
              </AkButton>
            </div>
          </div>
          <p className="text-[11px] text-[var(--ak-text-secondary)] flex items-center gap-1.5 opacity-80">
            <span>ℹ️</span> Only completed bars at or before the selected boundary are loaded. Future candles remain strictly hidden until advanced.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--ak-surface-sunken)] px-2 py-1 border border-[var(--ak-border-subtle)]">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--ak-signal-info)] animate-pulse" />
                <strong className="font-mono text-xs">{symbol} · {timeframe}</strong>
              </div>
              <span className="text-xs text-[var(--ak-text-secondary)] font-mono">
                Cursor: <AkNum as="span" className="text-[var(--ak-text-primary)]">{cursor ? new Date(cursor.timestamp).toLocaleString() : "—"}</AkNum>
              </span>
              <AkTag variant="neutral" className="text-[10px] font-mono">
                {session.bars.length} BARS REVEALED
              </AkTag>
              {session.candleSource === "local-cache" && (
                <AkTag variant="advanced" className="text-[10px]">
                  LOCAL CACHE
                </AkTag>
              )}
            </div>

            <div className="replay-actions nb-button ak-btn-size-sm flex items-center gap-2">
              <AkButton
                variant={playing ? "default" : "action"}
                disabled={busy || session.status !== "active"}
                onClick={onTogglePlay}
                icon={busy ? <LoaderCircle className="spin" size={13} /> : playing ? <Pause size={13} /> : <Play size={13} />}
                className="h-7 text-xs font-bold"
                title="Shortcut: Space"
              >
                {playing ? "Pause" : "Play"} <span className="opacity-60 text-[10px] ml-1">[Space]</span>
              </AkButton>

              <AkButton
                data-testid="replay-step"
                variant="outline"
                disabled={busy || playing || session.status !== "active"}
                onClick={onStep}
                icon={<SkipForward size={13} />}
                className="h-7 text-xs font-bold"
                title="Shortcut: Right Arrow or N"
              >
                Step <span className="opacity-60 text-[10px] ml-1">[→]</span>
              </AkButton>

              <div className="flex items-center gap-1 bg-[var(--ak-surface-canvas)] px-2 py-0.5 border border-[var(--ak-border)] text-xs">
                <FastForward size={12} className="text-[var(--ak-signal-info)]" />
                <select
                  aria-label="Replay speed"
                  value={speed}
                  onChange={(event) => onSpeedChange(Number(event.target.value))}
                  className="nb-select bg-transparent text-xs font-mono outline-none cursor-pointer"
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={5}>5×</option>
                </select>
              </div>

              <AkButton
                variant="outline"
                disabled={busy || session.status !== "active"}
                onClick={onFinish}
                icon={<Square size={12} />}
                className="h-7 text-xs"
              >
                Finish
              </AkButton>

              <AkButton
                variant="default"
                disabled={busy || playing}
                onClick={onNewSession}
                icon={<RotateCcw size={12} />}
                className="h-7 text-xs"
              >
                New session
              </AkButton>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2">
          <AkNotice variant="danger" code="REPLAY.ERR" title="Transport Alert">
            {error}
          </AkNotice>
        </div>
      )}
    </div>
  );
}
