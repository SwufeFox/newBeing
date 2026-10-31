"use client";

import { useEffect, useState } from "react";
import { Clock3, FastForward, LoaderCircle, Pause, Play, SkipForward, Square, RotateCcw } from "lucide-react";
import type { ReplayConfig, ReplaySession, Timeframe } from "@newbeing/core";
import { AkTag, AkNotice, AkField, AkFieldLabel, AkInput, AkSelect, AkCard, AkNum, AkProgress } from "@swufefox/ak-ui-react";
import { Button } from "@/components/ui/button";

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

  // Global hotkeys for supreme tactile feel: Space = Play/Pause, ArrowRight/N = Step, < / > = Speed
  useEffect(() => {
    if (!session || session.status !== "active") return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        !target ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        Boolean(target.closest?.("input, textarea, select")) ||
        target.isContentEditable ||
        Boolean(target.closest?.(".monaco-editor")) ||
        Boolean(target.closest?.("[contenteditable='true']")) ||
        (event.code === "Space" && target.tagName === "BUTTON")
      ) return;

      if (event.code === "Space") {
        event.preventDefault();
        onTogglePlay();
      } else if (event.code === "ArrowRight" || event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!busy && !playing) onStep();
      } else if (event.key === ">" || event.key === ".") {
        event.preventDefault();
        const speeds = [0.5, 1, 2, 5];
        const nextIdx = Math.min(speeds.length - 1, speeds.indexOf(speed) + 1);
        onSpeedChange(speeds[nextIdx] ?? 1);
      } else if (event.key === "<" || event.key === ",") {
        event.preventDefault();
        const speeds = [0.5, 1, 2, 5];
        const prevIdx = Math.max(0, speeds.indexOf(speed) - 1);
        onSpeedChange(speeds[prevIdx] ?? 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session, playing, busy, speed, onTogglePlay, onStep, onSpeedChange]);

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
          <div className="replay-start-group flex flex-wrap items-end gap-2.5 p-2.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
            <AkField hint="PAST BOUNDARY" className="min-w-[190px] flex-1">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase font-mono">START AT · LOCAL TIME</AkFieldLabel>
                <AkInput
                  type="datetime-local"
                  aria-label="START AT · LOCAL TIME"
                  value={startAt}
                  onChange={(event) => onStartAtChange(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </AkField>

            <AkField hint="SEED WINDOW" className="w-28">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase font-mono">PAST BARS</AkFieldLabel>
                <AkSelect
                  aria-label="PAST BARS"
                  value={limit}
                  onChange={(event) => onLimitChange(Number(event.target.value))}
                  className="text-xs h-8 font-mono font-bold"
                >
                  <option value={120}>120 bars</option>
                  <option value={200}>200 bars</option>
                  <option value={400}>400 bars</option>
                </AkSelect>
              </label>
            </AkField>

            <AkField hint="BASE CAPITAL" className="w-32">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase font-mono">INITIAL CAPITAL</AkFieldLabel>
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

            <AkField hint="PER FILL" className="w-24">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase font-mono">FEE RATE</AkFieldLabel>
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

            <AkField hint="ADVERSE" className="w-24">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase font-mono">SLIPPAGE RATE</AkFieldLabel>
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

            <Button
              data-testid="replay-seed"
              variant="primary"
              disabled={
                busy ||
                !Number.isFinite(Number(initialCapital)) || Number(initialCapital) <= 0 ||
                !Number.isFinite(Number(feeRate)) || Number(feeRate) < 0 || Number(feeRate) > 0.05 ||
                !Number.isFinite(Number(slippageRate)) || Number(slippageRate) < 0 || Number(slippageRate) > 0.05
              }
              onClick={() => {
                const cap = Number(initialCapital);
                const fee = Number(feeRate);
                const slip = Number(slippageRate);
                onStart({
                  initialCapital: Number.isFinite(cap) && cap > 0 ? cap : 10000,
                  feeRate: Number.isFinite(fee) && fee >= 0 ? fee : 0.001,
                  slippageRate: Number.isFinite(slip) && slip >= 0 ? slip : 0.0005,
                });
              }}
              icon={busy ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}
              className="h-8 text-xs font-bold px-4 mb-0.5 whitespace-nowrap ml-auto"
            >
              {busy ? "Loading bars…" : `Seed ${symbol} · ${timeframe}`}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--ak-text-secondary)] flex items-center gap-1.5 opacity-80">
            <span>ℹ️</span> Only completed bars at or before the selected boundary are loaded. Future candles remain strictly hidden until advanced.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--ak-surface-sunken)] px-2 py-1 border border-[var(--ak-border-subtle)]">
            <div className="flex flex-wrap items-center gap-3">
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

            <div className="replay-actions flex items-center gap-2">
              <Button
                variant={playing ? "subtle" : "primary"}
                size="sm"
                disabled={busy || session.status !== "active"}
                onClick={onTogglePlay}
                icon={busy ? <LoaderCircle className="spin" size={13} /> : playing ? <Pause size={13} /> : <Play size={13} />}
                className="h-7 text-xs font-bold"
                title="Shortcut: Space"
              >
                {playing ? "Pause" : "Play"} <span className="opacity-60 text-[10px] ml-1">[Space]</span>
              </Button>

              <Button
                data-testid="replay-step"
                variant="outline"
                size="sm"
                disabled={busy || playing || session.status !== "active"}
                onClick={onStep}
                icon={<SkipForward size={13} />}
                className="h-7 text-xs font-bold"
                title="Shortcut: Right Arrow or N"
              >
                Step <span className="opacity-60 text-[10px] ml-1">[→]</span>
              </Button>

              <div className="flex items-center gap-1.5 bg-[var(--ak-surface-canvas)] px-2 py-0.5 border border-[var(--ak-border)] text-xs" title="Speed shortcuts: < and >">
                <FastForward size={11} className="text-[var(--ak-signal-info)]" />
                <div className="flex gap-0.5">
                  {[0.5, 1, 2, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onSpeedChange(s)}
                      className={`px-1 py-0.5 text-[10px] font-mono transition-transform active:scale-95 ${speed === s ? "text-[var(--ak-signal-info)] font-bold bg-[var(--ak-surface-sunken)]" : "text-[var(--ak-text-secondary)] opacity-70 hover:opacity-100"}`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Replay speed"
                  value={speed}
                  onChange={(event) => onSpeedChange(Number(event.target.value))}
                  className="nb-select bg-transparent text-[11px] font-mono outline-none cursor-pointer border-l border-[var(--ak-border-subtle)] pl-1 ml-0.5"
                  title="Speed shortcuts: < and >"
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={5}>5×</option>
                </select>
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={busy || session.status !== "active"}
                onClick={onFinish}
                icon={<Square size={12} />}
                className="h-7 text-xs"
              >
                Finish
              </Button>

              <Button
                variant="subtle"
                size="sm"
                disabled={busy || playing}
                onClick={onNewSession}
                icon={<RotateCcw size={12} />}
                className="h-7 text-xs"
              >
                New session
              </Button>
            </div>
          </div>

          <div className="pt-1.5 border-t border-[var(--ak-border-subtle)] flex items-center gap-3">
            <div className="flex-1">
              <AkProgress
                label="Timeline revealed"
                min={0}
                max={Math.max(limit + 50, session.bars.length + 10)}
                value={session.bars.length}
                valueLabel={`${session.bars.length} / ${Math.max(limit + 50, session.bars.length + 10)} bars`}
                size="sm"
              />
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--ak-text-secondary)] shrink-0">
              <span>{Math.max(0, session.bars.length - limit)} STEPPED</span>
              <span>·</span>
              <span className={session.status === "active" ? "text-[var(--ak-signal-success)] font-semibold" : "text-[var(--ak-text-disabled)]"}>
                {session.status.toUpperCase()}
              </span>
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
