/** Client-safe wire types. Decimal quantities, prices and money are JSON strings. */
export type DerivativesVenue = "okx" | "deribit";
export type DerivativesKind = "perpetual" | "future" | "option";
export interface DerivativesPolicy {
  mode: "local-isolated-paper";
  funding: "not-accrued-no-official-ledger";
  expiry: "freeze-awaiting-official-settlement";
  liquidation: "no-exchange-liquidation-simulation";
  losses: "capped-at-allocated-isolated-margin-before-fees";
  realizedPnl: "excludes-fees";
  maxLeverage: 20;
  maxQuoteAgeMs: 15000;
}
export const DERIVATIVES_POLICY: Readonly<DerivativesPolicy> = Object.freeze({
  mode: "local-isolated-paper", funding: "not-accrued-no-official-ledger",
  expiry: "freeze-awaiting-official-settlement", liquidation: "no-exchange-liquidation-simulation",
  losses: "capped-at-allocated-isolated-margin-before-fees", realizedPnl: "excludes-fees",
  maxLeverage: 20, maxQuoteAgeMs: 15000,
});
export interface DerivativesOrderRequest {
  venue: DerivativesVenue;
  settle: string;
  instrumentId: string;
  clientOrderId: string;
  action: "open" | "close";
  side: "long" | "short";
  /** Contracts, not base coins. */
  quantity: string;
  leverage: number;
  reduceOnly: boolean;
  /** Buy ceiling or sell floor in settle currency per base coin. */
  maximumPrice: string;
}
export interface DerivativesPosition {
  instrumentId: string;
  kind: DerivativesKind;
  side: "long" | "short";
  quantity: string;
  contractSize: string;
  entryPrice: string;
  margin: string;
  leverage: number;
  expiry: number | null;
}
export interface DerivativesOrder extends DerivativesOrderRequest {
  status: "filled";
  fillPrice: string;
  fee: string;
  realizedPnl: string;
  createdAt: number;
}
export interface DerivativesAccount {
  id: string;
  venue: DerivativesVenue;
  settle: string;
  available: string;
  initialBalance: string;
  feeRate: string;
  realizedPnl: string;
  feesPaid: string;
  positions: DerivativesPosition[];
  orders: DerivativesOrder[];
  policy: DerivativesPolicy;
}
export interface DerivativesOrderResult {
  account: DerivativesAccount;
  order: DerivativesOrder;
  deduplicated: boolean;
}
export interface DerivativesValuation {
  status: "marked" | "awaiting-official-settlement" | "margin-exhausted";
  unrealizedPnl: string | null;
  positionEquity: string | null;
}
