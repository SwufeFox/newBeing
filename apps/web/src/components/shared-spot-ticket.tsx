"use client";

import { useEffect, useState } from "react";
import { spotBuyQuantity, type ExchangeId, type SpotAccount } from "@newbeing/core";
import { Button } from "@/components/ui/button";

export function SharedSpotTicket({ exchange, symbol, referencePrice }: { exchange: ExchangeId; symbol: string; referencePrice: number | null }) {
  const quote = symbol.split("/")[1]!;
  const [account, setAccount] = useState<SpotAccount | null>(null);
  const [quantity, setQuantity] = useState("0.001");
  const [maximumPrice, setMaximumPrice] = useState(referencePrice ? String(referencePrice * 1.005) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/spot?exchange=${exchange}&quote=${quote}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Shared account read failed.");
      setAccount(payload.account);
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [exchange, quote]);
  async function command(action: "open" | "order" | "cancel", side?: "buy" | "sell", clientOrderId?: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/spot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "order" ? { action, exchange, symbol, side, quantity: Number(quantity), maximumPrice: Number(maximumPrice), clientOrderId: requestId } : { action, exchange, quote, ...(clientOrderId ? { clientOrderId } : {}) }) });
      const payload = await response.json();
      if (payload.account) setAccount(payload.account);
      if ((action === "order" && payload.order && !["submitted", "unknown"].includes(payload.order.status)) || (action === "cancel" && clientOrderId === requestId)) setRequestId(crypto.randomUUID());
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Order rejected; reservation released.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Shared spot command failed."); }
    finally { setBusy(false); }
  }
  function sizeBudget(fraction: number) {
    try {
      const balance = account?.balances[quote];
      const budget = Math.floor(((balance?.total ?? 0) - (balance?.reserved ?? 0)) * fraction * 1e8) / 1e8;
      setQuantity(String(spotBuyQuantity(budget, Number(maximumPrice), account?.feeRate ?? 0.001)));
      setRequestId(crypto.randomUUID());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Cannot size this order."); }
  }
  return <div className="p-3 space-y-2 text-xs border-t border-[var(--ak-border-subtle)]" data-testid="shared-spot-ticket">
    <strong>Shared spot · {exchange} · {quote}</strong>
    <p>One quote wallet across pairs. Legacy balances stay in their original accounts. Fees are included in budget sizing.</p>
    {!account ? <Button disabled={busy} onClick={() => void command("open")}>Open new 10,000 {quote} account</Button> : <>
      <div className="space-y-1">{Object.entries(account.balances).map(([asset, balance]) => <div key={asset}>{asset}: {balance.total} · reserved {balance.reserved}</div>)}</div>
      <label className="flex flex-col">Quantity<input aria-label="Shared spot quantity" type="number" min="0" step="any" value={quantity} onChange={(event) => { setQuantity(event.target.value); setRequestId(crypto.randomUUID()); }} /></label>
      <label className="flex flex-col">Maximum buy price / sizing reference<input aria-label="Shared spot maximum price" type="number" min="0" step="any" value={maximumPrice} onChange={(event) => { setMaximumPrice(event.target.value); setRequestId(crypto.randomUUID()); }} /></label>
      <div className="flex gap-1">{[0.25, 0.5, 1].map((fraction) => <Button key={fraction} size="sm" disabled={busy} onClick={() => sizeBudget(fraction)}>{fraction * 100}%</Button>)}</div>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void command("order", "buy")}>Buy spot</Button><Button disabled={busy} onClick={() => void command("order", "sell")}>Sell inventory</Button></div>
      {account.orders.slice(-5).reverse().map((order) => <div key={order.clientOrderId}>{order.symbol} {order.side} {order.quantity} · {order.status}{["unknown", "submitted"].includes(order.status) && <Button size="sm" disabled={busy} onClick={() => void command("cancel", undefined, order.clientOrderId)}>Cancel / release</Button>}</div>)}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
