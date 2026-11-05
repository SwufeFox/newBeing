"use client";

import { useEffect, useState } from "react";
import type { PaperOrder } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { translate, useCopy, type CopyTable } from "@/lib/i18n";

type Recovery = { clientOrderId: string; accountId: string | null; reason: string; previousStatus: string; requiresReview: boolean };

interface PaperRecoveryCopy {
  recoveryFailed: string;
  recoveryLost: string;
  account: string;
  unboundLegacyReview: string;
  cancellationReason: string;
  reasonLabel: (clientOrderId: string) => string;
  retryCancellation: string;
  cancelPending: string;
  auditActive: string;
  readingAccounts: string;
  zeroPending: string;
  syncing: string;
  pendingAudit: (count: number) => string;
  interruptedIntents: string;
  statusUnavailable: string;
  readFailed: string;
  cancelled: string;
  unboundLegacy: string;
  reviewRequired: string;
}

const PAPER_RECOVERY_COPY: CopyTable<PaperRecoveryCopy> = {
  en: {
    recoveryFailed: "Recovery failed; refresh the saved status.",
    recoveryLost: "Recovery response lost; retry the same action.",
    account: "Account:",
    unboundLegacyReview: "Unbound legacy · manual review required",
    cancellationReason: "Cancellation audit reason",
    reasonLabel: (clientOrderId) => `Recovery reason ${clientOrderId}`,
    retryCancellation: "Retry saved cancellation",
    cancelPending: "Cancel pending Paper",
    auditActive: "RECOVERY AUDIT ACTIVE",
    readingAccounts: "READING ACCOUNTS…",
    zeroPending: "0 PENDING",
    syncing: "SYNCING",
    pendingAudit: (count) => `PENDING AUDIT (${count})`,
    interruptedIntents: "INTERRUPTED INTENTS",
    statusUnavailable: "Pending Paper status unavailable.",
    readFailed: "Pending Paper read failed.",
    cancelled: "cancelled",
    unboundLegacy: "Unbound legacy",
    reviewRequired: "Manual review required · ownership or saved fill fields cannot be verified. Wallet unchanged.",
  },
  zh: {
    recoveryFailed: "恢复失败；请刷新已保存的状态。",
    recoveryLost: "恢复响应丢失；请重试同一操作。",
    account: "账户：",
    unboundLegacyReview: "未绑定旧账户 · 需人工复核",
    cancellationReason: "取消操作审计原因",
    reasonLabel: (clientOrderId) => `恢复原因 ${clientOrderId}`,
    retryCancellation: "重试已保存的取消",
    cancelPending: "取消待处理模拟盘委托",
    auditActive: "恢复审计已启用",
    readingAccounts: "正在读取账户…",
    zeroPending: "0 待处理",
    syncing: "同步中",
    pendingAudit: (count) => `待处理审计 (${count})`,
    interruptedIntents: "中断的委托",
    statusUnavailable: "待处理模拟盘状态不可用。",
    readFailed: "待处理模拟盘读取失败。",
    cancelled: "已取消",
    unboundLegacy: "未绑定旧账户",
    reviewRequired: "需人工复核 · 无法核实归属或已保存的成交字段。钱包未变动。",
  },
};

function PendingIntent({ order, onRecovered }: { order: PaperOrder; onRecovered: (settled: { order: PaperOrder; recovery: Recovery }) => void }): React.JSX.Element {
  const copy = useCopy(PAPER_RECOVERY_COPY);
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
      if (!response.ok) throw new Error(result.error ?? translate(PAPER_RECOVERY_COPY).recoveryFailed);
      /* The server committed the terminal state; show it now instead of leaving
         the card claiming "submitted" until the next poll catches up. */
      if (result.order && result.recovery) onRecovered({ order: result.order, recovery: result.recovery });
      else onRecovered({ order: { ...order, status: "cancelled" }, recovery: { clientOrderId: order.clientOrderId, accountId: order.accountId ?? null, reason: saved.reason, previousStatus: order.status, requiresReview: false } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : translate(PAPER_RECOVERY_COPY).recoveryLost);
    } finally { setBusy(false); }
  };
  return <div className="order-preview-card">
    <strong>{order.symbol} · {order.side} {order.quantity} · {order.status}</strong>
    <small>{order.clientOrderId}</small>
    <small>{copy.account} {order.accountId ?? copy.unboundLegacyReview}</small>
    <label className="ticket-field"><span>{copy.cancellationReason}</span><input aria-label={copy.reasonLabel(order.clientOrderId)} maxLength={2000} value={reason} disabled={!!attempt} onChange={(event) => setReason(event.target.value)} /></label>
    <Button size="sm" variant="ghost" disabled={busy || !reason.trim()} onClick={() => void cancel()}>{attempt ? copy.retryCancellation : copy.cancelPending}</Button>
    {error && <div className="error-inline">{error}</div>}
  </div>;
}

export function PaperRecoveryPanel(): React.JSX.Element {
  const copy = useCopy(PAPER_RECOVERY_COPY);
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
        if (!response.ok) throw new Error(translate(PAPER_RECOVERY_COPY).statusUnavailable);
        const payload = await response.json() as Partial<{ pending: PaperOrder[]; recoveries: Recovery[] }>;
        if (!Array.isArray(payload.pending) || !Array.isArray(payload.recoveries)) throw new Error(translate(PAPER_RECOVERY_COPY).statusUnavailable);
        if (!disposed) { setPending(payload.pending); setRecoveries(payload.recoveries); setError(null); setLoaded(true); }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : translate(PAPER_RECOVERY_COPY).readFailed);
      }
    };
    void refresh();
    const interval = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, 8000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [revision]);
  return <div data-testid="paper-recovery" data-loaded={loaded ? "true" : "false"}>
    {pending.length === 0 && recoveries.length === 0 ? (
      <div className="ticket-disclaimer flex items-center justify-between text-[9px] font-mono text-[var(--ak-text-secondary)] opacity-60 px-2.5 py-1.5 border-t border-[var(--ak-border-subtle)]">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full motion-reduce:animate-none ${loaded ? "bg-emerald-500/80" : "bg-amber-500/80 animate-pulse"}`} />
          <span>{loaded ? copy.auditActive : copy.readingAccounts}</span>
        </div>
        <span className="tabular-nums font-bold text-[8px] uppercase tracking-wider">{loaded ? copy.zeroPending : copy.syncing}</span>
      </div>
    ) : (
      <div className="ticket-disclaimer flex items-center justify-between text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2.5 py-1.5 border-t border-amber-500/30">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse motion-reduce:animate-none" />
          <span>{copy.pendingAudit(pending.length)}</span>
        </div>
        <span className="text-[9px] uppercase tracking-wider font-bold">{copy.interruptedIntents}</span>
      </div>
    )}
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
      <small>{recovery.clientOrderId} · {recovery.previousStatus} → {copy.cancelled}</small>
      <small>{recovery.accountId ?? copy.unboundLegacy} · {recovery.reason}</small>
      {recovery.requiresReview && <strong>{copy.reviewRequired}</strong>}
    </div>)}
    {error && <div className="error-inline">{error}</div>}
  </div>;
}
