import { addQuantity, decimal, estimatePaperAmounts, money, quantityUnits, subtractQuantity, validateMoney } from "./ledger.js";

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
  /** Null identifies legacy orders whose wallet cannot be proved. */
  accountId?: string | null;
}

export interface PaperPortfolio {
  quoteBalance: number;
  baseBalance: number;
  averageEntryPrice: number | null;
  /** Remaining entry cost including fees; legacy wallets derive it once from their saved average. */
  costBasis?: number;
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
  quantityUnits(portfolio.baseBalance);
  validateMoney(portfolio.quoteBalance);
  validateMoney(portfolio.realizedPnl);
  if (portfolio.quoteBalance < 0 || (portfolio.baseBalance > 0 && (portfolio.averageEntryPrice === null || !Number.isFinite(portfolio.averageEntryPrice) || portfolio.averageEntryPrice < 0 || (portfolio.averageEntryPrice === 0 && portfolio.costBasis !== 0)))) throw new Error("Invalid paper portfolio.");
  const previousCost = portfolio.costBasis ?? money(decimal(portfolio.averageEntryPrice ?? 0).times(portfolio.baseBalance));
  validateMoney(previousCost);
  if (previousCost < 0) throw new Error("Invalid paper cost basis.");
  const { notional, fee } = estimatePaperAmounts(price, order.quantity, portfolio.feeRate);
  if (order.side === "buy") {
    const total = money(decimal(notional).plus(fee));
    if (total > portfolio.quoteBalance) throw new Error("Insufficient paper quote balance.");
    const newBaseBalance = addQuantity(portfolio.baseBalance, order.quantity);
    const costBasis = money(decimal(previousCost).plus(total));
    const newPortfolio: PaperPortfolio = {
      ...portfolio,
      quoteBalance: money(decimal(portfolio.quoteBalance).minus(total)),
      baseBalance: newBaseBalance,
      costBasis,
      averageEntryPrice: decimal(costBasis).div(newBaseBalance).toNumber(),
    };
    return { order: { ...transitionPaperOrder(order, "fill"), fillPrice: price, fee }, portfolio: newPortfolio };
  }
  const remaining = subtractQuantity(portfolio.baseBalance, order.quantity);
  const allocatedCost = remaining === 0 ? previousCost : money(decimal(previousCost).times(order.quantity).div(portfolio.baseBalance));
  const costBasis = money(decimal(previousCost).minus(allocatedCost));
  const newPortfolio: PaperPortfolio = {
    ...portfolio,
    quoteBalance: money(decimal(portfolio.quoteBalance).plus(notional).minus(fee)),
    baseBalance: remaining,
    costBasis,
    averageEntryPrice: remaining === 0 ? null : decimal(costBasis).div(remaining).toNumber(),
    realizedPnl: money(decimal(portfolio.realizedPnl).plus(notional).minus(fee).minus(allocatedCost)),
  };
  return { order: { ...transitionPaperOrder(order, "fill"), fillPrice: price, fee }, portfolio: newPortfolio };
}
