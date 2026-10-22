import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const candleCache = sqliteTable("candle_cache", {
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  timestamp: integer("timestamp").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull(),
  cachedAt: integer("cached_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.exchange, table.symbol, table.timeframe, table.timestamp] }),
  rangeIdx: index("candle_cache_range_idx").on(table.exchange, table.symbol, table.timeframe, table.timestamp),
  ttlIdx: index("candle_cache_ttl_idx").on(table.cachedAt),
}));


export const workspaceStates = sqliteTable("workspace_states", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const strategies = sqliteTable("strategies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  description: text("description").notNull(),
  parameters: text("parameters").notNull(),
  source: text("source").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const datasetSnapshots = sqliteTable("dataset_snapshots", {
  datasetId: text("dataset_id").primaryKey(),
  byteLength: integer("byte_length").notNull(),
  createdAt: text("created_at").notNull(),
});

export const savedSweeps = sqliteTable("saved_sweeps", {
  sweepId: text("sweep_id").primaryKey(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
});

export const experiments = sqliteTable("experiments", {
  resultId: text("result_id").primaryKey(),
  datasetId: text("dataset_id").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  strategyId: text("strategy_id").notNull(),
  strategyVersion: text("strategy_version").notNull(),
  assumptions: text("assumptions").notNull(),
  result: text("result").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const spotAccounts = sqliteTable("spot_accounts", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
});

export const paperAccounts = sqliteTable("paper_accounts", {
  id: text("id").primaryKey(),
  quoteBalance: real("quote_balance").notNull(),
  baseBalance: real("base_balance").notNull(),
  averageEntryPrice: real("average_entry_price"),
  costBasis: real("cost_basis"),
  realizedPnl: real("realized_pnl").notNull(),
  feeRate: real("fee_rate").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const paperOrders = sqliteTable("paper_orders", {
  clientOrderId: text("client_order_id").primaryKey(),
  accountId: text("account_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: real("quantity").notNull(),
  status: text("status").notNull(),
  fillPrice: real("fill_price"),
  fee: real("fee").notNull(),
  createdAt: text("created_at").notNull(),
});

export const paperRecoveries = sqliteTable("paper_recoveries", {
  clientOrderId: text("client_order_id").primaryKey(),
  actionId: text("action_id").notNull().unique(),
  accountId: text("account_id"),
  previousStatus: text("previous_status").notNull(),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  requiresReview: integer("requires_review", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const orderPreviews = sqliteTable("order_previews", {
  id: text("id").primaryKey(),
  accountId: text("account_id"),
  exchange: text("exchange"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: real("quantity").notNull(),
  mode: text("mode").notNull(),
  referencePrice: real("reference_price").notNull(),
  estimatedNotional: real("estimated_notional").notNull(),
  estimatedFee: real("estimated_fee").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  orderId: text("order_id"),
});

export const replayExecutions = sqliteTable("replay_executions", {
  sessionId: text("session_id").primaryKey().references(() => replaySessions.id),
  payload: text("payload").notNull(),
});

export const replaySessions = sqliteTable("replay_sessions", {
  id: text("id").primaryKey(),
  /* Which venue the session's bars came from. Rows written before this column
     existed are backfilled to "binance" by the migration in db.ts, since that
     was the only venue the app could source from at the time. */
  exchange: text("exchange").notNull().default("binance"),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  startAt: integer("start_at").notNull(),
  cursor: integer("cursor").notNull(),
  bars: text("bars").notNull(),
  candleSource: text("candle_source"),
  candleCache: text("candle_cache"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
