"use client";

import { useEffect, useState } from "react";
import { Star, Trash2, WifiOff } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/store/workspace";
import type { MarketSummary } from "@newbeing/market-data/types";

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

export function Watchlist({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const [watchlist, selected, setSymbol, remove] = useWorkspaceStore(useShallow((state) => [
    state.watchlist, state.symbol, state.setSymbol, state.removeWatchlistSymbol,
  ]));
  const watchlistKey = watchlist.join(",");
  const [snapshot, setSnapshot] = useState<{ key: string; summaries: Record<string, MarketSummary>; error: string | null } | null>(null);

  useEffect(() => {
    if (disabled || watchlistKey.length === 0) return;
    let stopped = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/market?kind=tickers&symbols=${encodeURIComponent(watchlistKey)}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Binance watchlist quotes are unavailable.");
        const next = Object.fromEntries(readSummaries(payload).map((summary) => [summary.symbol, summary]));
        if (!stopped) setSnapshot({ key: watchlistKey, summaries: next, error: null });
      } catch (reason) {
        if (!stopped) setSnapshot({ key: watchlistKey, summaries: {}, error: reason instanceof Error ? reason.message : "Could not refresh watchlist quotes." });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [watchlistKey, disabled]);

  const summaries = !disabled && snapshot?.key === watchlistKey ? snapshot.summaries : {};
  const error = !disabled && snapshot?.key === watchlistKey ? snapshot.error : null;

  return (
    <section className="watchlist-panel">
      <div className="panel-heading"><div><Star size={13} /><span>WATCHLIST</span></div><span className="count-label">{watchlist.length}</span></div>
      <div className="watchlist-columns"><span>SYMBOL</span><span>LAST</span></div>
      <div className="watchlist-rows">
        {watchlist.map((symbol) => {
          const summary = summaries[symbol];
          const base = symbol.split("/")[0] ?? symbol;
          const change = summary?.changePct24h;
          return (
            <div className={`watch-row ${symbol === selected ? "selected" : ""}`} key={symbol}>
              <button className="watch-row-main" onClick={() => setSymbol(symbol)} title={`Select ${symbol}`} disabled={disabled}>
                <span className="watch-symbol"><strong>{base}</strong><small>USDT</small></span>
                <span className="watch-quote"><strong>{quotePrice(summary?.last)}</strong><small className={typeof change === "number" ? (change >= 0 ? "positive" : "negative") : "muted"}>{typeof change === "number" ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}</small></span>
              </button>
              <button className="watch-remove" aria-label={`Remove ${symbol} from watchlist`} onClick={() => remove(symbol)} disabled={disabled}><Trash2 size={12} /></button>
            </div>
          );
        })}
        {watchlist.length === 0 && <div className="empty-watchlist"><Star size={14} /><span>Your watchlist is empty.</span></div>}
        {error && <div className="watchlist-error"><WifiOff size={12} /><span>{error}</span></div>}
      </div>
      <div className="watchlist-footnote">Public quotes · delayed by exchange/network</div>
    </section>
  );
}
