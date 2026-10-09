"use client";

import { Clock3, FastForward, LoaderCircle, Pause, Play, SkipForward, Square } from "lucide-react";
import type { ReplaySession, Timeframe } from "@newbeing/core";
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
  onStart: () => void;
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
  const cursor = session?.bars.at(-1);
  return <div className="replay-controls">
    <div className="replay-title"><Clock3 size={14} /><strong>REPLAY</strong><span>FUTURE BARS HIDDEN</span></div>
    {!session ? <>
      <div className="replay-start-group">
        <label><span>START AT · LOCAL TIME</span><input type="datetime-local" value={startAt} onChange={(event) => onStartAtChange(event.target.value)} /></label>
        <label><span>PAST BARS</span><select value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}><option value={120}>120</option><option value={200}>200</option><option value={400}>400</option></select></label>
        <Button data-testid="replay-seed" variant="primary" size="sm" disabled={busy} onClick={onStart}>{busy ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}Seed {symbol} · {timeframe}</Button>
      </div>
      <span className="replay-help">Only completed bars at or before the selected time are loaded. Each step requests exactly one next bar from the local server.</span>
    </> : <>
      <div className="replay-session-summary"><strong>{symbol} · {timeframe}</strong><span>{cursor ? new Date(cursor.timestamp).toLocaleString() : "No cursor"}</span><small>{session.bars.length} visible bars · cursor {cursor ? new Date(cursor.timestamp).toISOString() : "—"}</small></div>
      <div className="replay-actions">
        <Button variant="subtle" size="sm" disabled={busy || session.status !== "active"} onClick={onTogglePlay}>{busy ? <LoaderCircle className="spin" size={13} /> : playing ? <Pause size={13} /> : <Play size={13} />}{playing ? "Pause" : "Play"}</Button>
        <Button data-testid="replay-step" variant="outline" size="sm" disabled={busy || playing || session.status !== "active"} onClick={onStep}><SkipForward size={13} />Step</Button>
        <label className="replay-speed"><FastForward size={12} /><select aria-label="Replay speed" value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={5}>5×</option></select></label>
        <Button variant="ghost" size="sm" disabled={busy || session.status !== "active"} onClick={onFinish}><Square size={12} />Finish</Button>
        <Button variant="ghost" size="sm" disabled={busy || playing} onClick={onNewSession}>New session</Button>
      </div>
    </>}
    {error && <div className="replay-error">{error}</div>}
  </div>;
}
