"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, FastForward, LoaderCircle, Pause, Play, SkipForward, Square, RotateCcw } from "lucide-react";
import type { ReplayConfig, ReplaySession, Timeframe } from "@newbeing/core";
import { AkTag, AkNotice, AkField, AkFieldLabel, AkInput, AkSelect, AkNum, AkDialog } from "@swufefox/ak-ui-react";
import { Button } from "@/components/ui/button";
import { useCopy, type CopyTable } from "@/lib/i18n";

interface ReplayControlsProps {
  symbol: string;
  timeframe: Timeframe;
  session: ReplaySession | null;
  startAt: string;
  limit: number;
  speed: number;
  playing: boolean;
  busy: boolean;
  /** Frozen dataset fully revealed: stepping can never advance again. */
  exhausted?: boolean;
  /** Session contains orders, fills, a position, or notes worth confirming. */
  hasProgress?: boolean;
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

interface ReplayCopy {
  title: string;
  titleHint: string;
  futureHidden: string;
  pastBoundary: string;
  startAt: string;
  seedWindow: string;
  pastBars: string;
  bars: (count: number) => string;
  baseCapital: string;
  initialCapital: string;
  initialCapitalQuote: string;
  perFill: string;
  feeRate: string;
  adverse: string;
  slippageRate: string;
  loadingBars: string;
  seed: (symbol: string, timeframe: string) => string;
  help: string;
  cursor: string;
  barsRevealed: (count: number) => string;
  exhaustedTag: string;
  localCache: string;
  play: string;
  pause: string;
  playTitle: string;
  step: string;
  stepTitle: string;
  speed: string;
  speedTitle: string;
  replaySpeed: string;
  finish: string;
  finishPrompt: string;
  finishConsequence: string;
  finishConfirm: string;
  newSession: string;
  discardPrompt: string;
  discardConfirm: string;
  discardCancel: string;
  statusActive: string;
  statusFinished: string;
  exhaustedTitle: string;
  exhaustedBody: string;
  alertTitle: string;
}

const REPLAY_COPY: CopyTable<ReplayCopy> = {
  en: {
    title: "Replay simulation",
    titleHint: "Future bars stay hidden; every step is deterministic and reads only the revealed snapshot.",
    futureHidden: "future bars hidden",
    pastBoundary: "PAST BOUNDARY",
    startAt: "START AT · LOCAL TIME",
    seedWindow: "SEED WINDOW",
    pastBars: "PAST BARS",
    bars: (count) => `${count} bars`,
    baseCapital: "BASE CAPITAL",
    initialCapital: "INITIAL CAPITAL",
    initialCapitalQuote: "INITIAL CAPITAL · QUOTE",
    perFill: "PER FILL",
    feeRate: "FEE RATE",
    adverse: "ADVERSE",
    slippageRate: "SLIPPAGE RATE",
    loadingBars: "Loading bars…",
    seed: (symbol, timeframe) => `Seed ${symbol} · ${timeframe}`,
    help: "Only completed bars at or before the selected boundary are loaded. Future candles remain strictly hidden until advanced.",
    cursor: "Cursor:",
    barsRevealed: (count) => `${count} BARS ON CHART`,
    exhaustedTag: "DATASET EXHAUSTED",
    localCache: "LOCAL CACHE",
    play: "Play",
    pause: "Pause",
    playTitle: "Shortcut: Space",
    step: "Step",
    stepTitle: "Shortcut: Right Arrow or N",
    speed: "SPEED",
    speedTitle: "Speed shortcuts: < and >",
    replaySpeed: "Replay speed",
    finish: "Finish",
    finishPrompt: "Finish this replay?",
    finishConsequence: "Finishing cancels all pending orders and ends trading and stepping in this session. Open inventory is retained without liquidation. Unsaved notes and tags remain a local draft; use Save notes / tags to include them in the saved journal.",
    finishConfirm: "Finish session",
    newSession: "New session",
    discardPrompt: "Discard this session?",
    discardConfirm: "Discard",
    discardCancel: "Cancel",
    statusActive: "ACTIVE",
    statusFinished: "FINISHED",
    exhaustedTitle: "Frozen dataset fully revealed",
    exhaustedBody: "Every bar in this dataset is now on the chart. Start a new session to keep researching.",
    alertTitle: "Transport Alert",
  },
  zh: {
    title: "回放模拟",
    titleHint: "未来 K 线保持隐藏；每次推进都是确定性的，只读取已揭示的快照。",
    futureHidden: "未来 K 线已隐藏",
    pastBoundary: "过去边界",
    startAt: "开始时间 · 本地时间",
    seedWindow: "种子窗口",
    pastBars: "过去 K 线",
    bars: (count) => `${count} 根 K 线`,
    baseCapital: "基础资金",
    initialCapital: "初始资金",
    initialCapitalQuote: "初始资金 · 报价",
    perFill: "每笔成交",
    feeRate: "费率",
    adverse: "不利方向",
    slippageRate: "滑点率",
    loadingBars: "加载 K 线…",
    seed: (symbol, timeframe) => `初始化 ${symbol} · ${timeframe}`,
    help: "仅加载所选边界之前的已收盘 K 线；在推进前，未来 K 线严格隐藏。",
    cursor: "游标:",
    barsRevealed: (count) => `图表显示 ${count} 根 K 线`,
    exhaustedTag: "数据集已用尽",
    localCache: "本地缓存",
    play: "播放",
    pause: "暂停",
    playTitle: "快捷键：空格",
    step: "步进",
    stepTitle: "快捷键：方向键 → 或 N",
    speed: "速度",
    speedTitle: "速度快捷键：< 和 >",
    replaySpeed: "回放速度",
    finish: "结束",
    finishPrompt: "结束本次回放？",
    finishConsequence: "结束将取消所有待处理委托，并停止本次回放的交易和步进。持仓保留，不会强制平仓。未保存的笔记和标签仍为本地草稿；请使用“保存笔记 / 标签”写入已保存日志。",
    finishConfirm: "结束回放",
    newSession: "新建回放",
    discardPrompt: "放弃本次回放？",
    discardConfirm: "放弃",
    discardCancel: "取消",
    statusActive: "进行中",
    statusFinished: "已结束",
    exhaustedTitle: "冻结数据集已完全揭示",
    exhaustedBody: "该数据集的全部 K 线已显示在图上。新建回放以继续研究。",
    alertTitle: "传输告警",
  },
};

export function ReplayControls(props: ReplayControlsProps): React.JSX.Element {
  const copy = useCopy(REPLAY_COPY);
  const {
    symbol, timeframe, session, startAt, limit, speed, playing, busy, error, exhausted = false, hasProgress = false,
    onStartAtChange, onLimitChange, onSpeedChange, onStart, onTogglePlay, onStep, onFinish, onNewSession,
  } = props;
  const [initialCapital, setInitialCapital] = useState("10000");
  const [feeRate, setFeeRate] = useState("0.001");
  const [slippageRate, setSlippageRate] = useState("0.0005");
  const [confirmNewSessionId, setConfirmNewSessionId] = useState<string | null>(null);
  const confirmNew = confirmNewSessionId !== null && confirmNewSessionId === session?.id;
  const [confirmFinish, setConfirmFinish] = useState(false);
  const newSessionRef = useRef<HTMLButtonElement | null>(null);
  const confirmNewRef = useRef<HTMLButtonElement | null>(null);
  const cursor = session?.bars.at(-1);

  /* A new session replaces the active one in the UI; the server copy becomes
     unreachable. Ask before discarding orders, fills, a position, or notes. */
  useEffect(() => { if (confirmNew) confirmNewRef.current?.focus(); }, [confirmNew]);
  const requestNewSession = (): void => {
    if (!hasProgress) {
      onNewSession();
      return;
    }
    setConfirmNewSessionId(session?.id ?? null);
  };
  const cancelNewSession = (): void => {
    setConfirmNewSessionId(null);
    /* The New session button is mounted only after this state commits. */
    window.setTimeout(() => newSessionRef.current?.focus(), 0);
  };

  // Global hotkeys for supreme tactile feel: Space = Play/Pause, ArrowRight/N = Step, < / > = Speed
  useEffect(() => {
    if (!session || session.status !== "active") return;
    if (confirmFinish) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        !target ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        Boolean(target.closest?.("input, textarea, select")) ||
        target.isContentEditable ||
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
  }, [session, playing, busy, speed, onTogglePlay, onStep, onSpeedChange, confirmFinish]);

  return (
    <div className="replay-controls bg-[var(--ak-surface-canvas)] border border-[var(--ak-border-strong)] px-2 py-1.5 relative">
      {/* This strip sits directly above the price chart, so every row it takes comes
          straight out of the candles. It used to stack four redundant announcements
          (title, TIME TRAVEL badge, a long trailing sentence, and a boxed panel).
          Keep the icon + name as the anchor and fold the guarantees into the title
          tooltip — they are reassurance, not controls the user reads each session. */}
      <div
        className="replay-title flex items-center gap-2 pb-1 mb-1.5 border-b border-[var(--ak-border-subtle)]"
        title={copy.titleHint}
      >
        <Clock3 size={13} className="text-[var(--c-accent)]" />
        <strong className="font-semibold text-xs text-[var(--c-fg)]">{copy.title}</strong>
        <span className="ml-auto text-[10px] font-mono text-[var(--ak-text-secondary)] opacity-60">
          {copy.futureHidden}
        </span>
      </div>

      {!session ? (
        <div className="space-y-3">
          <div className="replay-start-group flex flex-wrap items-end gap-2.5 p-2.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
            <div className="min-w-[190px] flex-1">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-xs text-[var(--ak-text-secondary)] font-medium">{copy.startAt}</AkFieldLabel>
                <AkInput
                  type="datetime-local"
                  aria-label={copy.startAt}
                  value={startAt}
                  onChange={(event) => onStartAtChange(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </div>
            <div className="w-28">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-xs text-[var(--ak-text-secondary)] font-medium">{copy.pastBars}</AkFieldLabel>
                <AkSelect
                  aria-label={copy.pastBars}
                  value={limit}
                  onChange={(event) => onLimitChange(Number(event.target.value))}
                  className="text-xs h-8 font-mono font-bold"
                >
                  <option value={120}>{copy.bars(120)}</option>
                  <option value={200}>{copy.bars(200)}</option>
                  <option value={400}>{copy.bars(400)}</option>
                </AkSelect>
              </label>
            </div>
            <div className="w-32">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-xs text-[var(--ak-text-secondary)] font-medium">{copy.initialCapital}</AkFieldLabel>
                <AkInput
                  type="number"
                  aria-label={copy.initialCapitalQuote}
                  min="0.01"
                  value={initialCapital}
                  onChange={(event) => setInitialCapital(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </div>
            <div className="w-24">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-xs text-[var(--ak-text-secondary)] font-medium">{copy.feeRate}</AkFieldLabel>
                <AkInput
                  type="number"
                  aria-label={copy.feeRate}
                  min="0"
                  max="0.05"
                  step="0.0001"
                  value={feeRate}
                  onChange={(event) => setFeeRate(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </div>
            <div className="w-24">
              <label className="flex flex-col gap-1 w-full">
                <AkFieldLabel className="text-xs text-[var(--ak-text-secondary)] font-medium">{copy.slippageRate}</AkFieldLabel>
                <AkInput
                  type="number"
                  aria-label={copy.slippageRate}
                  min="0"
                  max="0.05"
                  step="0.0001"
                  value={slippageRate}
                  onChange={(event) => setSlippageRate(event.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </label>
            </div>

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
              {busy ? copy.loadingBars : copy.seed(symbol, timeframe)}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--ak-text-secondary)] flex items-center gap-1.5 opacity-80">
            <span>ℹ️</span> {copy.help}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="replay-session-row flex flex-wrap items-center justify-between gap-2 bg-[var(--ak-surface-sunken)] px-2 py-1 border border-[var(--ak-border-subtle)]">
            <div className="replay-session-meta flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full motion-reduce:animate-none ${exhausted ? "bg-[var(--ak-signal-action)]" : "bg-[var(--ak-signal-info)] animate-pulse"}`} />
                <strong className="font-mono text-xs">{symbol} · {timeframe}</strong>
              </div>
              <span className="text-xs text-[var(--ak-text-secondary)] font-mono">
                {copy.cursor} <AkNum as="span" className="text-[var(--ak-text-primary)]">{cursor ? new Date(cursor.timestamp).toLocaleString() : "—"}</AkNum>
              </span>
              <AkTag variant="neutral" className="text-[10px] font-mono">
                {copy.barsRevealed(session.bars.length)}
              </AkTag>
              <AkTag variant="neutral" className="text-[10px] font-mono">
                {session.status === "active" ? copy.statusActive : copy.statusFinished}
              </AkTag>
              {exhausted && session.status === "active" && (
                <AkTag variant="advanced" className="text-[10px]">
                  {copy.exhaustedTag}
                </AkTag>
              )}
              {session.candleSource === "local-cache" && (
                <AkTag variant="advanced" className="text-[10px]">
                  {copy.localCache}
                </AkTag>
              )}
            </div>

            <div className="replay-actions flex flex-wrap items-center gap-2">
              <Button
                variant={playing ? "subtle" : "primary"}
                size="sm"
                disabled={busy || session.status !== "active" || exhausted}
                onClick={onTogglePlay}
                icon={busy ? <LoaderCircle className="spin" size={13} /> : playing ? <Pause size={13} /> : <Play size={13} />}
                className="h-7 text-xs font-bold"
                title={copy.playTitle}
              >
                {playing ? copy.pause : copy.play} <span className="opacity-60 text-[10px] ml-1">[Space]</span>
              </Button>

              <Button
                data-testid="replay-step"
                variant="outline"
                size="sm"
                disabled={busy || playing || session.status !== "active" || exhausted}
                onClick={onStep}
                icon={<SkipForward size={13} />}
                className="h-7 text-xs font-bold"
                title={copy.stepTitle}
              >
                {copy.step} <span className="opacity-60 text-[10px] ml-1">[→]</span>
              </Button>

              <label className="replay-speed-control flex items-center gap-2 bg-[var(--ak-surface-canvas)] px-2 border border-[var(--ak-border)] text-xs" title={copy.speedTitle}>
                <FastForward size={13} className="text-[var(--ak-signal-info)]" />
                <span className="text-[10px] font-mono text-[var(--ak-text-secondary)]">{copy.speed}</span>
                <select
                  aria-label={copy.replaySpeed}
                  value={speed}
                  onChange={(event) => onSpeedChange(Number(event.target.value))}
                  className="nb-select bg-transparent text-xs font-mono outline-none cursor-pointer border-l border-[var(--ak-border-subtle)] pl-2"
                  title={copy.speedTitle}
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={5}>5×</option>
                </select>
              </label>

              <Button
                variant="outline"
                size="sm"
                disabled={busy || session.status !== "active"}
                onClick={() => { if (playing) onTogglePlay(); setConfirmFinish(true); }}
                icon={<Square size={12} />}
                className="h-7 text-xs"
              >
                {copy.finish}
              </Button>

              {confirmNew ? (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="group"
                  aria-label={copy.discardPrompt}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelNewSession();
                    }
                  }}
                >
                  <span role="alert" className="text-[10px] font-mono text-[var(--ak-signal-action)]">{copy.discardPrompt}</span>
                  <button
                    ref={confirmNewRef}
                    type="button"
                    onClick={onNewSession}
                    className="h-7 px-2 border border-[var(--c-down)] bg-[color-mix(in_srgb,var(--c-down)_14%,transparent)] text-[10px] font-bold text-[var(--c-down)] hover:brightness-110"
                  >
                    {copy.discardConfirm}
                  </button>
                  <button
                    type="button"
                    onClick={cancelNewSession}
                    className="h-7 px-2 border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-secondary)] hover:text-[var(--ak-text-primary)]"
                  >
                    {copy.discardCancel}
                  </button>
                </div>
              ) : (
                <button
                  ref={newSessionRef}
                  type="button"
                  disabled={busy || playing}
                  onClick={requestNewSession}
                  className="inline-flex h-7 items-center gap-1.5 px-2 border border-[var(--ak-border)] bg-[var(--ak-surface-raised)] text-xs text-[var(--ak-text-secondary)] hover:text-[var(--ak-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw size={12} />
                  {copy.newSession}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <AkDialog
        open={confirmFinish}
        onOpenChange={setConfirmFinish}
        title={copy.finishPrompt}
        size="sm"
        footer={<div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmFinish(false)}>{copy.discardCancel}</Button>
          <Button variant="danger" disabled={busy} onClick={() => { setConfirmFinish(false); onFinish(); }}>{copy.finishConfirm}</Button>
        </div>}
      >
        <p className="text-xs leading-relaxed">{copy.finishConsequence}</p>
      </AkDialog>
      {exhausted && session?.status === "active" && (
        <div className="mt-2 p-2 border border-[var(--ak-signal-action)]/40 bg-[color-mix(in_srgb,var(--ak-signal-action)_10%,transparent)] text-xs font-mono">
          <strong className="text-[var(--ak-signal-action)] tracking-wider uppercase">{copy.exhaustedTitle}</strong>
          <span className="block opacity-80 mt-0.5">{copy.exhaustedBody}</span>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <AkNotice variant="danger" code="REPLAY.ERR" title={copy.alertTitle}>
            {error}
          </AkNotice>
        </div>
      )}
    </div>
  );
}
