export type PaperOrderStatus = "created" | "submitted" | "filled" | "rejected" | "cancelled" | "unknown";
export type PaperOrderSide = "buy" | "sell";

export interface PaperOrder {
  clientOrderId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  status: PaperOrderStatus;
  fillPrice: number | null;
  fee: number;
  createdAt: string;
}

export interface PaperPortfolio {
  quoteBalance: number;
  baseBalance: number;
  averageEntryPrice: number | null;
  realizedPnl: number;
  feeRate: number;
}

export type PaperOrderEvent = "submit" | "fill" | "reject" | "cancel" | "mark-unknown";

const NEXT_STATUS: Record<PaperOrderStatus, Partial<Record<PaperOrderEvent, PaperOrderStatus>>> = {
  created: { submit: "submitted", reject: "rejected", cancel: "cancelled" },
  submitted: { fill: "filled", reject: "rejected", cancel: "cancelled", "mark-unknown": "unknown" },
  filled: {},
  rejected: {},
  cancelled: {},
  unknown: { fill: "filled", reject: "rejected" },
};

export function transitionPaperOrder(order: PaperOrder, event: PaperOrderEvent): PaperOrder {
  const status = NEXT_STATUS[order.status][event];
  if (!status) throw new Error(`Invalid paper order transition: ${order.status} -> ${event}.`);
  return { ...order, status };
}

export function fillPaperOrder(
  order: PaperOrder,
  portfolio: PaperPortfolio,
  price: number,
): { order: PaperOrder; portfolio: PaperPortfolio } {
  if (order.status !== "submitted" && order.status !== "unknown") throw new Error("Only submitted or ambiguous orders may be reconciled with a fill.");
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(order.quantity) || order.quantity <= 0) {
    throw new Error("A finite positive price and quantity are required.");
  }
  if (!Number.isFinite(portfolio.feeRate) || portfolio.feeRate < 0 || portfolio.feeRate > 0.05) {
    throw new Error("Paper fee rate is outside the supported range.");
  }
  const notional = price * order.quantity;
  const fee = notional * portfolio.feeRate;
  if (order.side === "buy") {
    const total = notional + fee;
    if (total > portfolio.quoteBalance) throw new Error("Insufficient paper quote balance.");
    const previousCost = (portfolio.averageEntryPrice ?? 0) * portfolio.baseBalance;
    const newBaseBalance = portfolio.baseBalance + order.quantity;
    const newPortfolio: PaperPortfolio = {
      ...portfolio,
      quoteBalance: portfolio.quoteBalance - total,
      baseBalance: newBaseBalance,
      // Entry fee is included in cost basis so partial sales do not overstate realized PnL.
      averageEntryPrice: newBaseBalance > 0 ? (previousCost + notional + fee) / newBaseBalance : null,
    };
    return { order: { ...transitionPaperOrder(order, "fill"), fillPrice: price, fee }, portfolio: newPortfolio };
  }
  if (order.quantity > portfolio.baseBalance) throw new Error("Insufficient paper base balance.");
  const pnl = portfolio.averageEntryPrice === null ? 0 : (price - portfolio.averageEntryPrice) * order.quantity;
  const remaining = portfolio.baseBalance - order.quantity;
  const newPortfolio: PaperPortfolio = {
    ...portfolio,
    quoteBalance: portfolio.quoteBalance + notional - fee,
    baseBalance: remaining,
    averageEntryPrice: remaining === 0 ? null : portfolio.averageEntryPrice,
    realizedPnl: portfolio.realizedPnl + pnl - fee,
  };
  return { order: { ...transitionPaperOrder(order, "fill"), fillPrice: price, fee }, portfolio: newPortfolio };
}
