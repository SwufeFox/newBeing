import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const paperAccounts = sqliteTable("paper_accounts", {
  id: text("id").primaryKey(),
  quoteBalance: real("quote_balance").notNull(),
  baseBalance: real("base_balance").notNull(),
  averageEntryPrice: real("average_entry_price"),
  realizedPnl: real("realized_pnl").notNull(),
  feeRate: real("fee_rate").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const paperOrders = sqliteTable("paper_orders", {
  clientOrderId: text("client_order_id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: real("quantity").notNull(),
  status: text("status").notNull(),
  fillPrice: real("fill_price"),
  fee: real("fee").notNull(),
  createdAt: text("created_at").notNull(),
});

export const orderPreviews = sqliteTable("order_previews", {
  id: text("id").primaryKey(),
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

export const replaySessions = sqliteTable("replay_sessions", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  startAt: integer("start_at").notNull(),
  cursor: integer("cursor").notNull(),
  bars: text("bars").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
