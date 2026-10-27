"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AkBrackets, AkInput, AkPopover, AkSelect, AkTag } from "@swufefox/ak-ui-react";
import type { Candle } from "@newbeing/core";
import { CandlestickSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { DerivativeInstrument, DerivativeKind, DerivativeQuote } from "@newbeing/market-data/derivatives";
import type { DerivativesAccount, DerivativesOrderRequest, DerivativesPosition } from "@newbeing/application/derivatives-types";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/store/workspace";
import { derivativeNumber, derivativeDate, derivativeBlockReason, derivativeUnrealized, derivativeOptionChain, derivativeExpiryLabel, derivativeQuoteSnapshotIsStale } from "@/lib/derivatives-ui";

const KINDS = [["perpetual", "Perpetuals"], ["future", "Futures"], ["option", "Options"]] as const;

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Derivatives request failed.");
  return payload as T;
}

function optionQuoteNumber(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumSignificantDigits: 7 }) : "—";
}

function exchangeErrorMessage(error: unknown, resource: string): string {
  const detail = error instanceof Error ? error.message : "";
  if (/fetch failed|failed to fetch|network(?:error| error)?|econn|enotfound|etimedout|timed? out|socket/i.test(detail)) {
    return `Exchange ${resource} is temporarily unreachable. Check your internet connection or exchange access, then retry. Your local Paper ledger is stored separately.`;
  }
  return `Could not load exchange ${resource}${detail ? `: ${detail}` : "."} Your local Paper ledger is still available.`;
}

function QuoteFreshSubmit({ instrument, quote, disabled, submitting }: {
  instrument: DerivativeInstrument | null;
  quote: DerivativeQuote | null;
  disabled: boolean;
  submitting: boolean;
}): React.JSX.Element {
  /* Keep time state inside this tiny leaf. A stale-quote tick must not cause
     the contracts, option chain, or candlestick chart to render again. */
  const [now, setNow] = useState(0);
  useEffect(() => {
    const immediate = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(immediate); window.clearInterval(timer); };
  }, []);
  const reason = now > 0 ? derivativeBlockReason(instrument, quote, now) : "Checking quote freshness.";
  return <>
    <Button type="submit" block variant="primary" disabled={disabled || !quote || !instrument || now === 0 || !!reason}>
      {submitting ? "Submitting…" : "Submit Paper order"}
    </Button>
    {quote && now > 0 && reason && <p role="status" className="derivatives-ticket-note alert">
      {reason.toLowerCase().includes("stale") ? "Quote is stale — refresh before submitting." : reason}
    </p>}
  </>;
}

function OptionSnapshot({ quote, stale }: { quote: DerivativeQuote | undefined; stale: boolean }): React.JSX.Element {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    if (!quote) return;
    const delay = Math.max(0, quote.timestamp + 30_001 - Date.now());
    const timer = window.setTimeout(update, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [quote]);
  const isStale = stale || (now > 0 && !!quote && derivativeQuoteSnapshotIsStale(quote, now));
  return <span className="num block truncate text-[9px] leading-tight" title={quote ? `Exchange snapshot ${derivativeDate(quote.timestamp)} · reference only` : "No public book snapshot"}>
    {isStale && <b className="text-[var(--c-down)]">STALE · </b>}
    B {optionQuoteNumber(quote?.bid ?? null)} · M {optionQuoteNumber(quote?.mark ?? null)} · A {optionQuoteNumber(quote?.ask ?? null)}
  </span>;
}

function PositionRow({ position, quote, busy, onClose }: { position: DerivativesPosition; quote: DerivativeQuote | null; busy: boolean; onClose: (position: DerivativesPosition) => void }): React.JSX.Element {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const matchingQuote = quote?.instrumentId === position.instrumentId && now > 0 && Number.isFinite(quote.timestamp) && quote.timestamp > 0 && now >= quote.timestamp && now - quote.timestamp <= 15_000 ? quote : null;
  const unrealized = derivativeUnrealized(position, matchingQuote?.mark ?? null, now);
  return <tr>
    <td className="max-w-0 truncate" title={position.instrumentId}>{position.instrumentId}</td>
    <td>{position.side}</td><td>{position.quantity}</td><td>{position.entryPrice}</td><td>{position.margin} · {position.leverage}x</td>
    <td className={unrealized == null ? "" : unrealized < 0 ? "down" : unrealized > 0 ? "up" : ""}>{unrealized === null ? "—" : `${unrealized > 0 ? "+" : ""}${unrealized}`}</td>
    <td>{position.expiry !== null && now > 0 && position.expiry <= now ? <span className="meta">Frozen</span> : <Button size="sm" variant="outline" disabled={busy} onClick={() => onClose(position)}>Close</Button>}</td>
  </tr>;
}

function LocalAccountLedger({ accounts, readOnly = false, onSelectPosition }: {
  accounts: DerivativesAccount[];
  readOnly?: boolean;
  onSelectPosition?: (position: DerivativesPosition, settle: string) => void;
}): React.JSX.Element {
  return <div className="space-y-2">
    <p className="meta">{readOnly ? "Frozen Replay snapshot · local SQLite · read only" : "Local Paper ledger · read only without a live quote"}</p>
    {accounts.map((entry) => <details key={entry.id} className="derivatives-details" open={accounts.length === 1}>
      <summary className="flex items-center justify-between gap-3">
        <span>{entry.venue.toUpperCase()} / {entry.settle}</span>
        <span className="num">{entry.available} {entry.settle}</span>
      </summary>
      <div className="mt-2 space-y-3">
        <dl className="derivatives-account-grid">
          <div><dt>Realized P&amp;L</dt><dd>{entry.realizedPnl} <small>{entry.settle}</small></dd></div>
          <div><dt>Fees paid</dt><dd>{entry.feesPaid} <small>{entry.settle}</small></dd></div>
        </dl>
        <div>
          <span className="meta">Positions · {entry.positions.length}</span>
          {!entry.positions.length ? <p className="mt-1 text-[var(--c-fg-4)] text-[11px]">No open positions.</p>
            : <div className="derivatives-table-scroll mt-1 border border-[var(--c-line)]">
              <table className="derivatives-table">
                <thead><tr>{["Instrument", "Side", "Qty", "Entry", "Margin"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
                <tbody>{entry.positions.map((position) => <tr key={`${position.instrumentId}:${position.side}`}>
                  <td className="max-w-0 truncate" title={position.instrumentId}>
                    {readOnly || !onSelectPosition ? position.instrumentId : <button type="button" className="max-w-full truncate text-left text-[var(--c-accent)] underline decoration-dotted underline-offset-2 hover:opacity-80" aria-label={`View position ${position.instrumentId}`} onClick={() => onSelectPosition(position, entry.settle)}>{position.instrumentId}</button>}
                  </td>
                  <td>{position.side}</td><td>{position.quantity}</td><td>{position.entryPrice}</td><td>{position.margin} · {position.leverage}x</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </div>
        <details className="derivatives-details" open={accounts.length === 1 && entry.orders.length > 0}>
          <summary>Order history · {entry.orders.length}</summary>
          {!entry.orders.length ? <p className="mt-1 text-[var(--c-fg-4)] text-[11px]">No Paper fills.</p>
            : <div className="derivatives-table-scroll mt-1 border border-[var(--c-line)]">
              <table className="derivatives-table">
                <thead><tr>{["Time (UTC)", "Instrument", "Action", "Qty", "Fill", "Fee"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
                <tbody>{entry.orders.slice(-20).reverse().map((order) => <tr key={order.clientOrderId}>
                  <td>{derivativeDate(order.createdAt)}</td><td className="max-w-0 truncate" title={order.instrumentId}>{order.instrumentId}</td>
                  <td>{order.action} {order.side}</td><td>{order.quantity}</td><td>{order.fillPrice}</td><td>{order.fee}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </details>
      </div>
    </details>)}
    <p className="derivatives-ticket-note">{readOnly ? "Position navigation and Paper actions are disabled in Replay; this snapshot is read only." : "Balances and history are local. Select a position to load its contract; orders stay disabled until exchange metadata and a fresh quote are available."}</p>
  </div>;
}

function EngineModel(): React.JSX.Element {
  return <AkPopover trigger={<Button size="sm" variant="outline">Engine model</Button>} title="Local isolated Paper" eyebrow="EXECUTION POLICY">
    <div className="space-y-2 text-xs">
      <p>Paper fills use fresh native bid / ask quotes and explicit price protection. No orders are sent to an exchange.</p>
      <p>Each position has local isolated margin. Contract trading losses are capped at allocated collateral; exchange liquidation is not simulated. Fees are charged separately.</p>
      <p>Funding is displayed when available, but is not accrued without an official funding ledger.</p>
      <p>Expired contracts freeze awaiting official settlement. No synthetic settlement or automatic exercise is applied.</p>
      <p>Options support buy-to-open and sell-to-close long positions at 1x. Premiums and prices are in settle currency per base coin; quantities are contracts.</p>
      <p>Unknown fields remain unavailable (—). Test fixtures are labelled and only available in the E2E test process.</p>
    </div>
  </AkPopover>;
}

const CandleSeries = memo(function CandleSeries({ bars }: { bars: Candle[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fittedRef = useRef(false);
  const theme = useWorkspaceStore((state) => state.theme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const dark = theme === "dark";
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: dark ? "#0d1117" : "#ffffff" },
        textColor: dark ? "#8b949e" : "#64748b",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: dark ? "rgba(139,148,158,0.07)" : "rgba(100,116,139,0.10)" },
        horzLines: { color: dark ? "rgba(139,148,158,0.07)" : "rgba(100,116,139,0.10)" },
      },
      rightPriceScale: { borderColor: dark ? "rgba(139,148,158,0.18)" : "rgba(100,116,139,0.20)" },
      timeScale: { borderColor: dark ? "rgba(139,148,158,0.18)" : "rgba(100,116,139,0.20)", timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#1fb180",
      downColor: "#ea525e",
      borderUpColor: "#1fb180",
      borderDownColor: "#ea525e",
      wickUpColor: "#1fb180",
      wickDownColor: "#ea525e",
    });
    chartRef.current = chart;
    fittedRef.current = false;
    seriesRef.current = series;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart.applyOptions({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const uniqueBars = new Map<number, Candle>();
    for (const bar of bars) {
      const time = Math.floor(bar.timestamp / 1000);
      if (Number.isFinite(time)) uniqueBars.set(time, bar);
    }
    const data = [...uniqueBars.entries()]
      .sort(([left], [right]) => left - right)
      .map(([time, bar]) => ({
        time: time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
    seriesRef.current?.setData(data);
    if (data.length > 0 && !fittedRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [bars, theme]);

  return <div ref={containerRef} className="h-48 w-full" role="img" aria-label="Contract OHLC candles, 1 hour" />;
});
export function DerivativesWorkspace(): React.JSX.Element {
  const globalWorkspace = useWorkspaceStore((state) => state.activeWorkspace);
  const [remoteReplay, setRemoteReplay] = useState<boolean | null>(null);
  const [kind, setKind] = useState<DerivativeKind>("perpetual");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DerivativeInstrument[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [market, setMarket] = useState<{ instrument: DerivativeInstrument; quote: DerivativeQuote } | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [bars, setBars] = useState<Candle[]>([]);
  const [candleError, setCandleError] = useState<string | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<DerivativesAccount[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "alert"; text: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [ledgerRevision, setLedgerRevision] = useState(0);
  const [action, setAction] = useState<"open" | "close">("open");
  const [side, setSide] = useState<"long" | "short">("long");
  const [quantity, setQuantity] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [chainKey, setChainKey] = useState<string | null>(null);
  const [optionQuoteData, setOptionQuoteData] = useState<{ key: string; quotes: Record<string, DerivativeQuote>; staleIds: string[]; error: string | null }>({ key: "", quotes: {}, staleIds: [], error: null });
  /* The account list is a local SQLite snapshot, independent of market data.
     The clock that gates order freshness lives in QuoteFreshSubmit, a leaf. */
  const pendingOrder = useRef<DerivativesOrderRequest | null>(null);
  const mutationLock = useRef(false);
  /* remoteReplay null = first poll still outstanding: hide the markets rather
     than flashing a boundary banner that usually resolves to "available". */
  const blocked = globalWorkspace === "replay" || remoteReplay === true;
  const instrument = !blocked && market?.instrument.id === selectedId ? market.instrument : null;
  const quote = !blocked && market?.quote.instrumentId === selectedId && !marketError ? market.quote : null;
  const initialBalance = instrument?.settle === "BTC" ? "1" : instrument?.settle === "ETH" ? "10" : "10000";
  const account = instrument && !blocked ? ledgerAccounts?.find((entry) => entry.venue === instrument.venue && entry.settle === instrument.settle) ?? null : null;
  const accountReady = !blocked && ledgerAccounts !== null && ledgerError === null;

  // Read the shared boundary, without mounting WorkspaceSync or writing spot state.
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      try {
        const data = await readJson<{ state: { activeWorkspace: string } }>("/api/workspace");
        if (!disposed) setRemoteReplay(data.state.activeWorkspace === "replay");
      } catch { if (!disposed) setRemoteReplay(null); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readJson<{ accounts: DerivativesAccount[] }>("/api/derivatives/accounts", { signal: controller.signal })
      .then((data) => { setLedgerAccounts(data.accounts); setLedgerError(null); })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setLedgerAccounts(null); setLedgerError(error instanceof Error ? error.message : "Local account ledger unavailable."); } });
    return () => controller.abort();
  }, [blocked, ledgerRevision]);
  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setListLoading(true); setListError(null);
      void readJson<{ instruments: DerivativeInstrument[] }>(`/api/derivatives/markets?kind=${kind}&query=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((data) => {
          setItems(data.instruments);
          setSelectedId((id) => id || data.instruments[0]?.id || "");
        }).catch((error: unknown) => { if (!controller.signal.aborted) { setItems([]); setListError(exchangeErrorMessage(error, "contracts")); } })
        .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, query, revision, blocked]);


  useEffect(() => {
    if (blocked || !selectedId) return;
    let disposed = false;
    let inFlight = false;
    let retryTimer = 0;
    let delay = 5000;
    const controller = new AbortController();

    const schedule = () => {
      retryTimer = window.setTimeout(() => {
        if (disposed || controller.signal.aborted) return;
        if (document.hidden) { schedule(); return; }
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const data = await readJson<{ instrument: DerivativeInstrument; quote: DerivativeQuote; candles: Candle[]; candleError: string | null }>(`/api/derivatives/market?instrumentId=${encodeURIComponent(selectedId)}`, { signal: controller.signal });
        if (!disposed) { setMarket(data); setMarketError(null); setBars(data.candles); setCandleError(data.candleError); }
        delay = 5000;
      } catch (error) {
        if (!disposed) { setMarket(null); setMarketError(exchangeErrorMessage(error, "quote")); }
        delay = Math.min(delay * 2, 60000);
      } finally {
        inFlight = false;
        if (!disposed && !controller.signal.aborted) schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden || inFlight) return;
      window.clearTimeout(retryTimer);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refresh();

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedId, revision, blocked]);

  function select(id: string): void {
    if (id === selectedId) return;
    setSelectedId(id); setMarket(null); setMarketError(null); setBars([]); setCandleError(null);
    setMaximumPrice(""); setQuantity(""); setNotice(null);
  }
  function changeKind(next: DerivativeKind): void {
    setKind(next); setItems([]); setListLoading(true); select(""); setSide("long"); setLeverage("1"); setAction("open"); setChainKey(null);
  }

  const changeKindRef = useRef(changeKind);
  changeKindRef.current = changeKind;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (blocked) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (event.altKey && event.key === "1") {
        event.preventDefault();
        changeKindRef.current("perpetual");
      } else if (event.altKey && event.key === "2") {
        event.preventDefault();
        changeKindRef.current("future");
      } else if (event.altKey && event.key === "3") {
        event.preventDefault();
        changeKindRef.current("option");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [blocked]);

  const stepContracts = (direction: -1 | 1): void => {
    const current = Number(quantity) || 0;
    const step = instrument?.quantityStep ?? (current >= 1 ? 1 : 0.01);
    const next = Math.max(instrument?.minContracts ?? step, Number((current + direction * step).toFixed(4)));
    setQuantity(String(next));
  };

  const sizeDerivativesBudget = (fraction: number): void => {
    if (!account || !instrument || !quote) return;
    const avail = Number(account.available) || 0;
    const refPrice = Number(quote.mark || quote.bid || maximumPrice) || 0;
    if (avail <= 0 || refPrice <= 0) return;
    const lev = Number(leverage) || 1;
    const cSize = instrument.contractSize || 1;
    const marginPerContract = (cSize * refPrice) / lev;
    if (marginPerContract <= 0) return;
    const budget = avail * fraction;
    const step = instrument.quantityStep || 1;
    const contracts = Math.floor((budget / marginPerContract) / step) * step;
    if (contracts > 0) {
      setQuantity(String(Number(contracts.toFixed(4))));
    }
  };
  function selectPosition(position: DerivativesPosition, settle?: string): void {
    // A settlement account can contain several contracts, and Deribit USDC
    // accounts can mix dated futures and options. Any ledger jump must switch
    // the whole workspace to that exact native contract.
    if (position.kind !== kind) {
      setKind(position.kind);
      setItems([]);
      setListLoading(true);
      setChainKey(null);
      setSide("long"); setLeverage("1"); setAction("open");
    }
    if (position.kind === "option" && position.expiry !== null) {
      const nativeId = position.instrumentId.split(":").slice(2).join(":");
      const base = nativeId.split(/[-_]/, 1)[0];
      const settlement = settle ?? account?.settle;
      if (base && settlement) setChainKey(`${position.expiry}:${base}:${settlement}`);
    }
    select(position.instrumentId);
  }
  function beginClose(position: DerivativesPosition): void {
    // Pre-fill the exact position terms so a close is ready after its own quote loads.
    selectPosition(position, account?.settle);
    setAction("close"); setSide(position.side); setLeverage(String(position.leverage)); setQuantity(position.quantity);
    setNotice(null);
  }
  // Render-time validation uses the quote's timestamp. The submit handler and
  // QuoteFreshSubmit recheck against the wall clock without ticking this tree.
  const reason = quote ? derivativeBlockReason(instrument, quote, quote.timestamp) : instrument ? "A matching two-sided fresh native quote is required for Paper execution." : "Select a contract with native metadata.";
  const validOrder = /^\d+(?:\.\d+)?$/.test(quantity) && Number(quantity) > 0 && /^\d+(?:\.\d+)?$/.test(maximumPrice) && Number(maximumPrice) > 0 && Number.isInteger(Number(leverage)) && Number(leverage) >= 1 && Number(leverage) <= 20;

  async function command(openAccount: boolean): Promise<void> {
    if (mutationLock.current || blocked || !instrument || !accountReady) return;
    const currentReason = quote ? derivativeBlockReason(instrument, quote, Date.now()) : reason;
    if (!openAccount && (currentReason || !validOrder)) {
      setNotice({ tone: "alert", text: currentReason ?? "Enter a valid quantity, leverage, and price protection before submitting." });
      return;
    }
    mutationLock.current = true; setBusy(true); setNotice(null);
    try {
      let body: object;
      if (openAccount) body = { action: "open", instrumentId: instrument.id };
      else {
        const draft = { venue: instrument.venue, settle: instrument.settle, instrumentId: instrument.id, action, side, quantity, leverage: Number(leverage), reduceOnly: action === "close", maximumPrice };
        const previous = pendingOrder.current;
        const { clientOrderId: _id, ...previousDraft } = previous ?? { clientOrderId: "" };
        void _id;
        const request = previous && JSON.stringify(previousDraft) === JSON.stringify(draft) ? previous : { ...draft, clientOrderId: crypto.randomUUID() };
        pendingOrder.current = request;
        body = { action: "order", instrumentId: request.instrumentId, clientOrderId: request.clientOrderId, side: (request.action === "open") === (request.side === "long") ? "buy" : "sell", contracts: request.quantity, leverage: request.leverage, reduceOnly: request.reduceOnly, limitPrice: request.maximumPrice };
      }
      const data = await readJson<{ account: DerivativesAccount; deduplicated?: boolean }>("/api/derivatives/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setLedgerAccounts((current) => [...(current ?? []).filter((entry) => entry.id !== data.account.id), data.account]);
      setNotice({ tone: "good", text: openAccount ? "Local Paper account opened." : data.deduplicated ? "Previously filled order confirmed." : "Paper order filled." });
      pendingOrder.current = null;
    } catch (error) {
      setNotice({ tone: "alert", text: `${error instanceof Error ? error.message : "Paper command failed."} Refresh the local ledger to confirm the outcome before changing this order. Retrying unchanged order details uses the same client order ID.` });
    } finally { mutationLock.current = false; setBusy(false); }
  }

  /* Grouping ~100 options runs on every render otherwise; items only change on
     list refetch, so the chain is keyed to that, not to clock ticks. */
  const chain = useMemo(() => (kind === "option" ? derivativeOptionChain(items) : []), [kind, items]);
  const activeChain = useMemo(
    () => chain.find((entry) => entry.key === chainKey) ?? chain[0] ?? null,
    [chain, chainKey],
  );
  const optionQuoteIds = useMemo(
    () => activeChain ? activeChain.rows.flatMap((row) => [row.call?.id, row.put?.id].filter((id): id is string => !!id)) : [],
    [activeChain],
  );
  const optionQuoteKey = optionQuoteIds.join("|");
  const currentOptionQuoteData = optionQuoteData.key === optionQuoteKey ? optionQuoteData : null;
  const optionQuotes = currentOptionQuoteData?.quotes ?? {};
  const staleOptionQuoteIds = useMemo(() => new Set(currentOptionQuoteData?.staleIds ?? []), [currentOptionQuoteData]);
  const optionQuoteError = currentOptionQuoteData?.error ?? null;

  useEffect(() => {
    if (blocked || kind !== "option" || optionQuoteIds.length === 0) return;
    let disposed = false;
    let inFlight = false;
    let retryTimer = 0;
    let delay = 5000;
    const controller = new AbortController();

    const schedule = () => {
      retryTimer = window.setTimeout(() => {
        if (disposed || controller.signal.aborted) return;
        if (document.hidden) { schedule(); return; }
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const data = await readJson<{ quotes: DerivativeQuote[]; asOf: number }>("/api/derivatives/options/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrumentIds: optionQuoteIds }),
          signal: controller.signal,
        });
        if (!disposed) {
          const asOf = Number.isFinite(data.asOf) ? data.asOf : Date.now();
          setOptionQuoteData({
            key: optionQuoteKey,
            quotes: Object.fromEntries(data.quotes.map((item) => [item.instrumentId, item])),
            staleIds: data.quotes.filter((item) => derivativeQuoteSnapshotIsStale(item, asOf)).map((item) => item.instrumentId),
            error: null,
          });
        }
        delay = 5000;
      } catch (error) {
        if (!disposed && !controller.signal.aborted) {
          setOptionQuoteData((current) => current.key === optionQuoteKey
            ? { ...current, error: exchangeErrorMessage(error, "option-chain quotes") }
            : { key: optionQuoteKey, quotes: {}, staleIds: [], error: exchangeErrorMessage(error, "option-chain quotes") });
        }
        delay = Math.min(delay * 2, 60_000);
      } finally {
        inFlight = false;
        if (!disposed && !controller.signal.aborted) schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        setOptionQuoteData((current) => current.key === optionQuoteKey ? { ...current, staleIds: optionQuoteIds } : current);
        return;
      }
      if (inFlight) return;
      window.clearTimeout(retryTimer);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [blocked, kind, optionQuoteIds, optionQuoteKey, revision]);


  return <div className="derivatives-shell font-mono">
    <header className="derivatives-topbar">
      <Link href="/" className="derivatives-brand">
        <AkBrackets className="flex items-center gap-1">
          <span>newBeing</span>
          <em>PRTS</em>
        </AkBrackets>
      </Link>
      <h1 className="meta">/ Derivatives</h1>
      <AkTag variant="advanced">PAPER · LIVE OFF</AkTag>
      <div className="flex-1" />
      <EngineModel />
      <Link href="/" className="meta hover:text-[var(--c-fg)]">← Back to terminal</Link>
    </header>

    {/* market plate: same grammar as the terminal's market-heading */}
    <div className="derivatives-plate">
      <div className="derivatives-identity">
        <span className="eyebrow">
          {instrument ? `${instrument.venue === "okx" ? "OKX" : "Deribit"} · ${kind === "perpetual" ? "PERPETUAL SWAP" : kind === "future" ? "DATED FUTURE" : "OPTION"}` : "SELECT A CONTRACT"}
        </span>
        <span className="title">
          <span className="truncate" title={instrument?.nativeId}>{instrument ? instrument.nativeId : <span className="text-[var(--c-fg-3)]">—</span>}</span>
          {instrument && <small>{instrument.settle}</small>}
        </span>
      </div>
      {instrument && quote && <>
        <div className="derivatives-quote">
          <span className="side bid"><span className="value">{derivativeNumber(quote.bid)}</span><span className="tag">Bid</span></span>
          <span className="side ask"><span className="value">{derivativeNumber(quote.ask)}</span><span className="tag">Ask</span></span>
        </div>
        <dl className="derivatives-context">
          <div className="kv"><dt>Mark</dt><dd>{derivativeNumber(quote.mark)}</dd></div>
          <div className="kv"><dt>Index</dt><dd>{derivativeNumber(quote.index)}</dd></div>
          {instrument.kind === "option" && <div className="kv"><dt>Strike</dt><dd>{derivativeNumber(instrument.strike)} {instrument.quote}</dd></div>}
          {instrument.kind === "option" && quote.iv != null && <div className="kv"><dt>IV</dt><dd>{(quote.iv * 100).toFixed(1)}%</dd></div>}
          {instrument.kind === "option" && quote.delta != null && <div className="kv"><dt>Delta</dt><dd>{derivativeNumber(quote.delta)}</dd></div>}
          {instrument.kind !== "option" && <div className="kv"><dt>Expiry</dt><dd>{instrument.kind === "perpetual" ? "Perpetual" : derivativeDate(instrument.expiry)}</dd></div>}
          {quote.fundingRate != null && <div className="kv"><dt>Funding</dt><dd>{(quote.fundingRate * 100).toFixed(4)}%</dd></div>}
          {quote.openInterest != null && <div className="kv"><dt>OI</dt><dd>{derivativeNumber(quote.openInterest)}</dd></div>}
        </dl>
      </>}
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <AkTag variant={quote?.source === "fixture" ? "danger" : "default"}>
          {quote?.source === "fixture" ? "FIXTURE · TEST DATA" : quote ? "PUBLIC REALTIME" : "NO QUOTE"}
        </AkTag>
        {!blocked && <Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision((n) => n + 1)}>Refresh</Button>}
      </div>
    </div>

    {blocked && <div role="status" className="derivatives-banner">
      <span>Live derivative markets and Paper actions are paused during Replay. The local Paper ledger remains available below as a read-only snapshot. Return to Markets in the main terminal to resume.</span>
      <Link href="/" className="underline">Open main terminal</Link>
    </div>}

    {/* kind switch: the workspace-tab grammar from the main terminal nav */}
    <div role="tablist" aria-label="Derivative markets" className="flex items-center gap-2 px-4 py-2">
      {KINDS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={'derivatives-' + value}
          aria-selected={kind === value}
          aria-controls="derivatives-panel"
          className={'workspace-tab relative px-3 py-1 text-xs font-mono font-bold tracking-wider uppercase border border-transparent ' + (kind === value ? "active text-[var(--c-accent)] bg-[var(--c-surface-3)] border-[var(--c-accent)]" : "text-[var(--c-fg-2)] hover:text-white")}
          disabled={busy || blocked}
          onClick={() => changeKind(value as DerivativeKind)}
        >
          {label}
        </button>
      ))}
      <div className="flex-1" />
      <span className="meta">{kind === "option" ? "Deribit · Long options only" : "OKX · Linear isolated contracts"}</span>
    </div>
    <div id="derivatives-panel" role="tabpanel" aria-labelledby={'derivatives-' + kind} className="flex flex-col flex-1">
    <main className="derivatives-layout" style={{ ["--mode" as string]: kind === "option" ? "var(--c-up)" : "var(--c-accent)" }}>
      {/* instrument rail: the watchlist vocabulary */}
      <section className="derivatives-panel derivatives-rail" aria-label="Contract browser">
        <div className="derivatives-panel-head">
          <span>Instruments</span>
          <span className="num">{blocked ? "—" : listLoading ? "…" : String(items.length).padStart(2, "0")}</span>
        </div>
        <div className="p-2 border-b border-[var(--c-line)]">
          <AkInput aria-label="Search derivatives" placeholder="Search contracts" value={query} disabled={busy || blocked} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {!blocked && kind === "option" && chain.length > 0 && <div className="flex flex-wrap gap-1 p-2 border-b border-[var(--c-line)]" role="group" aria-label="Expiry and settlement">
          {chain.map((entry) => (
            <button key={entry.key} type="button" disabled={busy}
              className={'px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider border ' + ((activeChain?.key === entry.key) ? "text-[var(--c-accent)] border-[var(--c-accent)] bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)]" : "text-[var(--c-fg-3)] border-[var(--c-line)] hover:text-[var(--c-fg)]")}
              aria-pressed={activeChain?.key === entry.key}
              onClick={() => { if (activeChain?.key !== entry.key) { setOptionQuoteData({ key: "", quotes: {}, staleIds: [], error: null }); setChainKey(entry.key); } }}>
              {derivativeExpiryLabel(entry.expiry)} · {entry.base}/{entry.settle}
            </button>
          ))}
        </div>}
        {kind === "option" && activeChain && !blocked && <div className="space-y-1 border-b border-[var(--c-line)] px-2 py-1.5">
          <p className="meta">{activeChain.base}/{activeChain.settle} · premium per base · B / mark / A reference</p>
          {optionQuoteError && <div role="alert" className="space-y-1 text-[var(--c-down)] text-[10px]">
            <p>{optionQuoteError}</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision((n) => n + 1)}>Retry chain quotes</Button>
          </div>}
          {!optionQuoteError && optionQuoteIds.length > 0 && !currentOptionQuoteData && <p role="status" className="text-[var(--c-fg-4)] text-[10px]">Loading batch reference quotes…</p>}
        </div>}
        <div className="derivatives-list">
          {blocked ? <p className="p-3 text-[var(--c-fg-4)] text-[11px]">Live data hidden while Paper is disabled.</p>
            : listLoading ? <p className="p-3 text-[var(--c-fg-4)] text-[11px]">Loading instruments…</p>
              : listError ? <div className="p-3 space-y-2"><p className="text-[var(--c-fg-3)] text-[11px]">{listError}</p><Button size="sm" variant="outline" onClick={() => setRevision((n) => n + 1)}>Retry</Button></div>
                : !items.length ? <p className="p-3 text-[var(--c-fg-4)] text-[11px]">No matching contracts.</p>
                  : kind === "option" && activeChain ? activeChain.rows.map((row) => (
                    <div key={activeChain.expiry + "-" + row.strike} className="grid grid-cols-[1fr_auto_1fr] items-stretch border-b border-[var(--c-line-soft)]" role="group" aria-label={"Strike " + derivativeNumber(row.strike)}>
                      {(["call", "put"] as const).map((right) => {
                        const option = row[right];
                        if (!option) return <div key={right} className="min-h-[44px]" aria-label={"No " + right + " at this strike"} />;
                        const strikeTag = right === "call" ? "C" : "P";
                        const chainQuote = optionQuotes[option.id];
                        const quoteStale = staleOptionQuoteIds.has(option.id);
                        return (
                          <button key={right} type="button"
                            className={'derivatives-row !border-b-0 ' + (selectedId === option.id ? "selected" : "") + (right === "call" ? " border-r border-[var(--c-line-soft)]" : "")}
                            disabled={busy} aria-current={selectedId === option.id} onClick={() => select(option.id)}>
                            <span className="min-w-0 flex-1">
                              <strong className="truncate">{derivativeNumber(row.strike)} <span className="text-[var(--c-accent)]">{strikeTag}</span></strong>
                              <small>{option.settle} · {option.linear ? "Linear" : "Coin"}</small>
                              <OptionSnapshot quote={chainQuote} stale={quoteStale} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))
                  : items.map((item) => (
                    <button key={item.id} type="button" className={`derivatives-row ${selectedId === item.id ? "selected" : ""}`} disabled={busy} aria-current={selectedId === item.id} onClick={() => select(item.id)}>
                      <span className="min-w-0">
                        <strong className="truncate">{item.nativeId}</strong>
                        <small>{item.settle} · {item.linear ? "Linear" : item.inverse ? "Inverse · view only" : "Option"}</small>
                      </span>
                    </button>
                  ))}
        </div>
      </section>

      <div className="min-w-0 space-y-3">
        <section className="derivatives-panel" aria-label="Contract market data">
          <div className="derivatives-panel-head">
            <span>Contract details</span>
            <span className="num normal-case tracking-normal">{instrument ? instrument.id : "—"}</span>
          </div>
          {marketError && <div role="alert" className="m-3 space-y-2 text-[var(--c-down)] text-[11px]"><p>{marketError}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision((n) => n + 1)}>Retry quote</Button></div>}
          {selectedId && !instrument && !marketError && <p className="m-3 text-[var(--c-fg-4)] text-[11px]">Loading contract and quote…</p>}
          {instrument && quote && <div className="derivatives-panel-body">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div className="flex flex-col gap-1"><span className="meta">Contract size</span><span className="num">{derivativeNumber(instrument.contractSize)} {instrument.base}</span></div>
              <div className="flex flex-col gap-1"><span className="meta">Min / step</span><span className="num">{derivativeNumber(instrument.minContracts)} / {derivativeNumber(instrument.quantityStep)}</span></div>
              <div className="flex flex-col gap-1"><span className="meta">Price tick</span><span className="num">{derivativeNumber(instrument.priceTick)}</span></div>
              <div className="flex flex-col gap-1"><span className="meta">Margin</span><span className="num">{instrument.kind === "option" ? "Paid premium" : "Isolated"}</span></div>
            </div>
            <details className="derivatives-details">
              <summary>All contract fields</summary>
              <dl className="derivatives-context mt-2">
                <div className="kv"><dt>Native ID</dt><dd>{instrument.nativeId}</dd></div>
                <div className="kv"><dt>Settlement</dt><dd>{instrument.settle}</dd></div>
                <div className="kv"><dt>Underlying index</dt><dd>{instrument.quote}/{instrument.base}</dd></div>
                {instrument.kind === "option" && <div className="kv"><dt>Expiry</dt><dd>{derivativeDate(instrument.expiry)}</dd></div>}
                <div className="kv"><dt>Quote time</dt><dd>{derivativeDate(quote.timestamp)}</dd></div>
                {quote.nextFundingAt != null && <div className="kv"><dt>Next funding</dt><dd>{derivativeDate(quote.nextFundingAt)}</dd></div>}
              </dl>
            </details>
            {reason && <p role="status" className="derivatives-ticket-note alert">{reason}</p>}
          </div>}
        </section>

        <section className="derivatives-panel" aria-label="Contract candles">
          <div className="derivatives-panel-head"><span>Price history · 1h</span><span className="num">{bars.length || "—"}</span></div>
          <div className="derivatives-panel-body">
            {blocked ? <p className="text-[var(--c-fg-4)] text-[11px]">Live history is hidden while Paper is disabled.</p>
              : kind === "option" ? <p className="text-[var(--c-fg-4)] text-[11px]">Option candles are not supported. Use the native quote and contract details above.</p>
                : candleError ? <p role="status" className="text-[var(--c-fg-4)] text-[11px]">{candleError}</p>
                  : bars.length ? <CandleSeries bars={bars} />
                    : <p className="text-[var(--c-fg-4)] text-[11px]">{selectedId ? "No candle data available." : "Select a contract to view candles."}</p>}
          </div>
        </section>

        <section className="derivatives-panel" aria-label="Derivatives account">
          <div className="derivatives-panel-head">
            <span>{blocked ? "Frozen Replay ledger snapshot" : `Paper account ${instrument ? `· ${instrument.venue.toUpperCase()} / ${instrument.settle}` : ""}`}</span>
            <Button size="sm" variant="outline" disabled={ledgerAccounts === null} onClick={() => setLedgerRevision((n) => n + 1)}>{blocked ? "Refresh snapshot" : "Refresh ledger"}</Button>
          </div>
          <div className="derivatives-panel-body">
            {ledgerError ? <p role="alert" className="text-[var(--c-down)] text-[11px]">Local account ledger unavailable: {ledgerError}</p>
              : ledgerAccounts === null ? <p className="text-[var(--c-fg-4)] text-[11px]">Loading local accounts…</p>
                : blocked ? ledgerAccounts.length
                  ? <LocalAccountLedger accounts={ledgerAccounts} readOnly />
                  : <p className="text-[var(--c-fg-4)] text-[11px]">No local derivatives Paper accounts are stored yet.</p>
                : account ? null
                  : ledgerAccounts.length ? <LocalAccountLedger accounts={ledgerAccounts} onSelectPosition={selectPosition} />
                    : <p className="text-[var(--c-fg-4)] text-[11px]">No local derivatives accounts. Open one after a contract is available.</p>}
            {blocked ? null
              : account ? <>
                      <dl className="derivatives-account-grid">
                        <div><dt>Available</dt><dd>{account.available} <small>{account.settle}</small></dd></div>
                        <div><dt>Realized P&L</dt><dd className={account.realizedPnl.startsWith("-") ? "text-[var(--c-down)]" : account.realizedPnl === "0" ? "" : "text-[var(--c-up)]"}>{account.realizedPnl} <small>{account.settle}</small></dd></div>
                        <div><dt>Fees paid</dt><dd>{account.feesPaid} <small>{account.settle}</small></dd></div>
                      </dl>
                      <div>
                        <span className="meta">Positions</span>
                        {!account.positions.length ? <p className="mt-1 text-[var(--c-fg-4)] text-[11px]">No open positions.</p>
                          : <div className="derivatives-table-scroll mt-2 border border-[var(--c-line)]">
                            <table className="derivatives-table">
                              <thead><tr>{["Instrument", "Side", "Qty", "Entry", "Margin", "uPnL", ""].map((label) => <th key={label}>{label}</th>)}</tr></thead>
                              <tbody>{account.positions.map((position) => <PositionRow key={`${position.instrumentId}:${position.side}`} position={position} quote={quote} busy={busy} onClose={beginClose} />)}</tbody>
                            </table>
                          </div>}
                      </div>
                      <div>
                        <span className="meta">Order history</span>
                        {!account.orders.length ? <p className="mt-1 text-[var(--c-fg-4)] text-[11px]">No Paper fills.</p>
                          : <div className="derivatives-table-scroll mt-2 border border-[var(--c-line)]">
                            <table className="derivatives-table">
                              <thead><tr>{["Time (UTC)", "Instrument", "Action", "Qty", "Fill", "Fee"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
                              <tbody>{account.orders.slice(-20).reverse().map((order) => (
                                <tr key={order.clientOrderId}>
                                  <td>{derivativeDate(order.createdAt)}</td>
                                  <td className="max-w-0 truncate" title={order.instrumentId}>{order.instrumentId}</td>
                                  <td>{order.action} {order.side}</td>
                                  <td>{order.quantity}</td>
                                  <td>{order.fillPrice}</td>
                                  <td>{order.fee}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>}
                      </div>
                    </> : accountReady && instrument ? <p className="text-[var(--c-fg-4)] text-[11px]">No account is open for this settlement currency yet.</p> : null}
          </div>
        </section>
      </div>

      {/* ticket: the spot inspector's paper ticket grammar */}
      <section className="derivatives-panel" aria-label="Derivatives Paper ticket">
        <div className="derivatives-panel-head"><span>Paper ticket</span><span className="num normal-case tracking-normal">{instrument ? `${instrument.venue}/${instrument.settle}` : "—"}</span></div>
        <div className="derivatives-panel-body derivatives-ticket">
          <p className="derivatives-ticket-note">Separate local settle account. Spot and legacy balances are never used or migrated.</p>
          {blocked ? <p role="status" className="derivatives-ticket-note">Paper order entry is hidden during Replay.</p>
            : !instrument || !quote ? <p role="status" className="derivatives-ticket-note alert">Order entry is paused until exchange metadata and a fresh quote are available. Existing balances, positions, and history remain readable in the local ledger.</p>
              : !accountReady ? <p role="status" className="derivatives-ticket-note">{ledgerError ? "Local Paper account unavailable. Refresh the local ledger before trading." : "Loading local Paper account…"}</p>
                : !account ? <>
            <div className="flex flex-col gap-1 flex items-baseline justify-between"><span className="meta">Initial balance</span><span className="num">{initialBalance} {instrument.settle}</span></div>
            <p className="derivatives-ticket-note">Local seed in {instrument.settle}. Fee rate: 0.1% per fill. Opening an existing account never credits it again.</p>
            <Button block variant="primary" disabled={busy || blocked} onClick={() => void command(true)}>Open Paper account</Button>
          </> : <form className="derivatives-ticket" onSubmit={(event) => { event.preventDefault(); void command(false); }}>
            <fieldset disabled={busy || blocked || !account} className="derivatives-ticket">
              <label className="field">
                <span>Action</span>
                <AkSelect aria-label="Order action" value={action} onChange={(event) => setAction(event.target.value as "open" | "close")}>
                  <option value="open">{kind === "option" ? "Buy to open" : "Open"}</option>
                  <option value="close">{kind === "option" ? "Sell to close" : "Close · reduce only"}</option>
                </AkSelect>
              </label>
              <label className="field">
                <span>Position side</span>
                <AkSelect aria-label="Position side" value={side} onChange={(event) => setSide(event.target.value as "long" | "short")}>
                  <option value="long">Long</option>
                  {kind !== "option" && <option value="short">Short</option>}
                </AkSelect>
              </label>
              <label className="field">
                <div className="flex items-center justify-between">
                  <span>Quantity (contracts)</span>
                  {instrument && (
                    <span className="text-[10px] text-[var(--c-fg-4)]">step {derivativeNumber(instrument.quantityStep)}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <AkInput aria-label="Quantity in contracts" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                  </div>
                  <button
                    type="button"
                    disabled={busy || blocked || !account}
                    onClick={() => stepContracts(-1)}
                    aria-label="Decrease contracts"
                    className="px-2.5 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] font-mono select-none"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    disabled={busy || blocked || !account}
                    onClick={() => stepContracts(1)}
                    aria-label="Increase contracts"
                    className="px-2.5 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] font-mono select-none"
                  >
                    +
                  </button>
                </div>
                {account && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[9px] text-[var(--c-fg-4)] uppercase mr-1">Size:</span>
                    {[0.25, 0.5, 0.75, 1].map((fraction) => (
                      <button
                        key={fraction}
                        type="button"
                        disabled={busy || blocked}
                        onClick={() => sizeDerivativesBudget(fraction)}
                        className="flex-1 py-0.5 px-1 bg-[var(--ak-surface-sunken)] border border-[var(--c-line)] hover:border-[var(--c-accent)] active:scale-95 text-[10px] font-mono text-[var(--c-fg-2)] transition-transform"
                      >
                        {fraction === 1 ? "MAX" : `${fraction * 100}%`}
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <label className="field">
                <span>Isolated leverage</span>
                <AkSelect aria-label="Isolated leverage" value={leverage} onChange={(event) => setLeverage(event.target.value)}>
                  {Array.from({ length: kind === "option" ? 1 : 20 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}x</option>)}
                </AkSelect>
                {kind !== "option" && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[9px] text-[var(--c-fg-4)] mr-1">Preset:</span>
                    {[1, 2, 5, 10, 20].map((lev) => (
                      <button
                        key={lev}
                        type="button"
                        disabled={busy || blocked}
                        onClick={() => setLeverage(String(lev))}
                        className={`flex-1 py-0.5 text-[10px] font-mono border transition-transform active:scale-95 ${Number(leverage) === lev ? "border-[var(--c-accent)] text-[var(--c-accent)] bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)] font-bold" : "border-[var(--c-line)] text-[var(--c-fg-3)] hover:text-[var(--c-fg)]"}`}
                      >
                        {lev}x
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <label className="field">
                <span>{(action === "open") === (side === "long") ? "Buy ceiling" : "Sell floor"} ({instrument?.settle ?? "settle"}/base)</span>
                <AkInput aria-label="Price protection" inputMode="decimal" value={maximumPrice} onChange={(event) => setMaximumPrice(event.target.value)} />
                {quote && (
                  <div className="flex items-center gap-1 mt-1 text-[10px]">
                    <span className="text-[9px] text-[var(--c-fg-4)] mr-1">Fill:</span>
                    <button
                      type="button"
                      disabled={busy || blocked}
                      onClick={() => setMaximumPrice(String(quote.bid))}
                      className="px-1.5 py-0.5 border border-[var(--c-line)] hover:border-[var(--c-accent)] text-[var(--c-up)] font-mono text-[10px] active:scale-95 transition-transform"
                      title="Fill with current native bid"
                    >
                      Bid {derivativeNumber(quote.bid)}
                    </button>
                    <button
                      type="button"
                      disabled={busy || blocked}
                      onClick={() => setMaximumPrice(String(quote.mark))}
                      className="px-1.5 py-0.5 border border-[var(--c-line)] hover:border-[var(--c-accent)] text-[var(--c-fg-2)] font-mono text-[10px] active:scale-95 transition-transform"
                      title="Fill with current mark price"
                    >
                      Mark {derivativeNumber(quote.mark)}
                    </button>
                    <button
                      type="button"
                      disabled={busy || blocked}
                      onClick={() => setMaximumPrice(String(quote.ask))}
                      className="px-1.5 py-0.5 border border-[var(--c-line)] hover:border-[var(--c-accent)] text-[var(--c-down)] font-mono text-[10px] active:scale-95 transition-transform"
                      title="Fill with current native ask"
                    >
                      Ask {derivativeNumber(quote.ask)}
                    </button>
                  </div>
                )}
              </label>
              <p className="derivatives-ticket-note">{action === "close" ? "Reduce only. Use the existing position side and leverage; quantity cannot exceed that position." : "Immediate local fill at native bid / ask within your price protection."}</p>
              {instrument && quote
                ? <QuoteFreshSubmit instrument={instrument} quote={quote} disabled={busy || blocked || !account || !validOrder || !!reason} submitting={busy} />
                : <Button type="submit" block variant="primary" disabled>Submit Paper order</Button>}
            </fieldset>
          </form>}
          {notice && <p role="status" className={`derivatives-ticket-note ${notice.tone}`}>{notice.text}</p>}
          <p className="derivatives-ticket-note">Funding is not accrued. Expiry freezes positions awaiting official settlement. Local isolated margin does not simulate exchange liquidation.</p>
        </div>
      </section>
    </main>
    </div>

    <footer className="derivatives-statusbar">
      <span>LOCAL WORKSPACE · {instrument ? `${instrument.nativeId} · ${instrument.settle}` : "NO CONTRACT"}</span>
      <span>DERIVATIVES · LIVE TRADING DISABLED · SQLITE LOCAL PERSISTENCE</span>
    </footer>
  </div>;
}
