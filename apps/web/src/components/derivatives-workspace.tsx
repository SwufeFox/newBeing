"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AkInput, AkPopover, AkSelect, AkTag } from "@swufefox/ak-ui-react";
import type { Candle } from "@newbeing/core";
import type { DerivativeInstrument, DerivativeKind, DerivativeQuote } from "@newbeing/market-data/derivatives";
import type { DerivativesAccount, DerivativesOrderRequest, DerivativesPosition } from "@newbeing/application/derivatives-types";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/store/workspace";
import { derivativeNumber, derivativeDate, derivativeBlockReason, derivativeUnrealized } from "@/lib/derivatives-ui";

const KINDS = [["perpetual", "Perpetuals"], ["future", "Futures"], ["option", "Options"]] as const;
const panel = "border border-[var(--ak-border-subtle)] bg-[var(--ak-surface-canvas)] p-3";
const muted = "text-[var(--ak-text-secondary)]";

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Derivatives request failed.");
  return payload as T;
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

function CandleSeries({ bars }: { bars: Candle[] }): React.JSX.Element {
  const values = bars.map((bar) => bar.close);
  const min = Math.min(...values), max = Math.max(...values);
  return <svg viewBox="0 0 600 140" className="w-full h-36" role="img" aria-label="Contract closing prices, 1 hour candles">
    <title>Contract closing prices · 1h · sparse series preserved</title>
    <polyline fill="none" stroke="var(--ak-signal-info)" strokeWidth="2" points={bars.map((bar) => {
      const span = bars.at(-1)!.timestamp - bars[0]!.timestamp;
      const x = span > 0 ? 5 + (bar.timestamp - bars[0]!.timestamp) / span * 590 : 300;
      return `${x},${max === min ? 70 : 130 - (bar.close - min) / (max - min) * 120}`;
    }).join(" ")} />
  </svg>;
}

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
  const [accountState, setAccountState] = useState<{ key: string; account: DerivativesAccount | null } | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [action, setAction] = useState<"open" | "close">("open");
  const [side, setSide] = useState<"long" | "short">("long");
  const [quantity, setQuantity] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [maximumPrice, setMaximumPrice] = useState("");
  const pendingOrder = useRef<DerivativesOrderRequest | null>(null);
  const mutationLock = useRef(false);
  const blocked = globalWorkspace === "replay" || remoteReplay !== false;
  const instrument = !blocked && market?.instrument.id === selectedId ? market.instrument : null;
  const quote = !blocked && market?.quote.instrumentId === selectedId && !marketError ? market.quote : null;
  const initialBalance = instrument?.settle === "BTC" ? "1" : instrument?.settle === "ETH" ? "10" : "10000";
  const accountKey = instrument ? `${instrument.venue}:${instrument.settle}` : "";
  const account = !blocked && accountState?.key === accountKey ? accountState.account : null;
  const accountReady = !blocked && accountState?.key === accountKey && !accountError;

  // Read the shared boundary, without mounting WorkspaceSync or writing spot state.
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const data = await readJson<{ state: { activeWorkspace: string } }>("/api/workspace");
        if (!disposed) setRemoteReplay(data.state.activeWorkspace === "replay");
      } catch { if (!disposed) setRemoteReplay(null); }
    };
    void refresh();
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setListLoading(true); setListError(null);
      void readJson<{ instruments: DerivativeInstrument[] }>(`/api/derivatives/markets?kind=${kind}&query=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((data) => {
          setItems(data.instruments);
          setSelectedId((id) => id || data.instruments[0]?.id || "");
        }).catch((error: unknown) => { if (!controller.signal.aborted) { setItems([]); setListError(error instanceof Error ? error.message : "Instrument search unavailable."); } })
        .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, query, revision, blocked]);

  useEffect(() => {
    if (blocked || !selectedId) return;
    let disposed = false;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const data = await readJson<{ instrument: DerivativeInstrument; quote: DerivativeQuote; candles: Candle[]; candleError: string | null }>(`/api/derivatives/market?instrumentId=${encodeURIComponent(selectedId)}`, { signal: controller.signal });
        if (!disposed) { setMarket(data); setMarketError(null); setBars(data.candles); setCandleError(data.candleError); }
      } catch (error) { if (!disposed) { setMarket(null); setMarketError(error instanceof Error ? error.message : "Quote unavailable."); } }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { disposed = true; controller.abort(); window.clearInterval(timer); };
  }, [selectedId, revision, blocked]);

  useEffect(() => {
    if (blocked || !instrument) return;
    const controller = new AbortController();
    void readJson<{ account: DerivativesAccount | null }>(`/api/derivatives/account?instrumentId=${encodeURIComponent(instrument.id)}`, { signal: controller.signal })
      .then((data) => { setAccountState({ key: accountKey, account: data.account }); setAccountError(null); })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setAccountState(null); setAccountError(error instanceof Error ? error.message : "Account unavailable."); } });
    return () => controller.abort();
  }, [blocked, instrument?.venue, instrument?.settle, accountKey, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  function select(id: string): void {
    setSelectedId(id); setMarket(null); setMarketError(null); setBars([]); setCandleError(null);
    setMaximumPrice(""); setQuantity(""); setNotice(null); pendingOrder.current = null;
  }
  function changeKind(next: DerivativeKind): void {
    setKind(next); setItems([]); setListLoading(true); select(""); setSide("long"); setLeverage("1"); setAction("open");
  }
  // A close order must reuse the position's terms; the engine rejects mismatches,
  // so pre-filling removes the most common avoidable rejection.
  function beginClose(position: DerivativesPosition): void {
    setAction("close"); setSide(position.side === "short" ? "short" : "long"); setLeverage(String(position.leverage)); setQuantity(position.quantity);
    pendingOrder.current = null; setNotice(null);
  }
  const reason = derivativeBlockReason(instrument, quote, now);
  const validOrder = /^\d+(?:\.\d+)?$/.test(quantity) && Number(quantity) > 0 && /^\d+(?:\.\d+)?$/.test(maximumPrice) && Number(maximumPrice) > 0 && Number.isInteger(Number(leverage)) && Number(leverage) >= 1 && Number(leverage) <= 20;

  async function command(openAccount: boolean): Promise<void> {
    if (mutationLock.current || blocked || !instrument || !accountReady || (!openAccount && (reason || !validOrder))) return;
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
      setAccountState({ key: accountKey, account: data.account });
      setNotice(openAccount ? "Local Paper account opened." : data.deduplicated ? "Previously filled order confirmed." : "Paper order filled.");
      pendingOrder.current = null;
    } catch (error) {
      setNotice(`${error instanceof Error ? error.message : "Paper command failed."} Refresh the account to confirm the outcome before changing this order. Retrying unchanged order details uses the same client order ID.`);
    } finally { mutationLock.current = false; setBusy(false); }
  }

  return <div className="derivatives-page min-h-screen bg-[var(--ak-surface-canvas)] text-[var(--ak-text-primary)] font-mono text-xs">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ak-border-strong)] p-3">
      <div className="flex items-center gap-4"><Link href="/" className="font-bold">newBeing <span className="text-[var(--ak-signal-info)]">PRTS</span></Link><h1 className="text-sm font-bold">Derivatives</h1><AkTag variant="advanced">PAPER · LIVE OFF</AkTag></div>
      <div className="flex items-center gap-3"><EngineModel /><Link href="/" className="underline">Back to terminal</Link></div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ak-border-subtle)] p-3">
      <div role="tablist" aria-label="Derivative markets" className="flex gap-2">{KINDS.map(([value, label]) => <Button key={value} role="tab" id={`derivatives-${value}`} aria-selected={kind === value} aria-controls="derivatives-panel" variant={kind === value ? "primary" : "ghost"} size="sm" disabled={busy} onClick={() => changeKind(value)}>{label}</Button>)}</div>
      <span className={muted}>{kind === "option" ? "Deribit · Long options only" : "OKX · Linear isolated contracts"}</span>
    </div>
    {blocked && <div role="status" className="p-3 border-b border-[var(--ak-border-subtle)] text-[var(--ak-signal-action)]">{globalWorkspace === "replay" || remoteReplay ? "Derivatives Paper is unavailable during Replay. Return to Markets in the main terminal first. These tabs do not leave Replay." : "Checking workspace boundary. Paper is disabled until the shared workspace is available."} <Link href="/" className="underline">Open main terminal</Link></div>}
    <main id="derivatives-panel" role="tabpanel" aria-labelledby={`derivatives-${kind}`} className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] gap-3 p-3 items-start">
      <section className={panel} aria-label="Contract browser">
        <h2 className="font-bold mb-3">Instruments</h2>
        <AkInput aria-label="Search derivatives" placeholder="Search contracts" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
        <div role="status" className={`my-2 ${muted}`}>{blocked ? "Live data hidden while Paper is disabled." : listLoading ? "Loading instruments…" : listError ?? `${items.length} instruments · native metadata`}</div>
        {listError && <Button size="sm" onClick={() => setRevision((n) => n + 1)}>Retry</Button>}
        {!listLoading && !listError && !items.length && <p className={muted}>No matching contracts.</p>}
        <div className="max-h-[540px] overflow-y-auto space-y-1">{(blocked ? [] : items).map((item) => <Button key={item.id} block size="sm" disabled={busy} variant={selectedId === item.id ? "primary" : "ghost"} onClick={() => select(item.id)} className="text-left"><span className="truncate">{item.nativeId}<small className="block">{item.settle} · {item.linear ? "Linear" : item.inverse ? "Inverse · view only" : "Option"}</small></span></Button>)}</div>
      </section>
      <div className="min-w-0 space-y-3">
        <section className={panel} aria-label="Contract market data">
          <div className="flex flex-wrap justify-between gap-2 mb-3"><h2 className="font-bold">{instrument?.nativeId ?? "Select a contract"}</h2><Button size="sm" disabled={busy} onClick={() => setRevision((n) => n + 1)}>Refresh</Button></div>
          {marketError && <p role="alert" className="text-[var(--ak-signal-danger)]">{marketError}</p>}
          {selectedId && !instrument && !marketError && <p className={muted}>Loading contract and quote…</p>}
          {instrument && <>
            <p className={`mb-3 break-all ${muted}`}>{instrument.id} · {quote?.source === "fixture" ? "FIXTURE · TEST DATA" : "PUBLIC MARKET DATA"}</p>
            {/* Primary read: the executable two-sided market. Everything else is context. */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3">
              <span className="text-lg font-bold text-[var(--ak-signal-success)]">{derivativeNumber(quote?.bid)} <span className="text-[10px] font-normal opacity-70">BID</span></span>
              <span className="text-lg font-bold text-[var(--ak-signal-danger)]">{derivativeNumber(quote?.ask)} <span className="text-[10px] font-normal opacity-70">ASK</span></span>
              <span className={muted}>Mark {derivativeNumber(quote?.mark)} · Index {derivativeNumber(quote?.index)}</span>
              <span className="text-[10px] uppercase tracking-widest">{instrument.settle}/{instrument.base}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mb-3">
              <span className={muted}>Expiry {instrument.kind === "perpetual" ? "Perpetual" : derivativeDate(instrument.expiry)}</span>
              {quote?.fundingRate != null && <span className={muted}>Funding {(quote.fundingRate * 100).toFixed(4)}%</span>}
              {quote?.openInterest != null && <span className={muted}>OI {derivativeNumber(quote.openInterest)} contracts</span>}
              {instrument.kind === "option" && <span className={muted}>Strike {derivativeNumber(instrument.strike)} {instrument.quote}</span>}
              {instrument.kind === "option" && quote?.iv != null && <span className={muted}>IV {(quote.iv * 100).toFixed(1)}%</span>}
              {instrument.kind === "option" && quote?.delta != null && <span className={muted}>Delta {derivativeNumber(quote.delta)}</span>}
            </div>
            {/* Contract mechanics are reference data, not headline; one disclosure. */}
            <details className="mb-2 text-[11px]">
              <summary className="cursor-pointer select-none text-[10px] uppercase tracking-widest text-[var(--ak-text-secondary)] hover:text-[var(--ak-text-primary)]">All contract fields</summary>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">{[
                ["Contract size (base)", derivativeNumber(instrument.contractSize)], ["Minimum contracts", derivativeNumber(instrument.minContracts)], ["Contract step", derivativeNumber(instrument.quantityStep)], ["Price tick", derivativeNumber(instrument.priceTick)],
                ["Quote time (UTC)", derivativeDate(quote?.timestamp)], ["Next funding (UTC)", derivativeDate(quote?.nextFundingAt)], ["Strike (quote/base)", derivativeNumber(instrument.strike)], ["Margin model", instrument.kind === "option" ? "Paid premium" : "Isolated"],
              ].map(([label, value]) => <div key={label}><dt className={`text-[10px] ${muted}`}>{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
            </details>
            {reason && <p role="status" className="mt-2 text-[var(--ak-signal-action)]">{reason}</p>}
          </>}
        </section>
        <section className={panel} aria-label="Contract candles"><h2 className="font-bold mb-2">Price history · 1h</h2>{blocked ? <p className={muted}>Live history is hidden while Paper is disabled.</p> : kind === "option" ? <p className={muted}>Option candles are not supported. Use the native quote and contract details above.</p> : candleError ? <p role="status" className={muted}>{candleError}</p> : bars.length ? <CandleSeries bars={bars} /> : <p className={muted}>{selectedId ? "No candle data available." : "Select a contract to view candles."}</p>}</section>
        <section className={panel} aria-label="Derivatives account">
          <h2 className="font-bold mb-3">Paper account {instrument ? `· ${instrument.venue.toUpperCase()} / ${instrument.settle}` : ""}</h2>
          {blocked ? <p className={muted}>Account balances, positions and order history are hidden while Paper is disabled.</p> : accountError ? <p role="alert">{accountError}</p> : !accountReady ? <p className={muted}>Select a contract to load its settle account.</p> : !account ? <p className={muted}>No local account. Open one explicitly using the ticket.</p> : <>
            <dl className="grid grid-cols-3 gap-3 mb-4">{[["Available", account.available], ["Realized P&L", account.realizedPnl], ["Fees paid", account.feesPaid]].map(([label, value]) => <div key={label}><dt className={muted}>{label}</dt><dd className="break-all">{value} {account.settle}</dd></div>)}</dl>
            <h3 className="font-bold mb-2">Positions</h3>{!account.positions.length ? <p className={muted}>No open positions.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead className={muted}><tr>{["Instrument", "Side", "Contracts", "Entry", "Isolated margin", "uPnL (mark est.)", "State"].map((label) => <th className="p-2 font-normal" key={label}>{label}</th>)}</tr></thead><tbody>{account.positions.map((position) => {
              const unrealized = derivativeUnrealized(position, quote?.mark ?? null, now);
              return <tr key={`${position.instrumentId}:${position.side}`} className="border-t border-[var(--ak-border-subtle)]">
                <td className="p-2 break-all">{position.instrumentId}</td>
                <td className="p-2">{position.side}</td>
                <td className="p-2">{position.quantity}</td>
                <td className="p-2">{position.entryPrice}</td>
                <td className="p-2">{position.margin} {account.settle} · {position.leverage}x</td>
                <td className="p-2">{unrealized === null ? "—" : `${unrealized > 0 ? "+" : ""}${unrealized} ${account.settle}`}</td>
                <td className="p-2">
                  {position.expiry !== null && position.expiry <= now ? "Awaiting official settlement" : <Button size="sm" variant="outline" disabled={busy} onClick={() => beginClose(position)}>Close</Button>}
                </td>
              </tr>;
            })}</tbody></table></div>}
            <h3 className="font-bold mt-4 mb-2">Order history</h3>{!account.orders.length ? <p className={muted}>No Paper fills.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead className={muted}><tr>{["Time (UTC)", "Instrument", "Action", "Contracts", "Fill", "Fee"].map((label) => <th className="p-2 font-normal" key={label}>{label}</th>)}</tr></thead><tbody>{account.orders.slice(-20).reverse().map((order) => <tr key={order.clientOrderId} className="border-t border-[var(--ak-border-subtle)]"><td className="p-2">{derivativeDate(order.createdAt)}</td><td className="p-2 break-all">{order.instrumentId}</td><td className="p-2">{order.action} {order.side}</td><td className="p-2">{order.quantity}</td><td className="p-2">{order.fillPrice}</td><td className="p-2">{order.fee} {account.settle}</td></tr>)}</tbody></table></div>}
          </>}
        </section>
      </div>
      <section className={`${panel} space-y-3`} aria-label="Derivatives Paper ticket">
        <h2 className="font-bold">Paper ticket</h2><p className={muted}>Separate local settle account · spot balances are not used.</p>
        {accountReady && !account ? <>
          <p>Initial balance: {initialBalance} {instrument?.settle}</p>
          <p className={muted}>Local seed in {instrument?.settle}. Fee rate: 0.1% per fill. Opening an existing account never credits it again.</p>
          <Button block variant="primary" disabled={busy || blocked || !/^\d+(?:\.\d+)?$/.test(initialBalance) || Number(initialBalance) <= 0} onClick={() => void command(true)}>Open Paper account</Button>
        </> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void command(false); }}>
          <fieldset disabled={busy || blocked || !account} className="space-y-3">
            <label className="block">Action<AkSelect aria-label="Order action" value={action} onChange={(event) => setAction(event.target.value as "open" | "close")}><option value="open">{kind === "option" ? "Buy to open" : "Open"}</option><option value="close">{kind === "option" ? "Sell to close" : "Close · reduce only"}</option></AkSelect></label>
            <label className="block">Position side<AkSelect aria-label="Position side" value={side} onChange={(event) => setSide(event.target.value as "long" | "short")}><option value="long">Long</option>{kind !== "option" && <option value="short">Short</option>}</AkSelect></label>
            <label className="block">Quantity (contracts)<AkInput aria-label="Quantity in contracts" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <label className="block">Isolated leverage<AkSelect aria-label="Isolated leverage" value={leverage} onChange={(event) => setLeverage(event.target.value)}>{Array.from({ length: kind === "option" ? 1 : 20 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}x</option>)}</AkSelect></label>
            <label className="block">{(action === "open") === (side === "long") ? "Buy ceiling" : "Sell floor"} ({instrument?.settle ?? "settle"} / base)<AkInput aria-label="Price protection" inputMode="decimal" value={maximumPrice} onChange={(event) => setMaximumPrice(event.target.value)} /></label>
            <p className={muted}>{action === "close" ? "Reduce only. Use the existing position side and leverage; quantity cannot exceed that position." : "Immediate local fill at native bid / ask within your price protection."}</p>
            <Button type="submit" block variant="primary" disabled={busy || blocked || !account || !validOrder || !!reason}>{busy ? "Submitting…" : "Submit Paper order"}</Button>
          </fieldset>
        </form>}
        {notice && <p role="status" className="break-words text-[var(--ak-signal-action)]">{notice}</p>}
        <p className={muted}>Funding is not accrued. Expiry freezes positions awaiting official settlement. Local isolated margin does not simulate exchange liquidation.</p>
      </section>
    </main>
  </div>;
}
