import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { Candle, ReplayExecution, ReplayOrder, ReplaySession } from "@newbeing/core";

export const REPLAY_INTERVAL = 24 * 60 * 60_000;
export const REPLAY_MARKET = { exchange: "binance", symbol: "BTC/USDT", timeframe: "1d" } as const;
export const TRAINING_CONFIG = { initialCapital: 25_000, feeRate: 0.002, slippageRate: 0.001 };

export interface ReplaySnapshot {
  session: ReplaySession;
  execution: ReplayExecution;
  portfolio: ReplayExecution["portfolio"];
  orders: ReplayOrder[];
  futureBarsLoaded: number;
  deduplicated?: boolean;
  hasNext?: boolean;
  bar?: Candle | null;
  report: {
    initialCapital: number;
    equity: number;
    netPnl: number;
    realizedPnl: number;
    unrealizedPnl: number;
    fees: number;
    fillCount: number;
    maxDrawdown: number;
    notes: string;
    tags: string[];
    policy: string;
  };
}

export type ReplaySeed = Pick<ReplaySnapshot, "session" | "execution" | "portfolio" | "futureBarsLoaded">;

export async function readJson<T>(response: APIResponse, status = 200): Promise<T> {
  const body: unknown = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(status);
  return body as T;
}

export async function setTrainingWorkspace(request: APIRequestContext): Promise<void> {
  const response = await request.get("/api/workspace");
  const { state } = await readJson<{ state: Record<string, unknown> }>(response);
  await readJson(await request.put("/api/workspace", {
    headers: { origin: new URL(response.url()).origin },
    data: { ...state, ...REPLAY_MARKET, activeWorkspace: "terminal", activeReplayId: null },
  }));
}

export async function trainingCandles(request: APIRequestContext): Promise<Candle[]> {
  await setTrainingWorkspace(request);
  const result = await readJson<{ completed: Candle[]; source: string; gaps: unknown[] }>(
    await request.get("/api/market", { params: { ...REPLAY_MARKET, kind: "candles", limit: 1000 } }),
  );
  expect(result.source, "The real backend must use NEWBEING_E2E_FIXTURES=1, not live market data.").toBe("Deterministic test fixture");
  expect(result.gaps).toEqual([]);
  expect(result.completed.length).toBeGreaterThan(700);
  return result.completed;
}

export async function seedTraining(
  request: APIRequestContext,
  lastSeedBar: Candle,
  config = TRAINING_CONFIG,
): Promise<ReplaySnapshot> {
  const started = await readJson<ReplaySeed>(await request.post("/api/replay", {
    data: { ...REPLAY_MARKET, ...config, endAt: lastSeedBar.timestamp + REPLAY_INTERVAL, limit: 50 },
  }), 201);
  expect(started.execution.config).toEqual(config);
  expect(started.session.cursor).toBe(lastSeedBar.timestamp);
  expect(started.session.bars).toHaveLength(50);
  expect(started.session.bars.at(-1)).toEqual(lastSeedBar);
  expect(started.session.bars.every((bar) => bar.timestamp <= started.session.cursor)).toBe(true);
  expect(started.futureBarsLoaded).toBe(0);
  expect(started.execution.instrument).toMatchObject({ venue: "binance", nativeId: "BTCUSDT", symbol: "BTC/USDT", marketType: "spot" });
  expect(started.execution.account).toMatchObject({ venue: "binance", mode: "replay", quote: "USDT" });
  expect(started.portfolio).toEqual(started.execution.portfolio);
  expect(started.portfolio.quoteBalance).toBe(config.initialCapital);
  expect(started.execution.fills).toEqual([]);
  // Seed responses do not carry a report or orders; GET supplies the complete snapshot.
  return reloadTraining(request, started.session.id);
}

export async function reloadTraining(request: APIRequestContext, id: string): Promise<ReplaySnapshot> {
  return readJson<ReplaySnapshot>(await request.get(`/api/replay/${id}`));
}

export async function commandTraining(
  request: APIRequestContext,
  snapshot: ReplaySnapshot,
  command: Record<string, unknown>,
): Promise<ReplaySnapshot> {
  return readJson<ReplaySnapshot>(await request.post(`/api/replay/${snapshot.session.id}`, {
    data: { expectedRevision: snapshot.execution.revision, ...command },
  }));
}

export async function queueTraining(
  request: APIRequestContext,
  snapshot: ReplaySnapshot,
  order: { side: "buy" | "sell"; quantity: number; type: "market" | "limit" | "stop"; price?: number; stopLoss?: number; takeProfit?: number },
): Promise<{ snapshot: ReplaySnapshot; command: Record<string, unknown>; orderId: string }> {
  const requestId = randomUUID();
  const command = { action: "order", requestId, ...order, expectedRevision: snapshot.execution.revision };
  const queued = await commandTraining(request, snapshot, command);
  const orderId = `replay-${snapshot.session.id}-${requestId}`;
  expect(queued.orders.find((item) => item.clientOrderId === orderId)).toMatchObject({ ...order, status: "submitted", fillPrice: null, submittedAt: snapshot.session.cursor });
  expect(queued.execution.fills).toEqual(snapshot.execution.fills);
  expect(queued.portfolio).toEqual(snapshot.portfolio);
  expect(queued.session.cursor).toBe(snapshot.session.cursor);
  return { snapshot: queued, command, orderId };
}

export async function stepTraining(request: APIRequestContext, snapshot: ReplaySnapshot): Promise<ReplaySnapshot> {
  const stepped = await commandTraining(request, snapshot, { action: "step", expectedCursor: snapshot.session.cursor });
  expect(stepped.hasNext).toBe(true);
  expect(stepped.session.cursor).toBe(snapshot.session.cursor + REPLAY_INTERVAL);
  expect(stepped.session.bars.slice(0, -1)).toEqual(snapshot.session.bars);
  expect(stepped.session.bars).toHaveLength(snapshot.session.bars.length + 1);
  expect(stepped.bar).toEqual(stepped.session.bars.at(-1));
  expect(stepped.futureBarsLoaded).toBe(0);
  expect(stepped.execution.revision).toBe(snapshot.execution.revision + 1);
  return stepped;
}

// Independent integer reference for the documented 8-place money policy.
// Fixture notionals stay below Number.MAX_SAFE_INTEGER in these units.
export function trainingAmounts(price: number, quantity: number, feeRate: number) {
  const notionalUnits = Math.round(price * quantity * 1e8);
  const feeUnits = Math.round(notionalUnits * feeRate);
  return { notionalUnits, feeUnits, cost: (notionalUnits + feeUnits) / 1e8 };
}

export function assertTrainingLedger(snapshot: ReplaySnapshot): void {
  const { execution, portfolio, report } = snapshot;
  expect(portfolio).toEqual(execution.portfolio);
  expect(snapshot.orders).toEqual(execution.orders);
  let quoteUnits = execution.config.initialCapital * 1e8;
  let baseUnits = 0;
  let costUnits = 0;
  let realizedUnits = 0;
  let feesUnits = 0;
  for (const fill of execution.fills) {
    expect(fill.accountId).toBe(execution.account.id);
    expect(fill.instrumentId).toBe(execution.instrument.id);
    expect(fill.timestamp).toBeLessThanOrEqual(snapshot.session.cursor);
    const { notionalUnits, feeUnits } = trainingAmounts(fill.price, fill.quantity, execution.config.feeRate);
    const quantityUnits = Math.round(fill.quantity * 1e12);
    expect(fill.fee).toBe(feeUnits / 1e8);
    if (fill.side === "buy") {
      quoteUnits -= notionalUnits + feeUnits;
      baseUnits += quantityUnits;
      costUnits += notionalUnits + feeUnits;
    } else {
      const allocated = quantityUnits === baseUnits ? costUnits : Math.round(costUnits * (quantityUnits / baseUnits));
      quoteUnits += notionalUnits - feeUnits;
      baseUnits -= quantityUnits;
      costUnits -= allocated;
      realizedUnits += notionalUnits - feeUnits - allocated;
    }
    feesUnits += feeUnits;
  }
  expect(portfolio.quoteBalance).toBe(quoteUnits / 1e8);
  expect(portfolio.baseBalance).toBe(baseUnits / 1e12);
  expect(portfolio.costBasis ?? 0).toBe(costUnits / 1e8);
  expect(portfolio.realizedPnl).toBe(realizedUnits / 1e8);
  expect(portfolio.baseBalance).toBeGreaterThanOrEqual(0);
  const mark = snapshot.session.bars.at(-1)!.close;
  const markedUnits = Math.round((baseUnits / 1e12) * mark * 1e8);
  expect(report.initialCapital).toBe(execution.config.initialCapital);
  expect(report.equity).toBe((quoteUnits + markedUnits) / 1e8);
  expect(report.netPnl).toBe((quoteUnits + markedUnits - execution.config.initialCapital * 1e8) / 1e8);
  expect(report.realizedPnl).toBe(portfolio.realizedPnl);
  expect(report.unrealizedPnl).toBe((markedUnits - costUnits) / 1e8);
  expect(report.fees).toBe(feesUnits / 1e8);
  expect(report.fillCount).toBe(execution.fills.length);
  expect(report.notes).toBe(execution.notes);
  expect(report.tags).toEqual(execution.tags);
  let peak = execution.config.initialCapital;
  let drawdown = 0;
  for (const point of execution.equity) {
    peak = Math.max(peak, point.equity);
    drawdown = Math.max(drawdown, (peak - point.equity) / peak);
  }
  expect(report.maxDrawdown).toBeCloseTo(drawdown, 12);
  expect(report.policy).toContain("Orders become eligible on the next bar only");
  expect(report.policy).toContain("without forced liquidation");
}
