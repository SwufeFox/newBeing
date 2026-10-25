"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Plus, Star, Trash2, WifiOff, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/store/workspace";
import type { MarketSummary } from "@newbeing/market-data/types";
import { AkTag, AkCorner, AkInput } from "@swufefox/ak-ui-react";
import { Decoded } from "@/components/decoded";

/** Data-transfer key used when a search result is dropped into the watchlist. */
export const WATCHLIST_DRAG_TYPE = "application/x-newbeing-symbol";

function readSummaries(payload: unknown): MarketSummary[] {
  if (typeof payload !== "object" || payload === null || !("items" in payload) || !Array.isArray(payload.items)) return [];
  return payload.items.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("symbol" in item) || typeof item.symbol !== "string") return [];
    return [item as MarketSummary];
  });
}

function quotePrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: 6 })
    : "—";
}

/** USDT-quoted pairs only, matching what the rest of the app can trade. */
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/;

export function Watchlist({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const [watchlist, selected, exchange, setSymbol, remove, add, move] = useWorkspaceStore(useShallow((state) => [
    state.watchlist, state.symbol, state.exchange, state.setSymbol,
    state.removeWatchlistSymbol, state.addWatchlistSymbol, state.moveWatchlistSymbol,
  ]));

  const watchlistKey = `${exchange}|${watchlist.join(",")}`;
  const symbolsKey = watchlist.join(",");
  const [snapshot, setSnapshot] = useState<{ key: string; summaries: Record<string, MarketSummary>; error: string | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── add ──────────────────────────────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addOk, setAddOk] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ── reorder ──────────────────────────────────────────────────────────────
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [externalDrop, setExternalDrop] = useState(false);
  const gesture = useRef<{ pointerId: number; startY: number; active: boolean } | null>(null);

  /** Which row index sits under this viewport Y? */
  const indexAt = useCallback((clientY: number): number | null => {
    const list = listRef.current;
    if (!list) return null;
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".watch-row"));
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i]?.getBoundingClientRect();
      if (rect && clientY >= rect.top && clientY <= rect.bottom) return i;
    }
    return null;
  }, []);

  const endGesture = useCallback(() => {
    gesture.current = null;
    setDragFrom(null);
    setDragOver(null);
  }, []);

  useEffect(() => {
    if (dragFrom === null) return;
    const onMove = (event: PointerEvent): void => {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      if (!g.active) {
        if (Math.abs(event.clientY - g.startY) < 4) return; // a click, not a drag
        g.active = true;
      }
      event.preventDefault();
      const over = indexAt(event.clientY);
      if (over !== null) setDragOver(over);
    };
    const onUp = (): void => {
      const target = dragOver;
      const from = dragFrom;
      if (target !== null && from !== null && target !== from) move(watchlist[from] ?? "", target);
      endGesture();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragFrom, dragOver, endGesture, indexAt, move, watchlist]);

  const refresh = useCallback(async (): Promise<void> => {
    if (disabled || watchlist.length === 0) return;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/market?kind=tickers&exchange=${exchange}&symbols=${encodeURIComponent(symbolsKey)}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(`${exchange} watchlist quotes are unavailable.`);
      const next = Object.fromEntries(readSummaries(payload).map((summary) => [summary.symbol, summary]));
      setSnapshot({ key: watchlistKey, summaries: next, error: null });
    } catch (reason) {
      setSnapshot((current) => ({
        key: watchlistKey,
        summaries: current?.key === watchlistKey ? current.summaries : {},
        error: reason instanceof Error ? reason.message : "Could not refresh watchlist quotes.",
      }));
    } finally {
      setRefreshing(false);
    }
  }, [disabled, exchange, symbolsKey, watchlist.length, watchlistKey]);

  useEffect(() => {
    if (disabled || watchlist.length === 0) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(timer);
  }, [refresh, disabled, watchlist.length]);

  const summaries = !disabled && snapshot?.key === watchlistKey ? snapshot.summaries : {};
  const error = !disabled && snapshot?.key === watchlistKey ? snapshot.error : null;

  const commitAdd = useCallback((raw: string): boolean => {
    const value = raw.trim().toUpperCase().replace(/\s+/g, "").replace(/^([A-Z0-9]+)(USDT)$/, "$1/USDT");
    if (!value) return false;
    const symbol = value.includes("/") ? value : `${value}/USDT`;
    if (!SYMBOL_PATTERN.test(symbol)) { setAddError("Use a USDT pair, e.g. SOL/USDT."); return false; }
    if (watchlist.includes(symbol)) { setAddError(`${symbol} is already in the list.`); return false; }
    add(symbol);
    setAddError(null);
    setAddOk(true);
    window.setTimeout(() => setAddOk(false), 900);
    return true;
  }, [add, watchlist]);

  // native drop from the search popover (cross-component path)
  const onPanelDragOver = useCallback((event: React.DragEvent): void => {
    if (disabled) return;
    if (!Array.from(event.dataTransfer.types).includes(WATCHLIST_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setExternalDrop(true);
  }, [disabled]);

  const onPanelDrop = useCallback((event: React.DragEvent): void => {
    setExternalDrop(false);
    if (disabled) return;
    const symbol = event.dataTransfer.getData(WATCHLIST_DRAG_TYPE);
    if (!symbol) return;
    event.preventDefault();
    commitAdd(symbol);
  }, [commitAdd, disabled]);

  return (
    <section
      className={`watchlist-panel${externalDrop ? " is-drop-target" : ""}`}
      onDragOver={onPanelDragOver}
      onDragLeave={() => setExternalDrop(false)}
      onDrop={onPanelDrop}
    >
      <div className="panel-heading">
        <div className="flex items-center gap-1.5">
          <Star size={13} className="text-[var(--ak-signal-action)]" />
          <span className="font-bold tracking-wider">WATCHLIST</span>
          <span className="text-[9px] font-mono text-[var(--c-fg-4)] ml-1" title="Use [ and ] to cycle symbols">[ / ]</span>
        </div>
        <div className="watchlist-head-actions">
          <span className="count-label">{watchlist.length}</span>
          <button
            type="button"
            className="watchlist-add-toggle transition-transform active:scale-95"
            aria-label={adding ? "Cancel adding a symbol" : "Add a symbol"}
            aria-expanded={adding}
            disabled={disabled}
            onClick={() => {
              setAdding((v) => !v);
              setAddError(null);
              setDraft("");
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            {adding ? <X size={12} /> : <Plus size={12} />}
          </button>
        </div>
      </div>

      {adding && (
        <form
          className="watchlist-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (commitAdd(draft)) { setDraft(""); inputRef.current?.focus(); }
          }}
        >
          <input
            ref={inputRef}
            className="ak-input"
            data-slot="ak-input"
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setAddError(null); }}
            placeholder="SOL or SOL/USDT"
            aria-label="Symbol to add"
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            autoFocus
          />
          <button type="submit" aria-label="Add symbol" disabled={disabled || draft.trim().length === 0} className="transition-transform active:scale-90">
            {addOk ? <Check size={12} className="text-[var(--ak-signal-success)]" /> : <Plus size={12} />}
          </button>
        </form>
      )}
      {addError && <div className="watchlist-add-error" role="alert">{addError}</div>}

      <div className="watchlist-columns"><span>SYMBOL</span><span>LAST</span></div>

      <div className="watchlist-rows" ref={listRef}>
        {watchlist.map((symbol, index) => {
          const summary = summaries[symbol];
          const base = symbol.split("/")[0] ?? symbol;
          const quote = symbol.split("/")[1] ?? "";
          const change = summary?.changePct24h;
          const isDragging = dragFrom === index;
          const isSelected = symbol === selected;
          const dropAbove = dragOver === index && dragFrom !== null && dragFrom > index;
          const dropBelow = dragOver === index && dragFrom !== null && dragFrom < index;
          const changeFormatted = typeof change === "number" ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—";
          const isPositive = typeof change === "number" && change >= 0;

          return (
            <div
              key={symbol}
              className={[
                "watch-row relative transition-all duration-150",
                isSelected ? "selected shadow-[0_0_12px_rgba(24,209,255,0.15)]" : "",
                error && summary ? "stale" : "",
                isDragging ? "is-dragging opacity-60 scale-[0.98]" : "",
                dropAbove ? "drop-before" : "",
                dropBelow ? "drop-after" : "",
              ].filter(Boolean).join(" ")}
            >
              {isSelected && <AkCorner position="tl" tone="info" />}
              <span
                className="watch-grip cursor-grab active:cursor-grabbing"
                role="button"
                tabIndex={-1}
                aria-label={`Reorder ${symbol}`}
                onPointerDown={(event) => {
                  if (disabled) return;
                  event.preventDefault();
                  gesture.current = { pointerId: event.pointerId, startY: event.clientY, active: false };
                  setDragFrom(index);
                  setDragOver(index);
                }}
              />
              <button
                className="watch-row-main group"
                onClick={() => setSymbol(symbol)}
                title={`Select ${symbol}`}
                disabled={disabled}
              >
                <span className="watch-symbol">
                  <strong className="group-hover:text-[var(--ak-signal-info)] transition-colors">{base}</strong>
                  <small className="opacity-70">/{quote}</small>
                </span>
                <span className="watch-quote">
                  <strong className="tabular-nums font-mono">
                    <Decoded value={quotePrice(summary?.last)} trigger={`${symbol}|${summary?.last}`} />
                  </strong>
                  <AkTag
                    variant={typeof change === "number" ? (isPositive ? "default" : "danger") : "neutral"}
                    className={`text-[10px] px-1 py-0 h-4 min-h-0 tracking-tight leading-none ${isPositive ? "text-[var(--ak-signal-success)]" : ""}`}
                  >
                    {changeFormatted}
                  </AkTag>
                </span>
              </button>
              <button
                className="watch-remove hover:text-[var(--ak-signal-danger)] transition-colors"
                aria-label={`Remove ${symbol} from watchlist`}
                onClick={() => remove(symbol)}
                disabled={disabled}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}

        {watchlist.length === 0 && (
          <div className="empty-watchlist">
            <Star size={14} className="text-[var(--ak-signal-action)]" />
            <span>Empty. Add a symbol above, or drag one in from the search field.</span>
          </div>
        )}
        {error && (
          <div className="watchlist-error" role="status">
            <WifiOff size={12} />
            <span>{summaries && Object.keys(summaries).length > 0 ? `${error} Showing last successful quotes as stale · retrying automatically.` : error}</span>
            <button className="watchlist-retry" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={11} /> : null}{refreshing ? "Retrying…" : "Retry"}</button>
          </div>
        )}
      </div>

      <div className="watchlist-footnote flex items-center justify-between text-[10px] text-[var(--ak-text-secondary)] opacity-60">
        <span>DRAG TO REORDER</span>
        <span>{exchange.toUpperCase()} SPOT</span>
      </div>
    </section>
  );
}
