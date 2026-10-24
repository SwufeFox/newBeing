# Derivatives market data

Independent, read-only server module. Import from `@newbeing/market-data/derivatives` (or the package root). Spot APIs and core ExchangeId remain unchanged. The derivatives types deliberately do not expand the spot venue union.

```ts
import {
  listDerivativeInstruments, getDerivativeInstrument,
  getDerivativeQuote, getDerivativeCandles,
} from "@newbeing/market-data/derivatives";

const instruments = await listDerivativeInstruments("perpetual", "BTC");
const instrument = await getDerivativeInstrument(instruments[0]!.id);
const quote = await getDerivativeQuote(instrument.id);
const candles = await getDerivativeCandles(instrument.id, "1h", 100);
```

## Scope and native sources

- OKX: USDT-settled linear SWAP perpetuals only. Source: [public instruments](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments), market ticker/candles, public mark-price/open-interest/funding-rate. `ctValCcy` supplies base; `ctVal * ctMult` supplies base coins per contract. Missing native contract size or multiplier rejects the instrument. Inverse, spot, margin and non-USDT products are excluded.
- OKX FUTURES returned only BTC/ETH/USD-settled instruments with no USDT linear dated futures at verification time, so the OKX future query normally contributes nothing; it is kept as a fixed query and never relabels other products.
- Deribit: USDC-settled `instrument_type=linear` dated futures plus actually listed USDC-settled linear options and BTC/ETH-settled `instrument_type=reversed` BTC/ETH options. Sources: [public API](https://docs.deribit.com/), `public/get_instruments`, `public/get_instrument`, `public/ticker`, `public/get_tradingview_chart_data`. `contract_size`, `base_currency`, `counter_currency`, `settlement_currency`, `expiration_timestamp`, `strike`, `option_type` are authoritative. Perpetual rows surfacing under `kind=future` are excluded from dated futures. No invented markets or symbol parsing. Verified live for BTC/ETH coin options, BTC/AVAX USDC options and BTC USDC dated futures.
- This module supplies market data only. It does not enable option shorting, margin, or execution; consumers adding coin options to an order flow must keep the requested long-option restriction.

## Units and identity

| Field | Unit / meaning |
| --- | --- |
| `id` | `venue:kind:nativeId`; display symbols cannot substitute for IDs |
| `contractSize` | Base coins per contract for every supported product |
| `quantityStep`, `minContracts` | Contracts; Deribit native `min_trade_amount` in base coins is divided by `contract_size` |
| `bid`, `ask`, `last`, `mark` | Settlement currency per **one base coin**, including option premium; never premium per contract |
| `priceTick`, `priceTickSteps` | Settlement currency/base coin; Deribit variable tick thresholds are retained |
| `index`, `strike` | Quote currency/base coin (`counter_currency` supplies Deribit quote; USD for BTC/ETH coin options, USDC for linear options) |
| `openInterest` | Contracts; OKX `oi` already uses contracts; Deribit `open_interest` is base coins, divided by contractSize |
| `iv` | Annualized fraction; Deribit `mark_iv` percent divided by 100 |
| `delta` | Dimensionless native delta; no invented conversion |
| `fundingRate` | Fraction for the venue funding interval, not annualized |
| `timestamp`, `expiry`, `nextFundingAt` | UTC epoch milliseconds; perpetual expiry is null |
| Candle OHLC / volume | Settlement/base prices / base coins; OKX native contract volume multiplied by contractSize; Deribit chart volume is already base coins |

For example, AVAX USDC option contractSize=100 and premium=1.25 means 1.25 USDC/AVAX, or 125 USDC for one contract. BTC coin option contractSize=1 and premium=0.025 means 0.025 BTC per BTC of underlying, or 0.025 BTC per contract. A fractional contract quantity scales both base exposure and premium proportionally.

Missing native fields stay null. A native quote timestamp older than 30 seconds, more than 5 seconds in the future, or missing is rejected. Closed/inactive/expired instruments, mismatched identity, crossed bid/ask and quotes without any usable price are rejected. Optional OKX mark, OI and funding responses require their own valid identity and fresh timestamp; failures leave their fields null. OKX index remains null because its ticker does not carry an index. `nextFundingAt` uses OKX `fundingTime` (upcoming settlement), not `nextFundingTime` (the following interval).

## Bounds and candles

Metadata requests (instrument lists and single-instrument lookups) have a 15 second abort deadline; ticker and candle reads keep an 8 second deadline. Identical pending reads coalesce; successful metadata caches for 30 seconds and quote/candle reads for 1 second. Cache keys are capped at 256. Lists perform one OKX request, two requests for futures (OKX FUTURES plus one Deribit USDC future query), or exactly three Deribit option requests (USDC, BTC, ETH), with no pagination or all-market CCXT scan. Native result arrays are capped at 20,000 rows, query length at 100, and list output at 100 active matches. Use a narrower query or exact native ID rather than treating the list as an exhaustive catalogue.

Candles reuse core `Candle` and `Timeframe`. Limit must be an integer in [1, 300]. OKX returns only confirmed closed bars, sorted and deduplicated; Deribit futures come from `get_tradingview_chart_data` with the still-forming last bucket dropped; missing intervals remain missing. There is no pagination or gap filling. **Options candles are explicitly unsupported** and throw a descriptive error in both native and fixture modes.

## Deterministic fixtures and validation

`NEWBEING_MARKET_DATA_FIXTURE=1` with `NODE_ENV !== "production"` explicitly selects deterministic derivative fixtures. The existing spot fixture switch is `NEWBEING_E2E_FIXTURES=1` with `NODE_ENV !== "production"`; derivatives also honor that exact legacy condition. Spot itself is not changed. Environment is read when a client is constructed (the exported convenience functions construct their singleton on first use). An explicit `fixture` constructor option overrides environment switches for tests.

Fixture mode performs no network requests, supplies a perpetual, two dated futures and a USDC linear call option, and marks all instruments/quotes `source: "fixture"`. Fixture quotes are stamped at read time so the same 15-second freshness check applies; fixed fixture expiries intentionally do not follow the wall clock. Fixtures must not be presented as live quotes. Native responses carry `source: "native-api"`. Candle source is obtained from instrument metadata because core Candle is reused without extra fields.

Tests cover metadata, contract quantities, premium/IV/OI/volume units, filters, identity, invalid quotes, request sharing, native error retries, closed sparse bars and fixture switches. Run `pnpm --filter @newbeing/market-data typecheck` and `pnpm --filter @newbeing/market-data test`. Opt in to the real public API smoke tests with `NEWBEING_DERIVATIVES_LIVE=1` when running the tests; regular tests make no network requests.
