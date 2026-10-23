"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { spotBuyQuantity, type ExchangeId, type SpotAccount } from "@newbeing/core";
import { Button } from "@/components/ui/button";

type TicketProps = { exchange: ExchangeId; symbol: string; referencePrice: number | null };
type Intent = { clientOrderId: string; side: "buy" | "sell"; quantity: number; maximumPrice: number };

export function SharedSpotTicket(props: TicketProps) {
  return <MarketSpotTicket key={`${props.exchange}:${props.symbol}`} {...props} />;
}

function MarketSpotTicket({ exchange, symbol, referencePrice }: TicketProps) {
  const quote = symbol.split("/")[1]!;
  const [account, setAccount] = useState<SpotAccount | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">("loading");
  const [quantity, setQuantity] = useState("0.001");
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const intentRef = useRef<Intent | null>(null);
  const transportUncertain = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const commandController = useRef<AbortController | null>(null);
  const maximumPrice = priceDraft ?? (referencePrice && referencePrice > 0 ? String(referencePrice * 1.005) : "");

  const applyAccount = useCallback((next: SpotAccount | null) => {
    if (next && (next.exchange !== exchange || next.quote !== quote)) throw new Error("The returned account belongs to a different market.");
    setAccount(next);
    const pending = intentRef.current;
    const order = pending && next?.orders.find((item) => item.clientOrderId === pending.clientOrderId);
    if (order && !["submitted", "unknown"].includes(order.status)) {
      intentRef.current = null;
      setIntent(null);
    }
  }, [exchange, quote]);

  const readAccount = useCallback(async (signal?: AbortSignal) => {
    const currentRevision = ++revision.current;
    setReadState("loading");
    setError(null);
    try {
      const response = await fetch(`/api/spot?exchange=${exchange}&quote=${quote}`, { signal: signal ?? null, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Shared account read failed.");
      if (!mounted.current || signal?.aborted || revision.current !== currentRevision) return;
      if (!("account" in payload)) throw new Error("Shared account response was incomplete.");
      applyAccount(payload.account);
      setReadState("ready");
    } catch (reason) {
      if (!mounted.current || signal?.aborted || revision.current !== currentRevision) return;
      setReadState("error");
      setError(reason instanceof Error ? reason.message : "Shared account read failed.");
    }
  }, [exchange, quote, applyAccount]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    // Deferred so the initial read does not set state inside the effect body;
    // React treats that as a cascading render.
    const timer = window.setTimeout(() => { void readAccount(controller.signal); }, 0);
    return () => {
      window.clearTimeout(timer);
      mounted.current = false;
      revision.current += 1;
      controller.abort();
      commandController.current?.abort();
    };
  }, [readAccount]);

  async function command(action: "open" | "order" | "cancel", side?: "buy" | "sell", clientOrderId?: string) {
    if (inFlight.current || readState !== "ready") return;
    let pending = intentRef.current;
    if (action === "order") {
      if (!side || (pending && pending.side !== side)) return;
      if (!pending) {
        const size = Number(quantity), price = Number(maximumPrice);
        if (!quantity.trim() || !maximumPrice.trim() || !Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) {
          setError("Quantity and maximum price must be positive numbers.");
          return;
        }
        pending = { clientOrderId: crypto.randomUUID(), side, quantity: size, maximumPrice: price };
        intentRef.current = pending;
        transportUncertain.current = false;
        setIntent(pending);
      }
    }
    inFlight.current = true;
    revision.current += 1;
    const controller = new AbortController();
    commandController.current = controller;
    setBusy(true);
    setError(null);
    let receivedOutcome = false;
    try {
      const body = action === "order" ? { action, exchange, symbol, ...pending! } : { action, exchange, quote, ...(clientOrderId ? { clientOrderId } : {}) };
      const response = await fetch("/api/spot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const payload = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      receivedOutcome = true;
      if ("account" in payload) applyAccount(payload.account);
      if (action === "order" && payload.intentRecorded === false && !transportUncertain.current) {
        intentRef.current = null;
        setIntent(null);
      }
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Shared spot command failed.");
    } catch (reason) {
      if (!receivedOutcome && action === "order") transportUncertain.current = true;
      if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Shared spot command failed.");
    } finally {
      inFlight.current = false;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }

  function sizeBudget(fraction: number) {
    try {
      const balance = account?.balances[quote];
      const budget = Math.floor(((balance?.total ?? 0) - (balance?.reserved ?? 0)) * fraction * 1e8) / 1e8;
      setQuantity(String(spotBuyQuantity(budget, Number(maximumPrice), account?.feeRate ?? 0.001)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Cannot size this order."); }
  }

  const unavailable = busy || readState !== "ready";
  return <div className="p-3 space-y-2 text-xs border-t border-[var(--ak-border-subtle)]" data-testid="shared-spot-ticket" data-loaded={readState === "ready"}>
    <strong>Shared spot · {exchange} · {quote}</strong>
    <p>One quote wallet across pairs. Legacy balances stay in their original accounts. Fees are included in budget sizing.</p>
    {readState === "loading" && <p role="status">Loading shared account…</p>}
    {readState !== "loading" && <Button size="sm" disabled={busy} onClick={() => void readAccount()}>Refresh shared account</Button>}
    {readState === "ready" && (!account ? <Button disabled={busy} onClick={() => void command("open")}>Open new 10,000 {quote} account</Button> : <>
      <div className="space-y-1">{Object.entries(account.balances).map(([asset, balance]) => <div key={asset}>{asset}: {balance.total} · reserved {balance.reserved}</div>)}</div>
      <label className="flex flex-col">Quantity<input aria-label="Shared spot quantity" type="number" min="0" step="any" disabled={busy || !!intent} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
      <label className="flex flex-col">Maximum buy price / sizing reference<input aria-label="Shared spot maximum price" type="number" min="0" step="any" disabled={busy || !!intent} value={intent ? String(intent.maximumPrice) : maximumPrice} onChange={(event) => setPriceDraft(event.target.value)} /></label>
      <div className="flex gap-1">{[0.25, 0.5, 1].map((fraction) => <Button key={fraction} size="sm" disabled={unavailable || !!intent} onClick={() => sizeBudget(fraction)}>{fraction * 100}%</Button>)}</div>
      <div className="flex gap-2"><Button disabled={unavailable || (!!intent && intent.side !== "buy")} onClick={() => void command("order", "buy")}>{intent?.side === "buy" ? "Retry same buy" : "Buy spot"}</Button><Button disabled={unavailable || (!!intent && intent.side !== "sell")} onClick={() => void command("order", "sell")}>{intent?.side === "sell" ? "Retry same sell" : "Sell inventory"}</Button></div>
      {account.orders.slice(-5).reverse().map((order) => <div key={order.clientOrderId}>{order.symbol} {order.side} {order.quantity} · {order.status}{["unknown", "submitted"].includes(order.status) && <Button size="sm" disabled={unavailable} onClick={() => void command("cancel", undefined, order.clientOrderId)}>Cancel / release</Button>}</div>)}
    </>)}
    {intent && <p role="status">Keep this order unchanged until its outcome is confirmed. Refresh or retry the same order to check it.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
