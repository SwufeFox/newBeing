"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BookmarkCheck, Check, LoaderCircle, Plus, Trash2, WifiOff, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/store/workspace";
import type { MarketSummary } from "@newbeing/market-data/types";
import { EXCHANGE_LABELS, EXCHANGE_QUOTE } from "@/lib/exchanges";
import { AkTag, AkCorner, AkInput } from "@swufefox/ak-ui-react";
import { Decoded } from "@/components/decoded";
import { translate, useCopy, type CopyTable } from "@/lib/i18n";
import { formatQuotePrice } from "@/lib/price-format";

/** Data-transfer key used when a search result is dropped into the watchlist. */
export const WATCHLIST_DRAG_TYPE = "application/x-newbeing-symbol";

function readSummaries(payload: unknown): MarketSummary[] {
  if (typeof payload !== "object" || payload === null || !("items" in payload) || !Array.isArray(payload.items)) return [];
  return payload.items.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("symbol" in item) || typeof item.symbol !== "string") return [];
    return [item as MarketSummary];
  });
}

/** Spot symbols accept the quote currencies supported by the selected venue. */
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/;

interface WatchlistCopy {
  panelTitle: string;
  heading: string;
  add: string;
  cancelAdd: string;
  placeholder: (quote: string) => string;
  symbolLabel: string;
  addAria: string;
  columnSymbol: string;
  columnLast: string;
  reorder: (symbol: string) => string;
  select: (symbol: string) => string;
  remove: (symbol: string) => string;
  empty: string;
  staleError: (error: string) => string;
  retrying: string;
  retry: string;
  invalidPair: string;
  alreadyListed: (symbol: string) => string;
  quotesUnavailable: (exchange: string) => string;
  refreshFailed: string;
}

const WATCHLIST_COPY: CopyTable<WatchlistCopy> = {
  en: {
    panelTitle: "Watchlist · Use [ and ] to cycle symbols",
    heading: "WATCHLIST",
    add: "Add a symbol",
    cancelAdd: "Cancel adding a symbol",
    placeholder: (quote) => `SOL or SOL/${quote}`,
    symbolLabel: "Symbol to add",
    addAria: "Add symbol",
    columnSymbol: "SYMBOL",
    columnLast: "LAST",
    reorder: (symbol) => `Reorder ${symbol}`,
    select: (symbol) => `Select ${symbol}`,
    remove: (symbol) => `Remove ${symbol} from watchlist`,
    empty: "Empty. Add a symbol above, or drag one in from the search field.",
    staleError: (error) => `${error} Showing last successful quotes as stale · retrying automatically.`,
    retrying: "Retrying…",
    retry: "Retry",
    invalidPair: "Use a pair like SOL/USD or SOL/USDT.",
    alreadyListed: (symbol) => `${symbol} is already in the list.`,
    quotesUnavailable: (exchange) => `${exchange} watchlist quotes are unavailable.`,
    refreshFailed: "Could not refresh watchlist quotes.",
  },
  zh: {
    panelTitle: "自选 · 使用 [ 和 ] 切换标的",
    heading: "自选",
    add: "添加标的",
    cancelAdd: "取消添加标的",
    placeholder: (quote) => `SOL 或 SOL/${quote}`,
    symbolLabel: "要添加的标的",
    addAria: "添加标的",
    columnSymbol: "标的",
    columnLast: "最新价",
    reorder: (symbol) => `拖动 ${symbol} 排序`,
    select: (symbol) => `选中 ${symbol}`,
    remove: (symbol) => `将 ${symbol} 移出自选`,
    empty: "暂无标的。在上方添加，或从搜索框拖入。",
    staleError: (error) => `${error} 当前显示上次成功的报价，已标记为过期 · 正在自动重试。`,
    retrying: "重试中…",
    retry: "重试",
    invalidPair: "请使用 SOL/USD 或 SOL/USDT 这样的交易对。",
    alreadyListed: (symbol) => `${symbol} 已在自选列表中。`,
    quotesUnavailable: (exchange) => `${exchange} 自选报价不可用。`,
    refreshFailed: "无法刷新自选报价。",
  },
};

export const Watchlist = memo(function Watchlist({ disabled = false, selectedSummary = null, selectedStale = false }: { disabled?: boolean; selectedSummary?: MarketSummary | null; selectedStale?: boolean }): React.JSX.Element {
  const copy = useCopy(WATCHLIST_COPY);
  const [watchlist, selected, exchange, setSymbol, remove, add, move] = useWorkspaceStore(useShallow((state) => [
    state.watchlist, state.symbol, state.exchange, state.setSymbol,
    state.removeWatchlistSymbol, state.addWatchlistSymbol, state.moveWatchlistSymbol,
  ]));

  const watchlistKey = `${exchange}|${selected}|${watchlist.join(",")}`;
  /* The selected symbol's quote comes from the terminal's own 5s summary poll,
     so the 12s batch skips it instead of asking the venue twice for one row. */
  const batchSymbols = watchlist.filter((item) => item !== selected);
  const symbolsKey = batchSymbols.join(",");
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
  /** Row boxes captured when a drag starts; rows do not move until the drop
   *  commits, so pointermove never has to force a layout read. */
  const rowBoundsRef = useRef<Array<{ top: number; bottom: number }>>([]);

  /** Which row index sits under this viewport Y? */
  const indexAt = useCallback((clientY: number): number | null => {
    const bounds = rowBoundsRef.current;
    for (let i = 0; i < bounds.length; i += 1) {
      const rect = bounds[i];
      if (rect && clientY >= rect.top && clientY <= rect.bottom) return i;
    }
    return null;
  }, []);

  const endGesture = useCallback(() => {
    gesture.current = null;
    rowBoundsRef.current = [];
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

  // ── quotes ───────────────────────────────────────────────────────────────
  // Latest request wins: a newer refresh aborts the in-flight one, and only the
  // request that still owns the current id may publish results or clear the spinner.
  const refreshRequestRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (disabled || batchSymbols.length === 0) return;
    refreshRequestRef.current += 1;
    const requestId = refreshRequestRef.current;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const { signal } = controller;
    const key = watchlistKey;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/market?kind=tickers&exchange=${exchange}&symbols=${encodeURIComponent(symbolsKey)}`, { cache: "no-store", signal });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(translate(WATCHLIST_COPY).quotesUnavailable(EXCHANGE_LABELS[exchange]));
      if (requestId !== refreshRequestRef.current || signal.aborted) return;
      const next = Object.fromEntries(readSummaries(payload).map((summary) => [summary.symbol, summary]));
      setSnapshot({ key, summaries: next, error: null });
    } catch (reason) {
      if (requestId !== refreshRequestRef.current || signal.aborted) return;
      setSnapshot((current) => ({
        key,
        summaries: current?.key === key ? current.summaries : {},
        error: reason instanceof Error ? reason.message : translate(WATCHLIST_COPY).refreshFailed,
      }));
    } finally {
      if (requestId === refreshRequestRef.current && !signal.aborted) {
        refreshControllerRef.current = null;
        setRefreshing(false);
      }
    }
  }, [disabled, exchange, symbolsKey, batchSymbols.length, watchlistKey]);

  useEffect(() => {
    if (disabled || batchSymbols.length === 0) return;
    void refresh();
    const timer = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, 12_000);
    return () => {
      window.clearInterval(timer);
      refreshRequestRef.current += 1;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
    };
  }, [refresh, disabled, watchlist.length, batchSymbols.length]);

  const summaries = !disabled && snapshot?.key === watchlistKey ? snapshot.summaries : {};
  const error = !disabled && snapshot?.key === watchlistKey ? snapshot.error : null;

  const commitAdd = useCallback((raw: string): boolean => {
    const value = raw.trim().toUpperCase().replace(/\s+/g, "").replace(/^([A-Z0-9]+)(USDT|USD)$/, "$1/$2");
    if (!value) return false;
    const symbol = value.includes("/") ? value : `${value}/${EXCHANGE_QUOTE[exchange]}`;
    if (!SYMBOL_PATTERN.test(symbol)) { setAddError(translate(WATCHLIST_COPY).invalidPair); return false; }
    if (watchlist.includes(symbol)) { setAddError(translate(WATCHLIST_COPY).alreadyListed(symbol)); return false; }
    add(symbol);
    setAddError(null);
    setAddOk(true);
    window.setTimeout(() => setAddOk(false), 900);
    return true;
  }, [add, exchange, watchlist]);

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
      <div className="panel-heading" title={copy.panelTitle}>
        <div className="flex items-center gap-1.5">
          <BookmarkCheck size={13} className="text-[var(--ak-signal-info)]" />
          <span className="font-bold tracking-wider text-xs">{copy.heading}</span>
        </div>
        <div className="watchlist-head-actions flex items-center gap-1.5">
          <span className="count-label text-[10px] font-mono px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] font-bold">{watchlist.length}</span>
          <button
            type="button"
            className="watchlist-add-toggle transition-transform active:scale-95"
            aria-label={adding ? copy.cancelAdd : copy.add}
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
            placeholder={copy.placeholder(EXCHANGE_QUOTE[exchange])}
            aria-label={copy.symbolLabel}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            autoFocus
          />
          <button type="submit" aria-label={copy.addAria} disabled={disabled || draft.trim().length === 0} className="transition-transform active:scale-90">
            {addOk ? <Check size={12} className="text-[var(--ak-signal-success)]" /> : <Plus size={12} />}
          </button>
        </form>
      )}
      {addError && <div className="watchlist-add-error" role="alert">{addError}</div>}

      <div className="watchlist-columns"><span>{copy.columnSymbol}</span><span>{copy.columnLast}</span></div>

      <div className="watchlist-rows" ref={listRef}>
        {watchlist.map((symbol, index) => {
          const summary = symbol === selected ? selectedSummary : summaries[symbol] ?? null;
          const base = symbol.split("/")[0] ?? symbol;
          const quote = symbol.split("/")[1] ?? "";
          const change = summary?.changePct24h;
          const isDragging = dragFrom === index;
          const isSelected = symbol === selected;
          const dropAbove = dragOver === index && dragFrom !== null && dragFrom > index;
          const dropBelow = dragOver === index && dragFrom !== null && dragFrom < index;
          const changeFormatted = typeof change === "number" && Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—";
          const isPositive = typeof change === "number" && Number.isFinite(change) && change >= 0;

          return (
            <div
              key={symbol}
              className={[
                "watch-row relative transition-all duration-150",
                isSelected ? "selected shadow-[0_0_12px_rgba(24,209,255,0.15)]" : "",
                (symbol === selected && selectedStale && selectedSummary) || (error && summary) ? "stale" : "",
                isDragging ? "is-dragging opacity-60 scale-[0.98]" : "",
                dropAbove ? "drop-before" : "",
                dropBelow ? "drop-after" : "",
              ].filter(Boolean).join(" ")}
            >
              <span
                className="watch-grip cursor-grab active:cursor-grabbing"
                role="button"
                tabIndex={-1}
                aria-label={copy.reorder(symbol)}
                onPointerDown={(event) => {
                  if (disabled) return;
                  event.preventDefault();
                  gesture.current = { pointerId: event.pointerId, startY: event.clientY, active: false };
                  const rows = listRef.current?.querySelectorAll<HTMLElement>(".watch-row") ?? [];
                  rowBoundsRef.current = Array.from(rows, (row) => {
                    const rect = row.getBoundingClientRect();
                    return { top: rect.top, bottom: rect.bottom };
                  });
                  setDragFrom(index);
                  setDragOver(index);
                }}
              />
              <button
                className="watch-row-main group"
                onClick={() => setSymbol(symbol)}
                title={copy.select(symbol)}
                aria-label={copy.select(symbol)}
                disabled={disabled}
              >
                <span className="watch-symbol">
                  <strong className="group-hover:text-[var(--ak-signal-info)] transition-colors">{base}</strong>
                  <small>/{quote}</small>
                </span>
                <span className="watch-quote">
                  <strong className="tabular-nums font-mono">
                    {summary ? (
                      <Decoded value={formatQuotePrice(summary.last)} trigger={`${symbol}|${summary.last}`} />
                    ) : error ? (
                      /* The request failed: a pulsing placeholder would promise
                         data that is not coming, so the cell settles on the same
                         em dash every other unavailable number uses. */
                      <span className="watch-quote-empty">—</span>
                    ) : (
                      <span className="watch-skeleton" aria-hidden="true" />
                    )}
                  </strong>
                  {summary ? (
                    <AkTag
                      variant={typeof change === "number" ? (isPositive ? "default" : "danger") : "neutral"}
                      className={`text-[10px] px-1 py-0 h-4 min-h-0 tracking-tight leading-none ${isPositive ? "text-[var(--ak-signal-success)]" : ""}`}
                    >
                      {changeFormatted}
                    </AkTag>
                  ) : error ? null : (
                    <span className="watch-skeleton watch-skeleton-short" aria-hidden="true" />
                  )}
                </span>
              </button>
              <button
                className="watch-remove hover:text-[var(--ak-signal-danger)] transition-colors"
                aria-label={copy.remove(symbol)}
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
            <BookmarkCheck size={14} className="text-[var(--ak-signal-action)]" />
            <span>{copy.empty}</span>
          </div>
        )}
        {error && (
          <div className="watchlist-error" role="status">
            <WifiOff size={12} />
            <span>{summaries && Object.keys(summaries).length > 0 ? copy.staleError(error) : error}</span>
            <button className="watchlist-retry" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={11} /> : null}{refreshing ? copy.retrying : copy.retry}</button>
          </div>
        )}
      </div>
    </section>
  );
});
