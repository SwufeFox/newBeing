import { LedgerValidationError, quantityUnits, SIMULATION_PRECISION, matchReplayBar, submitReplayOrder, validateReplayConfig, type InstrumentIdentity, type ReplayConfig, type ReplayExecution, type ReplayOrderInput } from "@newbeing/core";
import { paperRecoveries, replayExecutions } from "./schema.js";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { DEFAULT_WORKSPACE_STATE, fillPaperOrder, type BacktestResult, type Candle, type ExchangeId, type OrderPreview, type PaperOrder, type PaperPortfolio, type ReplaySession, type StrategyParameters, type Timeframe, type WorkspaceState } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { experiments, orderPreviews, paperAccounts, paperOrders, replaySessions, strategies, workspaceStates, candleCache } from "./schema.js";

/** Venues a stored row may legitimately name. A row holding anything else is
 *  treated as legacy rather than trusted, so a corrupt value cannot send a
 *  request to an adapter that does not exist. */
const EXCHANGE_IDS: readonly ExchangeId[] = ["binance", "coinbaseexchange", "okx", "kraken"];

const INTERVALS: Record<Timeframe, number> = { "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };

const CANDLE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function saveCachedCandles(exchange: ExchangeId, symbol: string, timeframe: Timeframe, candles: readonly Candle[]): void {
  const db = getDatabase();
  const now = Date.now();
  db.transaction((tx) => {
    for (const candle of candles) {
      if (candle.timestamp + INTERVALS[timeframe] > now) continue;
      tx.insert(candleCache).values({ exchange, symbol, timeframe, ...candle, cachedAt: now })
        .onConflictDoUpdate({
          target: [candleCache.exchange, candleCache.symbol, candleCache.timeframe, candleCache.timestamp],
          set: { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, cachedAt: now },
        }).run();
    }
    tx.delete(candleCache).where(lt(candleCache.cachedAt, now - CANDLE_CACHE_TTL_MS)).run();
  });
}

export function getCachedCandles(exchange: ExchangeId, symbol: string, timeframe: Timeframe, since: number, limit: number, through = Number.MAX_SAFE_INTEGER): { candles: Candle[]; cachedAt: number | null } {
  const rows = getDatabase().select().from(candleCache).where(and(
    eq(candleCache.exchange, exchange), eq(candleCache.symbol, symbol), eq(candleCache.timeframe, timeframe),
    sql`${candleCache.cachedAt} >= ${candleCache.timestamp} + ${INTERVALS[timeframe]}`,
    lte(candleCache.timestamp, Date.now() - INTERVALS[timeframe]),
    gte(candleCache.timestamp, since), lte(candleCache.timestamp, through), gte(candleCache.cachedAt, Date.now() - CANDLE_CACHE_TTL_MS),
  )).orderBy(asc(candleCache.timestamp)).limit(limit).all();
  return { candles: rows.map(({ timestamp, open, high, low, close, volume }) => ({ timestamp, open, high, low, close, volume })), cachedAt: rows.length ? Math.min(...rows.map((row) => row.cachedAt)) : null };
}


export interface StoredStrategy {
  id: string;
  name: string;
  version: string;
  description: string;
  parameters: StrategyParameters;
  source: string;
  updatedAt: number;
}

export function getWorkspaceState(): { state: WorkspaceState; updatedAt: number } {
  const row = getDatabase().select().from(workspaceStates).where(eq(workspaceStates.id, 1)).get();
  if (!row) return { state: DEFAULT_WORKSPACE_STATE, updatedAt: 0 };
  try {
    /* Read the stored value as a plain string: the typed union no longer admits
       "backtest", and that is exactly the legacy value we must detect. */
    const raw = JSON.parse(row.payload) as Record<string, unknown>;
    /* A row written before the Backtest workspace was absorbed still names it.
       Normalising on READ (rather than only on write) means the API never
       returns a workspace the UI cannot render, even before the next save. */
    const activeWorkspace = raw.activeWorkspace === "backtest" ? "research" : raw.activeWorkspace;
    return {
      state: {
        ...DEFAULT_WORKSPACE_STATE,
        ...(raw as Partial<WorkspaceState>),
        activeWorkspace: activeWorkspace as WorkspaceState["activeWorkspace"],
      },
      updatedAt: row.updatedAt,
    };
  } catch {
    return { state: DEFAULT_WORKSPACE_STATE, updatedAt: row.updatedAt };
  }
}

export function saveWorkspaceState(state: WorkspaceState): number {
  const updatedAt = Date.now();
  getDatabase().insert(workspaceStates).values({ id: 1, payload: JSON.stringify(state), updatedAt })
    .onConflictDoUpdate({ target: workspaceStates.id, set: { payload: JSON.stringify(state), updatedAt } }).run();
  return updatedAt;
}

export function listStoredStrategies(): StoredStrategy[] {
  return getDatabase().select().from(strategies).orderBy(desc(strategies.updatedAt)).all().map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    parameters: JSON.parse(row.parameters) as StrategyParameters,
    source: row.source,
    updatedAt: row.updatedAt,
  }));
}

export function getStoredStrategy(id: string): StoredStrategy | undefined {
  const row = getDatabase().select().from(strategies).where(eq(strategies.id, id)).get();
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    parameters: JSON.parse(row.parameters) as StrategyParameters,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

export function saveStrategy(strategy: Omit<StoredStrategy, "updatedAt">): StoredStrategy {
  const updatedAt = Date.now();
  const row = { ...strategy, parameters: JSON.stringify(strategy.parameters), updatedAt };
  getDatabase().insert(strategies).values(row).onConflictDoUpdate({
    target: strategies.id,
    set: {
      name: strategy.name,
      version: strategy.version,
      description: strategy.description,
      parameters: JSON.stringify(strategy.parameters),
      source: strategy.source,
      updatedAt,
    },
  }).run();
  return { ...strategy, updatedAt };
}

export function saveExperiment(result: BacktestResult): void {
  getDatabase().insert(experiments).values({
    resultId: result.resultId,
    datasetId: result.datasetId,
    symbol: result.symbol,
    timeframe: result.timeframe,
    strategyId: result.strategyId,
    strategyVersion: result.strategyVersion,
    assumptions: JSON.stringify(result.assumptions),
    result: JSON.stringify(result),
    createdAt: Date.parse(result.createdAt),
  }).run();
}

export function getExperiment(resultId: string): BacktestResult | undefined {
  const row = getDatabase().select({ result: experiments.result }).from(experiments)
    .where(eq(experiments.resultId, resultId)).get();
  if (!row) return undefined;
  return JSON.parse(row.result) as BacktestResult;
}

export function listExperiments(limit = 20): BacktestResult[] {
  return getDatabase().select({ result: experiments.result }).from(experiments)
    .orderBy(desc(experiments.createdAt)).limit(Math.max(1, Math.min(100, limit))).all()
    .map((row) => JSON.parse(row.result) as BacktestResult);
}

/* Account ids are namespaced per venue. The Binance namespace is deliberately
   spelled exactly as it always was ("binance-spot") so the ids of accounts that
   already hold balances keep resolving — renaming them would orphan real paper
   positions rather than migrate them. */
const PAPER_NAMESPACE: Record<ExchangeId, string> = {
  binance: "binance-spot",
  coinbaseexchange: "coinbase-spot",
  okx: "okx-spot",
  kraken: "kraken-spot",
};

export const PAPER_ACCOUNT_ID = "paper:binance-spot:USDT";

export function paperAccountId(symbol: string, exchange: ExchangeId = "binance"): string {
  const [base, quote, extra] = symbol.toUpperCase().split("/");
  if (!base || !quote || extra !== undefined || !/^[A-Z0-9]{2,20}$/.test(base) || !/^[A-Z0-9]{2,20}$/.test(quote)) {
    throw new Error("Paper trading needs a BASE/QUOTE symbol, for example BTC/USDT.");
  }
  return `paper:${PAPER_NAMESPACE[exchange]}:${base}:${quote}`;
}

export function replayAccountId(sessionId: string, symbol: string, exchange: ExchangeId = "binance"): string {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) throw new Error("Invalid replay session ID.");
  const parts = paperAccountId(symbol, exchange).split(":");
  const base = parts[2];
  const quote = parts[3];
  if (!base || !quote) throw new Error("Invalid replay symbol.");
  return `paper:replay:${sessionId}:${base}:${quote}`;
}

export function getPaperPortfolio(accountId = PAPER_ACCOUNT_ID): PaperPortfolio {
  const db = getDatabase();
  const initial: PaperPortfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 };
  db.insert(paperAccounts).values({ id: accountId, ...initial, updatedAt: Date.now() }).onConflictDoNothing().run();
  const row = db.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
  if (!row) throw new Error("Paper account could not be initialized.");
  return portfolioFromRow(row);
}

function portfolioFromRow(row: typeof paperAccounts.$inferSelect): PaperPortfolio {
  return {
    quoteBalance: row.quoteBalance,
    baseBalance: row.baseBalance,
    averageEntryPrice: row.averageEntryPrice,
    ...(row.costBasis === null ? {} : { costBasis: row.costBasis }),
    realizedPnl: row.realizedPnl,
    feeRate: row.feeRate,
  };
}

function paperOrderFromRow(row: typeof paperOrders.$inferSelect): PaperOrder | undefined {
  if (row.side !== "buy" && row.side !== "sell") return undefined;
  if (!( ["created", "submitted", "filled", "rejected", "cancelled", "unknown"] as string[]).includes(row.status)) return undefined;
  return {
    clientOrderId: row.clientOrderId,
    accountId: row.accountId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    status: row.status as PaperOrder["status"],
    fillPrice: row.fillPrice,
    fee: row.fee,
    createdAt: row.createdAt,
  };
}

export interface BeginPaperIntentResult {
  order: PaperOrder;
  portfolio: PaperPortfolio;
  deduplicated: boolean;
}

export function beginPaperIntent(input: Pick<PaperOrder, "clientOrderId" | "symbol" | "side" | "quantity">, accountId = paperAccountId(input.symbol)): BeginPaperIntentResult {
  quantityUnits(input.quantity);
  if (input.quantity <= 0 || !["buy", "sell"].includes(input.side)) throw new Error("Invalid paper order.");
  const db = getDatabase();
  return db.transaction((tx) => {
    const existingRow = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, input.clientOrderId)).get();
    if (existingRow) {
      const existing = paperOrderFromRow(existingRow);
      if (!existing) throw new Error("Stored paper order state is invalid.");
      if (existingRow.accountId !== accountId || existing.symbol !== input.symbol || existing.side !== input.side || existing.quantity !== input.quantity) {
        throw new Error("Client order ID was already used with different order parameters.");
      }
      const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
      if (!accountRow) throw new Error("Paper account could not be read.");
      return { order: existing, portfolio: portfolioFromRow(accountRow), deduplicated: true };
    }
    const initial: PaperPortfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 };
    tx.insert(paperAccounts).values({ id: accountId, ...initial, updatedAt: Date.now() }).onConflictDoNothing().run();
    const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
    if (!accountRow) throw new Error("Paper account could not be initialized.");
    const order: PaperOrder = { ...input, status: "created", fillPrice: null, fee: 0, createdAt: new Date().toISOString() };
    tx.insert(paperOrders).values({ ...order, accountId }).run();
    return { order: { ...order, accountId }, portfolio: portfolioFromRow(accountRow), deduplicated: false };
  }, { behavior: "immediate" });
}

export function markPaperIntentSubmitted(clientOrderId: string): PaperOrder {
  const db = getDatabase();
  db.update(paperOrders).set({ status: "submitted" })
    .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "created"))).run();
  const row = db.select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
  const order = row ? paperOrderFromRow(row) : undefined;
  if (!order) throw new Error("Paper order intent could not be submitted.");
  return order;
}

export function markPaperIntentUnknown(clientOrderId: string): PaperOrder {
  const db = getDatabase();
  db.update(paperOrders).set({ status: "unknown" })
    .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
  const row = db.select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
  const order = row ? paperOrderFromRow(row) : undefined;
  if (!order) throw new Error("Paper order could not be reconciled.");
  return order;
}

export interface PaperFillResult {
  order: PaperOrder;
  portfolio: PaperPortfolio;
  deduplicated: boolean;
  error?: string;
}

export function finalizePaperFill(clientOrderId: string, fillPrice: number, accountId?: string): PaperFillResult {
  const db = getDatabase();
  return db.transaction((tx) => {
    const orderRow = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
    const order = orderRow ? paperOrderFromRow(orderRow) : undefined;
    if (!order) throw new Error("Paper order intent not found.");
    if (!orderRow?.accountId) throw new Error("Legacy/unbound order cannot be finalized without proven ownership.");
    if (accountId !== undefined && accountId !== orderRow.accountId) throw new Error("Paper order account mismatch.");
    const resolvedAccountId = orderRow.accountId;
    const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, resolvedAccountId)).get();
    if (!accountRow) throw new Error("Paper account not found.");
    const portfolio = portfolioFromRow(accountRow);
    if (order.status !== "submitted") return { order, portfolio, deduplicated: true };
    try {
      const fill = fillPaperOrder(order, portfolio, fillPrice);
      tx.update(paperAccounts).set({ ...fill.portfolio, updatedAt: Date.now() }).where(eq(paperAccounts.id, resolvedAccountId)).run();
      tx.update(paperOrders).set({ status: "filled", fillPrice: fill.order.fillPrice, fee: fill.order.fee })
        .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
      return { order: fill.order, portfolio: fill.portfolio, deduplicated: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Paper fill rejected.";
      if (error instanceof LedgerValidationError || message.startsWith("Insufficient paper")) {
        tx.update(paperOrders).set({ status: "rejected" })
          .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
        return { order: { ...order, status: "rejected" }, portfolio, deduplicated: false, error: message };
      }
      throw error;
    }
  }, { behavior: "immediate" });
}

export type PaperRecovery = typeof paperRecoveries.$inferSelect;
export interface RecoverPaperIntentInput {
  clientOrderId: string;
  actionId: string;
  reason: string;
}

/** Pending is independent of the capped recent history, including unbound legacy rows. */
export function listPendingPaperOrders(): PaperOrder[] {
  return getDatabase().select().from(paperOrders)
    .where(sql`${paperOrders.status} IN ('created', 'submitted', 'unknown')`)
    .orderBy(asc(paperOrders.createdAt)).all().flatMap((row) => {
      const order = paperOrderFromRow(row);
      return order ? [order] : [];
    });
}

export function listPaperRecoveries(): PaperRecovery[] {
  return getDatabase().select().from(paperRecoveries).orderBy(desc(paperRecoveries.createdAt)).all();
}

/** Local Paper has no external fill: never price or mutate a wallet during recovery.
 * This transaction serializes with finalize; cancellation fences a delayed quote.
 * Missing legacy ownership is preserved, never guessed from current workspace.
 */
export function recoverPaperIntent(input: RecoverPaperIntentInput): { order: PaperOrder; recovery: PaperRecovery; deduplicated: boolean } {
  if (!/^[A-Za-z0-9-]{8,100}$/.test(input.actionId) || !input.reason.trim() || input.reason.length > 2000) throw new Error("Recovery needs an action ID and an audit reason (1–2000 characters).");
  return getDatabase().transaction((tx) => {
    const row = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, input.clientOrderId)).get();
    const order = row ? paperOrderFromRow(row) : undefined;
    if (!row || !order) throw new Error("Paper order intent not found.");
    const previous = tx.select().from(paperRecoveries).where(eq(paperRecoveries.clientOrderId, input.clientOrderId)).get();
    if (previous) {
      if (previous.actionId !== input.actionId || previous.reason !== input.reason) throw new Error("Order already recovered; reload its saved audit record.");
      return { order, recovery: previous, deduplicated: true };
    }
    if (tx.select().from(paperRecoveries).where(eq(paperRecoveries.actionId, input.actionId)).get()) throw new Error("Recovery action ID already used for another order.");
    if (!["created", "submitted", "unknown"].includes(order.status)) throw new Error("Only pending Paper intents can be recovered; committed outcomes are final.");
    const accountExists = row.accountId ? tx.select().from(paperAccounts).where(eq(paperAccounts.id, row.accountId)).get() : undefined;
    const requiresReview = !accountExists || row.fillPrice !== null || row.fee !== 0;
    const recovery: PaperRecovery = {
      clientOrderId: order.clientOrderId, actionId: input.actionId, accountId: row.accountId,
      previousStatus: order.status, outcome: "cancelled", reason: input.reason, requiresReview,
      createdAt: new Date().toISOString(),
    };
    tx.update(paperOrders).set({ status: "cancelled" }).where(and(eq(paperOrders.clientOrderId, order.clientOrderId), eq(paperOrders.status, order.status))).run();
    tx.insert(paperRecoveries).values(recovery).run();
    return { order: { ...order, status: "cancelled" as const }, recovery, deduplicated: false };
  }, { behavior: "immediate" });
}

export function getPaperOrder(clientOrderId: string): PaperOrder | undefined {
  const row = getDatabase().select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
  return row ? paperOrderFromRow(row) : undefined;
}

export function listPaperOrders(limit = 50, accountId?: string): PaperOrder[] {
  return getDatabase().select().from(paperOrders).where(accountId === undefined ? undefined : eq(paperOrders.accountId, accountId)).orderBy(desc(paperOrders.createdAt))
    .limit(Math.max(1, Math.min(100, limit))).all()
    .flatMap((row) => {
      const order = paperOrderFromRow(row);
      return order ? [order] : [];
    });
}

function asOrderPreview(row: typeof orderPreviews.$inferSelect): OrderPreview | undefined {
  if (row.side !== "buy" && row.side !== "sell") return undefined;
  if (row.mode !== "paper" || !(["prepared", "confirmed", "dismissed", "expired"] as string[]).includes(row.status)) return undefined;
  return {
    id: row.id,
    accountId: row.accountId,
    exchange: EXCHANGE_IDS.includes(row.exchange as ExchangeId) ? row.exchange as ExchangeId : null,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    mode: "paper",
    referencePrice: row.referencePrice,
    estimatedNotional: row.estimatedNotional,
    estimatedFee: row.estimatedFee,
    status: row.status as OrderPreview["status"],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    orderId: row.orderId,
  };
}

export function saveOrderPreview(preview: OrderPreview): void {
  quantityUnits(preview.quantity);
  if (!preview.exchange || preview.accountId !== paperAccountId(preview.symbol, preview.exchange)) throw new Error("New previews require a proven venue/account binding.");
  getDatabase().insert(orderPreviews).values({ ...preview }).run();
}

export function getOrderPreview(id: string): OrderPreview | undefined {
  const row = getDatabase().select().from(orderPreviews).where(eq(orderPreviews.id, id)).get();
  return row ? asOrderPreview(row) : undefined;
}

export function listOrderPreviews(symbol?: string, limit = 20, accountId?: string): OrderPreview[] {
  const rows = getDatabase().select().from(orderPreviews).where(and(symbol === undefined ? undefined : eq(orderPreviews.symbol, symbol), accountId === undefined ? undefined : eq(orderPreviews.accountId, accountId))).orderBy(desc(orderPreviews.createdAt))
    .limit(Math.max(1, Math.min(50, limit))).all();
  const now = Date.now();
  return rows.flatMap((row) => {
    const preview = asOrderPreview(row);
    if (!preview || (symbol && preview.symbol !== symbol)) return [];
    if (preview.status === "prepared" && Date.parse(preview.expiresAt) <= now) {
      getDatabase().update(orderPreviews).set({ status: "expired" })
        .where(and(eq(orderPreviews.id, preview.id), eq(orderPreviews.status, "prepared"))).run();
      return [getOrderPreview(preview.id)!];
    }
    return [preview];
  });
}

export interface PreviewClaim {
  preview: OrderPreview;
  claimed: boolean;
  order?: PaperOrder | undefined;
}

/** The winning action and its submitted intent commit before any quote request. */
export function claimOrderPreview(id: string, action: "confirm" | "dismiss", now = Date.now()): PreviewClaim {
  return getDatabase().transaction((tx) => {
    const preview = getOrderPreview(id);
    if (!preview) throw new Error("Order preview not found.");
    if (preview.status !== "prepared") {
      return { preview, claimed: false, order: preview.orderId ? getPaperOrder(preview.orderId) : undefined };
    }
    const expiresAt = Date.parse(preview.expiresAt);
    const status = !Number.isFinite(expiresAt) || expiresAt <= now ? "expired" : action === "dismiss" ? "dismissed" : "confirmed";
    if (status !== "confirmed") {
      tx.update(orderPreviews).set({ status }).where(and(eq(orderPreviews.id, id), eq(orderPreviews.status, "prepared"))).run();
      return { preview: { ...preview, status }, claimed: false };
    }
    if (!preview.exchange || preview.accountId !== paperAccountId(preview.symbol, preview.exchange)) throw new Error("Legacy/unbound preview cannot be confirmed; prepare a new preview.");
    const orderId = `preview-${preview.id}`;
    const intent = beginPaperIntent({ clientOrderId: orderId, symbol: preview.symbol, side: preview.side, quantity: preview.quantity }, preview.accountId);
    if (intent.deduplicated) throw new Error("Preview order ID already exists without a matching confirmation.");
    const order = markPaperIntentSubmitted(orderId);
    tx.update(orderPreviews).set({ status, orderId }).where(and(eq(orderPreviews.id, id), eq(orderPreviews.status, "prepared"))).run();
    return { preview: { ...preview, status, orderId }, claimed: true, order };
  }, { behavior: "immediate" });
}

function replaySessionFromRow(row: typeof replaySessions.$inferSelect): ReplaySession | undefined {
  if (!(["active", "finished"] as string[]).includes(row.status)) return undefined;
  try {
    const bars = JSON.parse(row.bars) as Candle[];
    if (!Array.isArray(bars)) return undefined;
    const candleSource = row.candleSource === "live" || row.candleSource === "local-cache" ? row.candleSource : undefined;
    let candleCache: ReplaySession["candleCache"];
    if (row.candleCache) {
      try {
        const parsed = JSON.parse(row.candleCache) as unknown;
        if (typeof parsed === "object" && parsed !== null && "fallback" in parsed && typeof parsed.fallback === "boolean" && "cachedAt" in parsed && (typeof parsed.cachedAt === "string" || parsed.cachedAt === null)) {
          candleCache = { fallback: parsed.fallback, cachedAt: parsed.cachedAt };
        }
      } catch {
        /* Bad optional provenance must not make a valid replay session unreadable. */
      }
    }
    return {
      id: row.id,
      exchange: (EXCHANGE_IDS.includes(row.exchange as ExchangeId) ? row.exchange : "binance") as ExchangeId,
      symbol: row.symbol,
      timeframe: row.timeframe as Timeframe,
      startAt: row.startAt,
      cursor: row.cursor,
      bars,
      ...(candleSource ? { candleSource } : {}),
      ...(candleCache ? { candleCache } : {}),
      status: row.status as ReplaySession["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch {
    return undefined;
  }
}

export function createReplaySession(session: ReplaySession): void {
  getDatabase().insert(replaySessions).values({
    id: session.id,
    exchange: session.exchange,
    symbol: session.symbol,
    timeframe: session.timeframe,
    startAt: session.startAt,
    cursor: session.cursor,
    bars: JSON.stringify(session.bars),
    candleSource: session.candleSource ?? null,
    candleCache: session.candleCache ? JSON.stringify(session.candleCache) : null,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }).run();
}

export function getReplaySession(id: string): ReplaySession | undefined {
  const row = getDatabase().select().from(replaySessions).where(eq(replaySessions.id, id)).get();
  return row ? replaySessionFromRow(row) : undefined;
}

export function advanceReplaySession(
  id: string,
  expectedCursor: number,
  candle: Candle,
  provenance?: { source: "live" | "local-cache"; cache: { fallback: boolean; cachedAt: string | null } },
  expectedRevision?: number,
): { session: ReplaySession; deduplicated: boolean } {
  const db = getDatabase();
  return db.transaction((tx) => {
    const row = tx.select().from(replaySessions).where(eq(replaySessions.id, id)).get();
    const current = row ? replaySessionFromRow(row) : undefined;
    if (!current) throw new Error("Replay session not found or invalid.");
    if (current.status !== "active" || current.cursor !== expectedCursor) return { session: current, deduplicated: true };
    if (candle.timestamp <= current.cursor) throw new Error("Replay candle must move strictly forward.");
    const execution = getReplayExecution(id);
    if (execution) {
      if (expectedRevision !== undefined && execution.revision !== expectedRevision) throw new Error("Replay revision conflict; reload before retrying.");
      const intervals: Record<Timeframe, number> = { "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };
      if (candle.timestamp !== current.cursor + intervals[current.timeframe]) throw new Error("Replay requires the next contiguous bar.");
      matchReplayBar(execution, candle);
      execution.revision++;
      tx.update(replayExecutions).set({ payload: JSON.stringify(execution) }).where(eq(replayExecutions.sessionId, id)).run();
    }
    const bars = [...current.bars, candle].slice(-1000);
    const candleSource = current.candleSource === "local-cache" || provenance?.source === "local-cache"
      ? "local-cache"
      : provenance?.source ?? current.candleSource;
    const candleCache = provenance?.source === "local-cache" ? provenance.cache : current.candleCache;
    const updated: ReplaySession = {
      ...current,
      cursor: candle.timestamp,
      bars,
      ...(candleSource ? { candleSource } : {}),
      ...(candleCache ? { candleCache } : {}),
      updatedAt: new Date().toISOString(),
    };
    tx.update(replaySessions).set({
      cursor: updated.cursor,
      bars: JSON.stringify(updated.bars),
      candleSource: updated.candleSource ?? null,
      candleCache: updated.candleCache ? JSON.stringify(updated.candleCache) : null,
      updatedAt: updated.updatedAt,
    })
      .where(and(eq(replaySessions.id, id), eq(replaySessions.cursor, expectedCursor), eq(replaySessions.status, "active"))).run();
    const savedRow = tx.select().from(replaySessions).where(eq(replaySessions.id, id)).get();
    const saved = savedRow ? replaySessionFromRow(savedRow) : undefined;
    if (!saved) throw new Error("Replay session update failed.");
    return { session: saved, deduplicated: false };
  }, { behavior: "immediate" });
}

export function createConfiguredReplaySession(session: ReplaySession, instrument: InstrumentIdentity, config: ReplayConfig): ReplayExecution {
  validateReplayConfig(config);
  if (instrument.venue !== session.exchange || instrument.symbol !== session.symbol || instrument.id !== `${instrument.venue}:spot:${encodeURIComponent(instrument.nativeId)}` || !instrument.nativeId || instrument.marketType !== "spot" || `${instrument.base}/${instrument.quote}` !== session.symbol) throw new Error("Replay instrument does not match session.");
  return getDatabase().transaction((tx) => {
    createReplaySession(session);
    const state: ReplayExecution = {
      version: 1, revision: 0, simulationPrecision: SIMULATION_PRECISION,
      account: { id: replayAccountId(session.id, session.symbol, session.exchange), venue: session.exchange, mode: "replay", quote: instrument.quote },
      instrument, config,
      portfolio: { quoteBalance: config.initialCapital, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: config.feeRate },
      orders: [], fills: [], brackets: [], equity: [{ timestamp: session.cursor, equity: config.initialCapital }], notes: "", tags: [],
    };
    tx.insert(replayExecutions).values({ sessionId: session.id, payload: JSON.stringify(state) }).run();
    return state;
  }, { behavior: "immediate" });
}

export function getReplayExecution(id: string): ReplayExecution | undefined {
  const row = getDatabase().select().from(replayExecutions).where(eq(replayExecutions.sessionId, id)).get();
  return row ? JSON.parse(row.payload) as ReplayExecution : undefined;
}

export type ReplayCommand =
  | { action: "order"; order: ReplayOrderInput }
  | { action: "cancel"; clientOrderId: string }
  | { action: "journal"; notes: string; tags: string[] }
  | { action: "finish" };

/** Legacy history has no compatible fill ledger. Start a new session explicitly. */
export function upgradeLegacyReplay(session: ReplaySession, instrument: InstrumentIdentity): ReplayExecution {
  const existing = getReplayExecution(session.id);
  if (existing) return existing;
  if (instrument.venue !== session.exchange || instrument.symbol !== session.symbol) throw new Error("Replay instrument mismatch.");
  throw new Error("Legacy Replay cannot acquire new execution semantics. Start a new configured session; legacy wallet and history remain available.");
}

export function commandReplay(id: string, expectedRevision: number, command: ReplayCommand): ReplayExecution {
  return getDatabase().transaction((tx) => {
    const session = getReplaySession(id);
    const state = getReplayExecution(id);
    if (!session || !state) throw new Error("Replay execution not found.");
    // Exact retries of an order remain safe even after the cursor/revision has moved.
    if (command.action === "order" && state.orders.some((order) => order.clientOrderId === command.order.clientOrderId)) {
      submitReplayOrder(state, command.order, session.cursor);
      return state;
    }
    if (state.revision !== expectedRevision) throw new Error("Replay revision conflict; reload before retrying.");
    if (command.action !== "journal" && session.status !== "active") throw new Error("Replay session has finished.");
    if (command.action === "order") submitReplayOrder(state, command.order, session.cursor);
    if (command.action === "cancel") {
      const order = state.orders.find((item) => item.clientOrderId === command.clientOrderId);
      if (!order) throw new Error("Replay order not found.");
      if (order.status === "submitted") order.status = "cancelled";
      else if (order.status !== "cancelled") throw new Error("Only pending Replay orders can be cancelled.");
    }
    if (command.action === "journal") {
      if (command.notes.length > 20_000 || command.tags.length > 20 || command.tags.some((tag) => !tag.trim() || tag.length > 80)) throw new Error("Invalid Replay journal.");
      state.notes = command.notes;
      state.tags = [...new Set(command.tags.map((tag) => tag.trim()))];
    }
    if (command.action === "finish") {
      state.orders.forEach((order) => { if (order.status === "submitted") order.status = "cancelled"; });
      tx.update(replaySessions).set({ status: "finished", updatedAt: new Date().toISOString() }).where(eq(replaySessions.id, id)).run();
    }
    state.revision++;
    tx.update(replayExecutions).set({ payload: JSON.stringify(state) }).where(eq(replayExecutions.sessionId, id)).run();
    return state;
  }, { behavior: "immediate" });
}

export function finishReplaySession(id: string): ReplaySession | undefined {
  const execution = getReplayExecution(id);
  if (execution) {
    commandReplay(id, execution.revision, { action: "finish" });
    return getReplaySession(id);
  }
  const db = getDatabase();
  db.update(replaySessions).set({ status: "finished", updatedAt: new Date().toISOString() })
    .where(and(eq(replaySessions.id, id), eq(replaySessions.status, "active"))).run();
  return getReplaySession(id);
}
