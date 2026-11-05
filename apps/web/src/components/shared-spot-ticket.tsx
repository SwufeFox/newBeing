"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { spotBuyQuantity, type ExchangeId, type SpotAccount } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { translate, useCopy, type CopyTable } from "@/lib/i18n";

type TicketProps = { exchange: ExchangeId; symbol: string; referencePrice: number | null };
type Intent = { clientOrderId: string; side: "buy" | "sell"; quantity: number; maximumPrice: number };

interface SharedSpotTicketCopy {
  accountMismatch: string;
  readFailed: string;
  responseIncomplete: string;
  positiveNumbers: string;
  commandFailed: string;
  submitted: (side: "buy" | "sell" | undefined) => string;
  setMaximumPrice: string;
  cannotSize: string;
  sharedSpot: string;
  refresh: string;
  description: string;
  loading: string;
  openAccount: (quote: string) => string;
  reserved: string;
  closeFull: string;
  closeFullTitle: string;
  quantity: string;
  toggleSide: string;
  toggleSideTitle: string;
  sizingBuy: string;
  sizingSell: string;
  quantityLabel: string;
  decrease: string;
  increase: string;
  maximumPrice: string;
  maximumPriceLabel: string;
  refLabel: string;
  reference: string;
  reset: string;
  quotePct: string;
  inventoryPct: string;
  retryBuy: string;
  buySpot: string;
  retrySell: string;
  sellInventory: string;
  recentOrders: string;
  cancelRelease: string;
  pendingNotice: string;
}

const SPOT_TICKET_COPY: CopyTable<SharedSpotTicketCopy> = {
  en: {
    accountMismatch: "The returned account belongs to a different market.",
    readFailed: "Shared account read failed.",
    responseIncomplete: "Shared account response was incomplete.",
    positiveNumbers: "Quantity and maximum price must be positive numbers.",
    commandFailed: "Shared spot command failed.",
    submitted: (side) => `${side ? side.toUpperCase() : "Order"} submitted to shared spot account`,
    setMaximumPrice: "Set a valid maximum price before sizing budget.",
    cannotSize: "Cannot size this order.",
    sharedSpot: "Shared spot",
    refresh: "Refresh shared account",
    description: "One quote wallet across pairs. Legacy balances stay in their original accounts. Fees are included in budget sizing.",
    loading: "Loading shared account…",
    openAccount: (quote) => `Open new 10,000 ${quote} account`,
    reserved: "reserved",
    closeFull: "Close 100%",
    closeFullTitle: "Set full base inventory quantity to sell",
    quantity: "Quantity",
    toggleSide: "Toggle sizing side",
    toggleSideTitle: "Click to toggle between Quote (Buy) and Inventory (Sell) sizing",
    sizingBuy: "SIZING · BUY",
    sizingSell: "SIZING · SELL",
    quantityLabel: "Shared spot quantity",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    maximumPrice: "Maximum buy price / sizing reference",
    maximumPriceLabel: "Shared spot maximum price",
    refLabel: "Ref:",
    reference: "Ref",
    reset: "Reset",
    quotePct: "Quote %:",
    inventoryPct: "Inv %:",
    retryBuy: "Retry same buy",
    buySpot: "Buy spot",
    retrySell: "Retry same sell",
    sellInventory: "Sell inventory",
    recentOrders: "Recent Spot Orders",
    cancelRelease: "Cancel / release",
    pendingNotice: "Keep this order unchanged until its outcome is confirmed. Refresh or retry the same order to check it.",
  },
  zh: {
    accountMismatch: "返回的账户属于其他市场。",
    readFailed: "共享账户读取失败。",
    responseIncomplete: "共享账户响应不完整。",
    positiveNumbers: "数量与最高价必须为正数。",
    commandFailed: "共享现货指令失败。",
    submitted: (side) => `${side === "buy" ? "买入" : side === "sell" ? "卖出" : "委托"}已提交至共享现货账户`,
    setMaximumPrice: "请先设置有效的最高价再计算规模。",
    cannotSize: "无法计算该委托规模。",
    sharedSpot: "共享现货",
    refresh: "刷新共享账户",
    description: "同一计价资产在全部交易对间共用一个钱包。旧账户余额保留在原账户。预算计算已包含手续费。",
    loading: "正在读取共享账户…",
    openAccount: (quote) => `开立新的 10,000 ${quote} 账户`,
    reserved: "冻结",
    closeFull: "平仓 100%",
    closeFullTitle: "将全部基础资产库存设为卖出数量",
    quantity: "数量",
    toggleSide: "切换规模方向",
    toggleSideTitle: "点击在报价（买入）与库存（卖出）规模间切换",
    sizingBuy: "规模 · 买入",
    sizingSell: "规模 · 卖出",
    quantityLabel: "共享现货数量",
    decrease: "减少数量",
    increase: "增加数量",
    maximumPrice: "最高买入价 / 规模参考价",
    maximumPriceLabel: "共享现货最高价",
    refLabel: "参考：",
    reference: "参考",
    reset: "重置",
    quotePct: "报价 %:",
    inventoryPct: "库存 %:",
    retryBuy: "重试同一买入",
    buySpot: "买入现货",
    retrySell: "重试同一卖出",
    sellInventory: "卖出库存",
    recentOrders: "近期现货委托",
    cancelRelease: "取消 / 释放",
    pendingNotice: "结果确认前请勿改动该委托。刷新或重试同一委托以核对状态。",
  },
};

export function SharedSpotTicket(props: TicketProps) {
  return <MarketSpotTicket key={`${props.exchange}:${props.symbol}`} {...props} />;
}

function MarketSpotTicket({ exchange, symbol, referencePrice }: TicketProps) {
  const copy = useCopy(SPOT_TICKET_COPY);
  const quote = symbol.split("/")[1]!;
  const base = symbol.split("/")[0]!;
  const [account, setAccount] = useState<SpotAccount | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">("loading");
  const [quantity, setQuantity] = useState("0.001");
  const [sizingSide, setSizingSide] = useState<"buy" | "sell">("buy");
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const intentRef = useRef<Intent | null>(null);
  const transportUncertain = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const commandController = useRef<AbortController | null>(null);
  const maximumPrice = priceDraft ?? (referencePrice && referencePrice > 0 ? String(referencePrice * 1.005) : "");

  const applyAccount = useCallback((next: SpotAccount | null) => {
    if (next && (next.exchange !== exchange || next.quote !== quote)) throw new Error(translate(SPOT_TICKET_COPY).accountMismatch);
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
      if (!response.ok) throw new Error(payload.error ?? translate(SPOT_TICKET_COPY).readFailed);
      if (!mounted.current || signal?.aborted || revision.current !== currentRevision) return;
      if (!("account" in payload)) throw new Error(translate(SPOT_TICKET_COPY).responseIncomplete);
      applyAccount(payload.account);
      setReadState("ready");
    } catch (reason) {
      if (!mounted.current || signal?.aborted || revision.current !== currentRevision) return;
      setReadState("error");
      setError(reason instanceof Error ? reason.message : translate(SPOT_TICKET_COPY).readFailed);
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
          setError(translate(SPOT_TICKET_COPY).positiveNumbers);
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
      if (!response.ok || payload.error) throw new Error(payload.error ?? translate(SPOT_TICKET_COPY).commandFailed);
      if (action === "order") {
        setNotice(translate(SPOT_TICKET_COPY).submitted(side));
        window.setTimeout(() => setNotice(null), 3000);
      }
    } catch (reason) {
      if (!receivedOutcome && action === "order") transportUncertain.current = true;
      if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : translate(SPOT_TICKET_COPY).commandFailed);
    } finally {
      inFlight.current = false;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }

  function sizeBudget(fraction: number) {
    try {
      if (sizingSide === "buy") {
        const balance = account?.balances[quote];
        const budget = Math.floor(((balance?.total ?? 0) - (balance?.reserved ?? 0)) * fraction * 1e8) / 1e8;
        const priceNum = Number(maximumPrice);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          setError(translate(SPOT_TICKET_COPY).setMaximumPrice);
          return;
        }
        setQuantity(String(spotBuyQuantity(budget, priceNum, account?.feeRate ?? 0.001)));
      } else {
        const balance = account?.balances[base];
        const avail = Math.max(0, (balance?.total ?? 0) - (balance?.reserved ?? 0));
        const qty = fraction === 1 ? avail : Math.floor(avail * fraction * 1e4) / 1e4;
        setQuantity(qty > 0 ? String(qty) : "0");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : translate(SPOT_TICKET_COPY).cannotSize); }
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

  const commandRef = useRef(command);
  useEffect(() => {
    commandRef.current = command;
  });

  useEffect(() => {
    const handleBuy = () => {
      if (!inFlight.current && readState === "ready") {
        void commandRef.current("order", "buy");
      }
    };
    const handleSell = () => {
      if (!inFlight.current && readState === "ready") {
        void commandRef.current("order", "sell");
      }
    };
    window.addEventListener("newbeing:hotkey-buy", handleBuy);
    window.addEventListener("newbeing:hotkey-sell", handleSell);
    return () => {
      window.removeEventListener("newbeing:hotkey-buy", handleBuy);
      window.removeEventListener("newbeing:hotkey-sell", handleSell);
    };
  }, [readState, quantity, maximumPrice]);

  const unavailable = busy || readState !== "ready";
  return (
    <div className="p-3 space-y-2.5 text-xs border-t border-[var(--ak-border-subtle)] font-mono" data-testid="shared-spot-ticket" data-loaded={readState === "ready"}>
      <div className="flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
        <strong className="text-[11px] uppercase tracking-wider text-[var(--ak-signal-info)]">{copy.sharedSpot} · {exchange} · {quote}</strong>
        {readState !== "loading" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void readAccount()} className="h-6 text-[10px] px-2">
            {copy.refresh}
          </Button>
        )}
      </div>

      <p className="text-[10px] text-[var(--ak-text-secondary)] opacity-80 leading-relaxed">
        {copy.description}
      </p>

      {readState === "loading" && <p role="status" className="py-2 text-center text-[var(--ak-text-secondary)]">{copy.loading}</p>}

      {readState === "ready" && (!account ? (
        <div className="py-2">
          <Button block variant="primary" disabled={busy} onClick={() => void command("open")} className="w-full text-xs py-2">
            {copy.openAccount(quote)}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 p-2 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[10px]">
            {Object.entries(account.balances).map(([asset, balance]) => {
              const avail = Math.max(0, balance.total - balance.reserved);
              return (
                <div key={asset} className="flex items-center justify-between">
                  <span className="text-[var(--ak-text-secondary)] font-bold">{asset}: {balance.total} · {copy.reserved} {balance.reserved}</span>
                  {asset === base && avail > 0 && (
                    <button
                      type="button"
                      disabled={unavailable || !!intent}
                      onClick={() => {
                        setSizingSide("sell");
                        setQuantity(String(avail));
                      }}
                      className="ml-1 text-[8px] px-1 py-0.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/40 text-rose-300 font-bold uppercase transition-all active:scale-95 cursor-pointer"
                      title={copy.closeFullTitle}
                    >
                      {copy.closeFull}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-1">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase tracking-wider">{copy.quantity} ({base})</span>
                <button
                  type="button"
                  aria-pressed={sizingSide === "buy"}
                  aria-label={copy.toggleSide}
                  onClick={() => setSizingSide((prev) => (prev === "buy" ? "sell" : "buy"))}
                  className="text-[9px] px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[var(--ak-signal-info)] hover:text-white uppercase font-bold transition-all cursor-pointer"
                  title={copy.toggleSideTitle}
                >
                  {sizingSide === "buy" ? copy.sizingBuy : copy.sizingSell}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <input
                  aria-label={copy.quantityLabel}
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
                  aria-label={copy.decrease}
                  className="px-2 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] select-none"
                >
                  -
                </button>
                <button
                  type="button"
                  disabled={busy || !!intent}
                  onClick={() => stepQuantity(1)}
                  aria-label={copy.increase}
                  className="px-2 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] select-none"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase tracking-wider">{copy.maximumPrice}</span>
              <input
                aria-label={copy.maximumPriceLabel}
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
                <span>{copy.refLabel}</span>
                <button
                  type="button"
                  disabled={busy || !!intent}
                  onClick={() => fillRefPrice(1.0)}
                  className="px-1.5 py-0.5 border border-[var(--ak-border-subtle)] hover:border-[var(--ak-signal-info)] active:scale-95 text-[var(--ak-signal-info)]"
                >
                  {copy.reference} {referencePrice}
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
                    {copy.reset}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 pt-0.5">
            <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase tracking-wider mr-1">
              {sizingSide === "buy" ? copy.quotePct : copy.inventoryPct}
            </span>
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
              onMouseEnter={() => setSizingSide("buy")}
              className="py-2 text-xs font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-600/30 active:scale-95 transition-transform"
            >
              {intent?.side === "buy" ? copy.retryBuy : copy.buySpot}
            </Button>
            <Button
              disabled={unavailable || (!!intent && intent.side !== "sell")}
              onClick={() => void command("order", "sell")}
              onMouseEnter={() => setSizingSide("sell")}
              className="py-2 text-xs font-bold bg-rose-600/20 text-rose-400 border border-rose-500/40 hover:bg-rose-600/30 active:scale-95 transition-transform"
            >
              {intent?.side === "sell" ? copy.retrySell : copy.sellInventory}
            </Button>
          </div>

          {account.orders.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-[var(--ak-border-subtle)]">
              <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase tracking-wider font-bold">{copy.recentOrders}</span>
              {account.orders.slice(-5).reverse().map((order) => (
                <div key={order.clientOrderId} className="flex justify-between items-center p-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] text-[10px]">
                  <span>{order.symbol} {order.side} {order.quantity} · <span className="text-[var(--ak-signal-info)]">{order.status}</span></span>
                  {["unknown", "submitted"].includes(order.status) && (
                    <Button size="sm" variant="outline" disabled={unavailable} onClick={() => void command("cancel", undefined, order.clientOrderId)} className="h-5 text-[9px] px-1.5">
                      {copy.cancelRelease}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ))}

      {notice && <p role="status" className="p-1.5 bg-emerald-950/20 border border-emerald-800/40 text-[10px] text-[var(--ak-signal-success)] font-mono">{notice}</p>}
      {intent && <p role="status" className="p-1.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-signal-action)] text-[10px] text-[var(--ak-signal-action)]">{copy.pendingNotice}</p>}
      {error && <p role="alert" className="p-1.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-signal-danger)] text-[10px] text-[var(--ak-signal-danger)]">{error}</p>}
    </div>
  );
}
