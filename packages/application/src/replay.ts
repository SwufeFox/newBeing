import { type PaperOrderSide } from "@newbeing/core";
import {
  beginPaperIntent,
  finalizePaperFill,
  markPaperIntentSubmitted,
  replayAccountId,
  getPaperPortfolio,
} from "@newbeing/storage";

export interface ExecuteReplayOrderRequest {
  sessionId: string;
  clientOrderId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  price: number;
}

export function executeReplayOrder(request: ExecuteReplayOrderRequest) {
  const accountId = replayAccountId(request.sessionId, request.symbol);
  const intent = beginPaperIntent({
    clientOrderId: request.clientOrderId,
    symbol: request.symbol,
    side: request.side,
    quantity: request.quantity,
  }, accountId);
  if (intent.deduplicated) return { order: intent.order, portfolio: intent.portfolio, deduplicated: true };
  const submitted = markPaperIntentSubmitted(request.clientOrderId);
  if (submitted.status !== "submitted") {
    return { order: submitted, portfolio: getPaperPortfolio(accountId), deduplicated: true };
  }
  const result = finalizePaperFill(request.clientOrderId, request.price, accountId);
  return result;
}
