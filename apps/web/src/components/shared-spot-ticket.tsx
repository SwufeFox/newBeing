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

  const stepQuantity = (direction: -1 | 1): void => {
    const current = Number(quantity) || 0;
    const step = current >= 1 ? 0.1 : current >= 0.1 ? 0.01 : 0.001;
    const next = Math.max(0.0001, Number((current + direction * step).toFixed(4)));
    setQuantity(String(next));
  };

  const fillRefPrice = (multiplier: number) => {
    if (referencePrice && referencePrice > 0) {
      setPriceDraft(Number((referencePrice * multiplier).toFixed(4)).toString());
    }
  };

  const unavailable = busy || readState !== "ready";
  return (
    <div className="p-3 space-y-2.5 text-xs border-t border-[var(--ak-border-subtle)] font-mono" data-testid="shared-spot-ticket" data-loaded={readState === "ready"}>
      <div className="flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
        <strong className="text-[11px] uppercase tracking-wider text-[var(--ak-signal-info)]">Shared Spot · {exchange} · {quote}</strong>
        {readState !== "loading" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void readAccount()} className="h-6 text-[10px] px-2">
            Refresh shared account
          </Button>
        )}
      </div>

      <p className="text-[10px] text-[var(--ak-text-secondary)] opacity-80 leading-relaxed">
        One quote wallet across pairs. Legacy balances stay in their original accounts. Fees are included in budget sizing.
      </p>

      {readState === "loading" && <p role="status" className="py-2 text-center text-[var(--ak-text-secondary)]">Loading shared account…</p>}

      {readState === "ready" && (!account ? (
        <div className="py-2">
          <Button block variant="primary" disabled={busy} onClick={() => void command("open")} className="w-full text-xs py-2">
            Open new 10,000 {quote} account
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 p-2 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[10px]">
            {Object.entries(account.balances).map(([asset, balance]) => (
              <div key={asset} className="flex flex-col">
                <span className="text-[var(--ak-text-secondary)] font-bold">{asset}</span>
                <span>{balance.total} · <span className="opacity-70">res: {balance.reserved}</span></span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase tracking-wider">Quantity ({symbol.split("/")[0]})</span>
              <div className="flex items-center gap-1">
                <input
                  aria-label="Shared spot quantity"
                  type="number"
                  min="0"
                  step="any"
                  disabled={busy || !!intent}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="flex-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] focus:border-[var(--ak-signal-info)] px-2 py-1 outline-none text-xs text-[var(--ak-text-primary)]"
                />
                <button
                  type="button"
                  disabled={busy || !!intent}
                  onClick={() => stepQuantity(-1)}
                  aria-label="Decrease quantity"
                  className="px-2 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] select-none"
                >
                  -
                </button>
                <button
                  type="button"
                  disabled={busy || !!intent}
                  onClick={() => stepQuantity(1)}
                  aria-label="Increase quantity"
                  className="px-2 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] select-none"
                >
                  +
                </button>
              </div>
            </label>
          </div>

          <div className="space-y-1">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase tracking-wider">Maximum buy price / sizing reference</span>
              <input
                aria-label="Shared spot maximum price"
                type="number"
                min="0"
                step="any"
                disabled={busy || !!intent}
                value={intent ? String(intent.maximumPrice) : maximumPrice}
                onChange={(event) => setPriceDraft(event.target.value)}
                className="bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] focus:border-[var(--ak-signal-info)] px-2 py-1 outline-none text-xs text-[var(--ak-text-primary)]"
              />
            </label>
            {referencePrice && referencePrice > 0 && (
              <div className="flex gap-1 items-center text-[9px] text-[var(--ak-text-secondary)]">
                <span>Ref:</span>
                <button
                  type="button"
                  disabled={busy || !!intent}
                  onClick={() => fillRefPrice(1.0)}
                  className="px-1.5 py-0.5 border border-[var(--ak-border-subtle)] hover:border-[var(--ak-signal-info)] active:scale-95 text-[var(--ak-signal-info)]"
                >
                  Ref {referencePrice}
                </button>
                <button
                  type="button"
                  disabled={busy || !!intent}
                  onClick={() => fillRefPrice(1.005)}
                  className="px-1.5 py-0.5 border border-[var(--ak-border-subtle)] hover:border-[var(--ak-signal-info)] active:scale-95"
                >
                  +0.5%
                </button>
                {priceDraft !== null && (
                  <button
                    type="button"
                    onClick={() => setPriceDraft(null)}
                    className="ml-auto px-1 py-0.5 opacity-60 hover:opacity-100 underline text-[9px]"
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 pt-0.5">
            <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase tracking-wider mr-1">Size:</span>
            {[0.25, 0.5, 0.75, 1].map((fraction) => (
              <Button
                key={fraction}
                size="sm"
                variant="outline"
                disabled={unavailable || !!intent}
                onClick={() => sizeBudget(fraction)}
                className="flex-1 h-6 text-[10px] active:scale-95"
              >
                {fraction * 100}%
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              disabled={unavailable || (!!intent && intent.side !== "buy")}
              onClick={() => void command("order", "buy")}
              className="py-2 text-xs font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-600/30 active:scale-95 transition-transform"
            >
              {intent?.side === "buy" ? "Retry same buy" : "Buy spot"}
            </Button>
            <Button
              disabled={unavailable || (!!intent && intent.side !== "sell")}
              onClick={() => void command("order", "sell")}
              className="py-2 text-xs font-bold bg-rose-600/20 text-rose-400 border border-rose-500/40 hover:bg-rose-600/30 active:scale-95 transition-transform"
            >
              {intent?.side === "sell" ? "Retry same sell" : "Sell inventory"}
            </Button>
          </div>

          {account.orders.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-[var(--ak-border-subtle)]">
              <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase tracking-wider font-bold">Recent Spot Orders</span>
              {account.orders.slice(-5).reverse().map((order) => (
                <div key={order.clientOrderId} className="flex justify-between items-center p-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] text-[10px]">
                  <span>{order.symbol} {order.side} {order.quantity} · <span className="text-[var(--ak-signal-info)]">{order.status}</span></span>
                  {["unknown", "submitted"].includes(order.status) && (
                    <Button size="sm" variant="outline" disabled={unavailable} onClick={() => void command("cancel", undefined, order.clientOrderId)} className="h-5 text-[9px] px-1.5">
                      Cancel / release
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ))}

      {intent && <p role="status" className="p-1.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-signal-action)] text-[10px] text-[var(--ak-signal-action)]">Keep this order unchanged until its outcome is confirmed. Refresh or retry the same order to check it.</p>}
      {error && <p role="alert" className="p-1.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-signal-danger)] text-[10px] text-[var(--ak-signal-danger)]">{error}</p>}
    </div>
  );
}
