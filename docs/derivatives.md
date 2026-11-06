# Derivatives workspace

`/derivatives` is a separate market and Paper execution surface. Its product IDs have the form `venue:kind:nativeId`; `BTC-USDT-SWAP`, a dated future and a BTC call can never share a spot candle-cache key or an account position merely because they refer to the same underlying asset.

On narrow screens, the workspace navigation and Engine model control remain visible, while bid/ask prices and contract details wrap to avoid overlapping.

## Product coverage

| Product | Public data | Paper exposure |
| --- | --- | --- |
| OKX USDT linear perpetual | Native instrument metadata, ticker/mark, available funding information and trade candles | Local isolated-margin long or short |
| Deribit USDC linear dated future | Native metadata, expiry, ticker/mark/index and trading-view candles | Local isolated-margin long or short before expiry |
| Deribit option | Native expiry, strike, call/put, contract size, settlement currency, bid/ask, mark and available IV/delta | Paid-premium long; sell only to close an existing long |

Unsupported inverse contracts and unsupported settlement specifications are rejected rather than interpreted through the spot or synthetic short engine. A public endpoint failure is an error, never a reason to substitute fixture data. Option candles can be sparse or unavailable; the workspace does not fill missing intervals or plot an underlying's candles as the option premium.

## Units and execution

Order size is **contracts**. The underlying size is `contracts × contractSize`. Bid/ask and premium are normalized to settlement currency per underlying unit; cost and linear PnL therefore include the multiplier. Option strike and the underlying index are in quote currency per underlying unit, which can differ from the currency used to pay the premium. Native quantity steps, minima and price ticks apply.

Orders use a fresh executable ask for a buy or bid for a sell. A mark is for valuation and does not replace a missing bid/ask. Price protection is a buy ceiling or a sell floor. The client order ID binds the full order intent; a lost HTTP response can be retried without creating another fill, while reusing the ID with different fields is rejected.

Order history is an append-only SQLite ledger indexed by account and client order ID. On first use, existing JSON order arrays move into that ledger in one transaction; a failed migration leaves the old data intact. Orders removed by older versions cannot be reconstructed from account balances. Stop older app or MCP processes before opening a migrated database; older versions do not understand the new ledger format.

The web account endpoints return the latest 20 fills in their original order, with `orderCount` reporting the complete history size. The former `orderLimit` query parameter is no longer supported. The workspace loads older fills per account on demand, including in a read-only Replay snapshot. `GET /api/derivatives/orders` accepts `venue`, `settle`, and an optional `before` client order ID; it returns up to 20 older fills in newest-first order and a `hasMore` flag. Without `before`, it returns the latest page. Use the last returned order's `clientOrderId` as the next cursor. If native metadata is unavailable, a previously filled order can still be recovered from its exact local identity and intent, even when it is outside the recent window; an unknown order still requires live metadata and a fresh quote.

Paper capital is seeded once, on an explicit account-open command. Reading an account does not open or top it up. Derivatives have independent SQLite persistence; spot/shared-spot/legacy and Replay wallets keep their existing identities and balances. Monetary arithmetic uses Decimal and wire values preserve decimal strings.

## Local model boundaries

Contract margin is an explicit local isolated Paper model, with leverage limited to 1–20×. Opening requires margin plus fees. Reducing a position releases its proportional margin and realizes the corresponding linear PnL. Options use fully paid premium and do not permit naked short exposure.

The live funding rate is market information. It is **not** a historical funding ledger and is not silently applied to Paper balances. The model does not claim to reproduce exchange maintenance tiers, insurance funds, automatic deleveraging or an exchange liquidation engine. Margin exhaustion must be treated as a local account warning, not proof that a real leveraged position would survive.

Expired products cannot open new positions. A position awaiting official settlement stays identifiable; its locally stored terms remain inspectable from the ledger even after the venue stops listing the contract. The last traded price, a current index and a zero premium are not interchangeable with an official delivery or exercise settlement. The current model freezes such positions pending official settlement rather than inventing a cash transfer.

## Research and Replay

The existing deterministic research and frozen Replay engine retains its spot dataset format and execution policy. Derivatives are not passed into that engine: reproducible derivatives research would also need versioned contract specifications, mark/index history, funding events and official settlement inputs. The original spot result identities are unaffected by adding the independent modules.

While the shared workspace is in Replay, public market-data reads and Paper POST commands remain blocked. The accounts list and single-account GET endpoints read only the local SQLite ledger and are available as a frozen, read-only snapshot. The derivatives UI labels this snapshot as frozen and removes position navigation and Paper actions while Replay is active. Paper mutations retain their Replay checks after network waits and inside the storage transaction. Returning to Markets restores the normal derivatives workspace.

## Development fixtures

The derivatives test provider uses deterministic metadata and quotes only when `NEWBEING_E2E_FIXTURES=1` in a non-production process. Responses identify their source as `fixture`. Production and normal local development use public exchange data. Browser acceptance tests must use an isolated `NEWBEING_DATA_DIR`, never the normal workstation database.
