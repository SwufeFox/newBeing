import { beginPaperIntent, finalizePaperFill, markPaperIntentSubmitted, replayAccountId, getPaperPortfolio } from "@newbeing/storage";
import type { PaperOrderSide, ReplayOrderInput } from "@newbeing/core";
import { commandReplay, getReplayExecution, getReplaySession } from "@newbeing/storage";

export interface ExecuteReplayOrderRequest {
  sessionId: string;
  clientOrderId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  /** Legacy callers may send a reference price; it never determines a fill. */
  price?: number;
  type?: ReplayOrderInput["type"];
  triggerPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  expectedRevision?: number;
}

export function executePendingReplayOrder(request: ExecuteReplayOrderRequest) {
  const session = getReplaySession(request.sessionId);
  const current = getReplayExecution(request.sessionId);
  if (!session || !current) throw new Error("Configured Replay session required; upgrade legacy metadata first.");
  if (session.symbol !== request.symbol) throw new Error("Replay order instrument mismatch.");
  const deduplicated = current.orders.some((order) => order.clientOrderId === request.clientOrderId);
  const state = commandReplay(request.sessionId, request.expectedRevision ?? current.revision, { action: "order", order: {
    clientOrderId: request.clientOrderId, side: request.side, quantity: request.quantity,
    type: request.type ?? "market", ...(request.triggerPrice !== undefined ? { price: request.triggerPrice } : {}), ...(request.stopLoss !== undefined ? { stopLoss: request.stopLoss } : {}), ...(request.takeProfit !== undefined ? { takeProfit: request.takeProfit } : {}),
  } });
  return { order: state.orders.find((order) => order.clientOrderId === request.clientOrderId)!, portfolio: state.portfolio, deduplicated };
}

/** Legacy immediate-fill contract. Configured sessions must use executePendingReplayOrder. */
export function executeReplayOrder(request: ExecuteReplayOrderRequest & { price: number }) {
  if (getReplayExecution(request.sessionId)) throw new Error("Configured Replay requires executePendingReplayOrder.");
  const session = getReplaySession(request.sessionId);
  if (session && (session.symbol !== request.symbol || session.status !== "active")) throw new Error("Legacy Replay session mismatch or finished.");
  const accountId = replayAccountId(request.sessionId, request.symbol, session?.exchange);
  const intent = beginPaperIntent({ clientOrderId: request.clientOrderId, symbol: request.symbol, side: request.side, quantity: request.quantity }, accountId);
  if (intent.deduplicated) return { order: intent.order, portfolio: intent.portfolio, deduplicated: true };
  const submitted = markPaperIntentSubmitted(request.clientOrderId);
  if (submitted.status !== "submitted") return { order: submitted, portfolio: getPaperPortfolio(accountId), deduplicated: true };
  return finalizePaperFill(request.clientOrderId, request.price, accountId);
}
