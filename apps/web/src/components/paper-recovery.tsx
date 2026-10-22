"use client";

import { useEffect, useState } from "react";
import type { PaperOrder } from "@newbeing/core";
import { Button } from "@/components/ui/button";

type Recovery = { clientOrderId: string; accountId: string | null; reason: string; previousStatus: string; requiresReview: boolean };

function PendingIntent({ order, onRecovered }: { order: PaperOrder; onRecovered: (settled: { order: PaperOrder; recovery: Recovery }) => void }): React.JSX.Element {
  const [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState<{ actionId: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = async (): Promise<void> => {
    const saved = attempt ?? { actionId: crypto.randomUUID(), reason: reason.trim() };
    setAttempt(saved);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/paper/recovery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", clientOrderId: order.clientOrderId, ...saved }),
      });
      const result = await response.json() as { error?: string; order?: PaperOrder; recovery?: Recovery };
      if (!response.ok) throw new Error(result.error ?? "Recovery failed; refresh the saved status.");
      /* The server committed the terminal state; show it now instead of leaving
         the card claiming "submitted" until the next poll catches up. */
      if (result.order && result.recovery) onRecovered({ order: result.order, recovery: result.recovery });
      else onRecovered({ order: { ...order, status: "cancelled" }, recovery: { clientOrderId: order.clientOrderId, accountId: order.accountId ?? null, reason: saved.reason, previousStatus: order.status, requiresReview: false } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Recovery response lost; retry the same action.");
    } finally { setBusy(false); }
  };
  return <div className="order-preview-card">
    <strong>{order.symbol} · {order.side} {order.quantity} · {order.status}</strong>
    <small>{order.clientOrderId}</small>
    <small>Account: {order.accountId ?? "Unbound legacy · manual review required"}</small>
    <label className="ticket-field"><span>Cancellation audit reason</span><input aria-label={`Recovery reason ${order.clientOrderId}`} maxLength={2000} value={reason} disabled={!!attempt} onChange={(event) => setReason(event.target.value)} /></label>
    <Button size="sm" variant="ghost" disabled={busy || !reason.trim()} onClick={() => void cancel()}>{attempt ? "Retry saved cancellation" : "Cancel pending Paper"}</Button>
    {error && <div className="error-inline">{error}</div>}
  </div>;
}

export function PaperRecoveryPanel(): React.JSX.Element {
  const [pending, setPending] = useState<PaperOrder[]>([]);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  /* "0 pending" is a claim about the account, not a starting assumption. Until a
     read actually succeeds this stays false, so an unread or failed panel cannot
     be mistaken for an empty one. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch("/api/paper/recovery", { cache: "no-store" });
        if (!response.ok) throw new Error("Pending Paper status unavailable.");
        const payload = await response.json() as { pending: PaperOrder[]; recoveries: Recovery[] };
        if (!disposed) { setPending(payload.pending); setRecoveries(payload.recoveries); setError(null); setLoaded(true); }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : "Pending Paper read failed.");
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 8000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [revision]);
  return <div data-testid="paper-recovery" data-loaded={loaded ? "true" : "false"}>
    <div className="ticket-disclaimer">
      {loaded
        ? `Pending Paper · all accounts · ${pending.length}. Cancellation preserves wallets and prevents delayed quotes from filling. To trade again, create a new order.`
        : "Pending Paper · reading local accounts…"}
    </div>
    {pending.map((order) => (
      <PendingIntent
        key={order.clientOrderId}
        order={order}
        onRecovered={(settled) => {
          /* Apply the committed result locally first, then re-read: a failed
             refresh must not resurrect a card the database already cancelled. */
          setPending((current) => current.filter((item) => item.clientOrderId !== settled.order.clientOrderId));
          setRecoveries((current) => [settled.recovery, ...current.filter((item) => item.clientOrderId !== settled.recovery.clientOrderId)]);
          setRevision((value) => value + 1);
        }}
      />
    ))}
    {recoveries.map((recovery) => <div className="order-preview-card" key={recovery.clientOrderId}>
      <small>{recovery.clientOrderId} · {recovery.previousStatus} → cancelled</small>
      <small>{recovery.accountId ?? "Unbound legacy"} · {recovery.reason}</small>
      {recovery.requiresReview && <strong>Manual review required · ownership or saved fill fields cannot be verified. Wallet unchanged.</strong>}
    </div>)}
    {error && <div className="error-inline">{error}</div>}
  </div>;
}
