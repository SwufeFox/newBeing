import { expect, test, type APIRequestContext, type APIResponse, type Page, type Request, type Route } from "@playwright/test";
import type { BacktestResult, Candle, SpotAccount } from "@newbeing/core";
import { readJson, VIEW, REPLAY_INTERVAL, REPLAY_MARKET, setTrainingWorkspace, trainingCandles, type ReplaySeed, type ReplaySnapshot } from "./replay-api.js";

const config = {
  accountMode: "spot", initialCapital: 10_000, positionFraction: 0.25,
  feeRate: 0.001, slippageRate: 0.0005, allowShorts: false,
} as const;
const parameters = { fastPeriod: 20, slowPeriod: 50, allowShorts: false };
const staleMessage = "Previous evaluation — inputs have changed. Run again for the current inputs.";
const responseTimeout = 30_000;

async function prepareWorkspace(request: APIRequestContext, activeWorkspace: "research" | "terminal") {
  await setTrainingWorkspace(request);
  const { state } = await readJson<{ state: Record<string, unknown> }>(await request.get("/api/workspace"));
  await readJson(await request.put("/api/workspace", {
    data: { ...state, activeWorkspace, selectedStrategyId: "sma-crossover", activeBacktestId: null, activeReplayId: null },
  }));
}

function postResponse(page: Page, path: string) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === path && response.request().method() === "POST",
  { timeout: responseTimeout });
}

// Fetch the real response first, then hold its delivery while the user changes context.
async function gateResponse(page: Page, pattern: string, matches: (request: Request) => boolean) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let fetched: APIResponse | undefined;
  let finished = false;
  let claimed = false;
  let failure: unknown;
  await page.route(pattern, async (route) => {
    if (claimed || !matches(route.request())) {
      await route.fallback();
      return;
    }
    claimed = true;
    try {
      fetched = await route.fetch({ timeout: responseTimeout });
      await gate;
      await route.fulfill({ response: fetched });
    } catch (error) {
      // Input changes can abort the browser request while the backend has completed.
      if (!fetched || !route.request().failure()) failure = error;
    } finally {
      finished = true;
    }
  });
  return {
    async response() {
      await expect.poll(() => Boolean(fetched) || finished, { timeout: responseTimeout }).toBe(true);
      if (failure) throw failure;
      if (!fetched) throw new Error("The gated backend response was not fetched.");
      return fetched;
    },
    release,
    async deliver() {
      release();
      await expect.poll(() => finished, { timeout: responseTimeout }).toBe(true);
      if (failure) throw failure;
    },
  };
}

/* Hold EVERY matching request, not just the first: the summary is polled every few
   seconds, so a single-claim gate lets the next poll deliver the state we meant to
   withhold and the test then asserts against data it never saw gated. Each held
   request is forwarded once on release, so every response is still the backend's. */
async function holdResponses(page: Page, pattern: string, matches: (request: Request) => boolean) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handler = async (route: Route): Promise<void> => {
    if (!matches(route.request())) {
      await route.fallback();
      return;
    }
    await gate;
    await route.continue();
  };
  await page.route(pattern, handler);
  return {
    release,
    async unroute(): Promise<void> {
      release();
      await page.unroute(pattern, handler);
    },
  };
}

async function configureStrategy(page: Page) {
  await page.getByRole("tab", { name: "Strategy lab", exact: true }).click();
  const lab = page.locator(".strategy-lab");
  await lab.getByLabel("STRATEGY TEMPLATE", { exact: true }).selectOption("sma-crossover");
  await lab.locator(".param-row").filter({ hasText: "Fast period" }).getByRole("spinbutton").fill("20");
  await lab.locator(".param-row").filter({ hasText: "Slow period" }).getByRole("spinbutton").fill("50");
  await lab.getByLabel("Backtest account mode").selectOption("spot");
  await lab.getByLabel("INITIAL CAPITAL", { exact: true }).fill("10000");
  await lab.getByLabel("POSITION %", { exact: true }).fill("25");
  await lab.getByLabel("FEE (BPS)", { exact: true }).fill("10");
  await lab.getByLabel("SLIPPAGE (BPS)", { exact: true }).fill("5");
}

async function openSharedTicket(page: Page) {
  await page.getByRole("tab", { name: "Order book", exact: true }).click();
  await page.getByLabel("Paper wallet").selectOption("shared-spot");
  return page.getByTestId("shared-spot-ticket");
}

async function runUiBacktest(page: Page): Promise<BacktestResult> {
  await configureStrategy(page);
  const pending = postResponse(page, "/api/backtests");
  await page.getByRole("button", { name: "Run backtest", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ ...REPLAY_MARKET, parameters, config });
  const result = await response.json() as BacktestResult;
  expect(result.datasetId).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(result.assumptions).toMatchObject(config);
  await expect(page.getByRole("button", { name: "Continue to Replay", exact: true })).toBeVisible();
  return result;
}

function canonicalBars(candles: Candle[], result: BacktestResult) {
  const byTime = new Map(candles.map((bar) => [bar.timestamp, bar]));
  const bars = result.equityCurve.map((point) => {
    const bar = byTime.get(point.timestamp);
    expect(bar, `Fixture must contain canonical backtest bar ${point.timestamp}`).toBeDefined();
    return bar!;
  });
  expect(bars.length).toBeGreaterThanOrEqual(100);
  return bars;
}

test.describe("evaluation and shared spot browser regressions", () => {
  test.use({ extraHTTPHeaders: { origin: new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin } });
  // These cases include multiple real backend writes and controlled response delivery.
  test.setTimeout(120_000);
  test.beforeEach(() => {
    test.skip(process.env.PLAYWRIGHT_API_STUBS === "1", "These regressions require the real backend and deterministic market fixtures.");
  });

  test("startup keeps controls hidden until the saved workspace is restored", async ({ page, request }) => {
    await trainingCandles(request);
    await prepareWorkspace(request, "research");
    const startup = await gateResponse(page, "**/api/workspace", (req) => req.method() === "GET");
    try {
      await page.goto(VIEW.research, { waitUntil: "domcontentloaded" });
      const response = await startup.response();
      expect(response.ok()).toBeTruthy();
      await expect(page.getByRole("status")).toHaveText("Loading local workspace…");
      await expect(page.getByTestId("workspace-research")).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      await startup.deliver();
      await expect(page.locator("main.mode-layout-research")).toBeVisible();
      await expect(page.locator(".chart-toolbar-left")).toContainText("BTC/USDT · 1d");
      await page.setViewportSize({ width: 1024, height: 700 });
      await expect.poll(async () => (await page.locator("canvas").first().boundingBox())?.height ?? 0).toBeGreaterThan(70);
      const cached = await page.evaluate(() => JSON.parse(localStorage.getItem("newbeing-workspace-v1") ?? "{}"));
      expect(cached.state).not.toHaveProperty("workspaceReady");
    } finally {
      startup.release();
    }
  });

  test("startup falls back to local controls when the workspace response never arrives", async ({ page, request }) => {
    await trainingCandles(request);
    await prepareWorkspace(request, "research");
    const startup = await gateResponse(page, "**/api/workspace", (req) => req.method() === "GET");
    try {
      await page.goto(VIEW.research, { waitUntil: "domcontentloaded" });
      await startup.response();
      await expect(page.getByRole("status")).toHaveText("Loading local workspace…");
      await expect(page.getByTestId("workspace-research")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Loading local workspace…", { exact: true })).toHaveCount(0);
    } finally {
      startup.release();
    }
  });

  test("completed Evaluate renders training and holdout, stays stale, and ignores an aborted second response", async ({ page, request }) => {
    await trainingCandles(request);
    await prepareWorkspace(request, "research");
    const backtest = await readJson<{ datasetId: string }>(await request.post("/api/backtests", {
      data: { ...REPLAY_MARKET, strategyId: "sma-crossover", parameters, config, limit: 500 },
    }), 201);
    expect(backtest.datasetId).toMatch(/^sha256:[a-f0-9]{64}$/);
    await page.goto(VIEW.research);
    await configureStrategy(page);
    await page.getByRole("tab", { name: "Evaluate", exact: true }).click();
    await page.getByLabel("Evaluation dataset id").fill(backtest.datasetId);
    const split = page.getByLabel("Holdout split index");
    await split.fill("300");
    const run = page.getByTestId("run-evaluation");
    const pending = postResponse(page, "/api/evaluations");
    await run.click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const report = await response.json();
    expect(report.datasetId).toBe(backtest.datasetId);
    expect(report.training).toHaveLength(6);
    expect(report.trainingBoundary.endIndexExclusive).toBe(300);
    expect(report.holdoutBoundary.startIndex).toBe(300);
    expect(report.resultIds.holdout).toBe(report.holdout.resultId);
    const panel = page.locator(".evaluation-panel");
    await expect(panel.getByRole("status")).toHaveText("Saved evaluation for these inputs.");
    await expect(panel.locator(".evaluation-verdict")).toContainText(report.holdout.metrics.finalEquity.toFixed(2));
    await expect(panel.locator(".evaluation-table tbody tr")).toHaveCount(report.training.length);
    await expect(panel.locator(".evaluation-bounds")).toContainText("300 bars");
    await expect(panel.locator(".evaluation-bounds")).toContainText("200 bars");
    const savedRequest = panel.locator("details");
    const savedRequestText = await savedRequest.textContent();
    const savedTable = await panel.locator(".evaluation-table").textContent();
    await split.fill("301");
    await expect(panel.getByRole("status")).toHaveText(staleMessage);

    const second = await gateResponse(page, "**/api/evaluations", (req) => req.method() === "POST");
    try {
      await run.click();
      const late = await second.response();
      expect(late.status()).toBe(201);
      const lateReport = await late.json();
      expect(lateReport.trainingBoundary.endIndexExclusive).toBe(301);
      expect(lateReport.holdout.resultId).not.toBe(report.holdout.resultId);
      await expect(panel.getByRole("status")).toContainText("New evaluation pending; showing the saved report.");
      await split.fill("302");
      await expect(panel.getByRole("status")).toHaveText(staleMessage);
      await second.deliver();
      // Returning to the second request's inputs would expose an incorrectly accepted report.
      await split.fill("301");
      await expect(panel.getByRole("status")).toHaveText(staleMessage);
      await expect(savedRequest).toHaveText(savedRequestText!);
      await expect(panel.locator(".evaluation-table")).toHaveText(savedTable!);
      await expect(panel.locator(".evaluation-verdict")).toContainText(report.holdout.metrics.finalEquity.toFixed(2));
      await expect(run).toBeEnabled();
    } finally {
      second.release();
    }
  });

  test("late summary supplies the shared ticket maximum price default and preserves a manual price", async ({ page, request }) => {
    await trainingCandles(request);
    await prepareWorkspace(request, "terminal");
    await readJson(await request.post("/api/spot", { data: { action: "open", exchange: "binance", quote: "USDT" } }));
    for (const manual of [false, true]) {
      const summaryGate = await holdResponses(page, "**/api/market?**", (req) => {
        const url = new URL(req.url());
        return url.searchParams.get("kind") === "summary" && url.searchParams.get("symbol") === REPLAY_MARKET.symbol;
      });
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        const ticket = await openSharedTicket(page);
        await expect(ticket).toHaveAttribute("data-loaded", "true");
        const maximumPrice = ticket.getByLabel("Shared spot maximum price");
        await expect(maximumPrice).toHaveValue("");
        if (manual) await maximumPrice.fill("12345.67");
        // No summary has been delivered yet, so a default would be fabricated.
        await expect(page.locator(".exchange-time")).toHaveText("Awaiting feed");
        const delivered = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === "/api/market" && url.searchParams.get("kind") === "summary"
            && url.searchParams.get("symbol") === REPLAY_MARKET.symbol;
        }, { timeout: responseTimeout });
        summaryGate.release();
        const response = await delivered;
        expect(response.ok()).toBeTruthy();
        // Summary responses include both quote values and their data-source label.
        const summary = await response.json() as { last: number | null; ask: number | null };
        expect(typeof summary.last).toBe("number");
        await expect(page.locator(".exchange-time")).toHaveText(/^Updated:/);
        await expect(maximumPrice).toHaveValue(manual ? "12345.67" : String((summary.ask ?? summary.last!) * 1.005));
      } finally {
        await summaryGate.unroute();
      }
    }
  });

  test("shared spot sizing toggle exposes its active side to keyboard users", async ({ page, request }) => {
    await trainingCandles(request);
    await prepareWorkspace(request, "terminal");
    await readJson(await request.post("/api/spot", { data: { action: "open", exchange: "binance", quote: "USDT" } }));
    await page.goto("/");
    const ticket = await openSharedTicket(page);
    await expect(ticket).toHaveAttribute("data-loaded", "true");

    await page.setViewportSize({ width: 390, height: 844 });
    const toggle = ticket.getByRole("button", { name: "Toggle sizing side" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.focus();
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(ticket).toContainText("SIZING · SELL");
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(ticket).toContainText("SIZING · BUY");
    const { viewportWidth, documentWidth } = await page.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test("shared wallet waits for reads, shares an account across pairs, and discards a stale venue read", async ({ page, request }) => {
    await trainingCandles(request);
    await prepareWorkspace(request, "terminal");
    await readJson(await request.post("/api/spot", { data: { action: "open", exchange: "binance", quote: "USDT" } }));
    const isRead = (exchange: string) => (req: Request) => req.method() === "GET" && new URL(req.url()).searchParams.get("exchange") === exchange;
    const initial = await gateResponse(page, "**/api/spot?**", isRead("binance"));
    const ticket = page.getByTestId("shared-spot-ticket");
    const expectLoading = async () => {
      await expect(ticket).toHaveAttribute("data-loaded", "false");
      await expect(ticket.getByRole("status")).toHaveText("Loading shared account…");
      await expect(ticket.getByRole("button", { name: /^Open new/ })).toHaveCount(0);
      await expect(ticket.getByRole("button", { name: "Buy spot", exact: true })).toHaveCount(0);
      await expect(ticket.getByRole("button", { name: "Sell inventory", exact: true })).toHaveCount(0);
    };
    try {
      await page.goto("/");
      await openSharedTicket(page);
      const initialResponse = await initial.response();
      const first = await readJson<{ account: SpotAccount }>(initialResponse);
      expect(first.account).toMatchObject({ exchange: "binance", quote: "USDT" });
      await expectLoading();
      await initial.deliver();
      await expect(ticket).toHaveAttribute("data-loaded", "true");
      await expect(ticket.getByRole("button", { name: "Buy spot", exact: true })).toBeVisible();
      const crossPair = await gateResponse(page, "**/api/spot?**", isRead("binance"));
      try {
        await page.getByTitle("Select ETH/USDT", { exact: true }).click();
        const same = await readJson<{ account: SpotAccount }>(await crossPair.response());
        expect(same.account.id).toBe(first.account.id);
        expect(same.account.balances).toEqual(first.account.balances);
        await expectLoading();
        await crossPair.deliver();
        await expect(ticket).toHaveAttribute("data-loaded", "true");
      } finally {
        crossPair.release();
      }

      const stale = await gateResponse(page, "**/api/spot?**", isRead("binance"));
      const next = await gateResponse(page, "**/api/spot?**", isRead("kraken"));
      try {
        await ticket.getByRole("button", { name: "Refresh shared account", exact: true }).click();
        const staleResponse = await stale.response();
        expect((await readJson<{ account: SpotAccount }>(staleResponse)).account.id).toBe(first.account.id);
        await page.getByRole("banner").getByLabel("Exchange", { exact: true }).selectOption("kraken");
        const nextResponse = await next.response();
        const current = await readJson<{ account: SpotAccount | null }>(nextResponse);
        await expect(ticket).toContainText("Shared spot · kraken · USD");
        await expectLoading();
        await stale.deliver();
        await expectLoading();
        await expect(ticket.getByLabel("Shared spot quantity")).toHaveCount(0);
        await next.deliver();
        await expect(ticket).toHaveAttribute("data-loaded", "true");
        if (current.account) {
          expect(current.account).toMatchObject({ exchange: "kraken", quote: "USD" });
          expect(current.account.id).not.toBe(first.account.id);
          await expect(ticket.getByRole("button", { name: "Buy spot", exact: true })).toBeVisible();
          for (const [asset, balance] of Object.entries(current.account.balances)) {
            await expect(ticket).toContainText(`${asset}: ${balance.total} · reserved ${balance.reserved}`);
          }
        } else {
          await expect(ticket.getByRole("button", { name: "Open new 10,000 USD account", exact: true })).toBeVisible();
          await expect(ticket.getByRole("button", { name: "Buy spot", exact: true })).toHaveCount(0);
        }
      } finally {
        stale.release();
        next.release();
      }
    } finally {
      initial.release();
    }
  });

  test("UI backtest hands its canonical dataset to frozen Replay with the correct seed and one future-free step", async ({ page, request }) => {
    const candles = await trainingCandles(request);
    await prepareWorkspace(request, "research");
    await page.goto(VIEW.research);
    const result = await runUiBacktest(page);
    // The selected result retains its own provenance when the draft changes.
    await page.getByRole("tab", { name: "Strategy lab", exact: true }).click();
    await page.locator(".strategy-lab .param-row").filter({ hasText: "Fast period" }).getByRole("spinbutton").fill("10");
    await page.locator(".strategy-lab").getByLabel("FEE (BPS)", { exact: true }).fill("25");
    await page.locator(".timeframe-selector").getByRole("button", { name: "1h", exact: true }).click();
    await page.getByRole("tab", { name: "AI context", exact: true }).click();
    const panel = page.locator(".context-panel");
    const evidence = panel.getByTestId("ai-backtest-evidence");
    await expect(evidence).toContainText(`${result.symbol} · ${result.timeframe} · ${result.strategyId}`);
    await expect(evidence).toContainText(`fastPeriod: ${String(result.parameters.fastPeriod)}`);
    await expect(evidence).toContainText("independent validation");
    await expect(evidence).toContainText("SAMPLE:");
    await expect(evidence).toContainText("SEGMENT:");
    await expect(evidence).toContainText("unknown");
    await panel.getByRole("button", { name: "Prompt Synthesizer" }).click();
    await expect(panel).toContainText("25.0 bps fee and 5.0 bps slippage");
    await panel.getByRole("button", { name: "Overfit Audit" }).click();
    await expect(panel).toContainText(`# Strategy Robustness & Overfit Audit: ${result.symbol} (${result.timeframe})`);
    await expect(panel).toContainText(`Parameters: ${JSON.stringify(result.parameters)}`);
    await expect(panel).toContainText(`Result ID: ${result.resultId}`);
    await expect(panel).toContainText(`Dataset ID: ${result.datasetId}`);
    await expect(panel).toContainText("Sample Range:");
    await expect(panel).toContainText("Segment Nature: unknown");
    await expect(panel).not.toContainText('"fastPeriod":10');
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await panel.getByRole("button", { name: "Copy Prompt for AI" }).click();
    const audit = await page.evaluate(() => navigator.clipboard.readText());
    expect(audit).toContain(JSON.stringify(result.parameters));
    expect(audit).toContain(JSON.stringify(result.assumptions));
    expect(audit).toContain(result.datasetId);
    expect(audit).toContain("Sample Range:");
    expect(audit).toContain("Segment Nature: unknown");

    await panel.getByRole("button", { name: "Risk Guardrails" }).click();
    await expect(panel).toContainText("# Risk Management & Sizing Guardrails:");
    await expect(panel).toContainText(`# Risk Management & Sizing Guardrails: ${result.symbol} (${result.timeframe})`);
    await expect(panel).toContainText(`Input source: Selected historical backtest ${result.resultId}`);
    await expect(panel).toContainText("Initial Allocation: 25%");
    await expect(panel).toContainText("Execution Fees: 10.0 bps fee, 5.0 bps slippage");
    await expect(panel).toContainText("Missing Empirical Inputs");
    await expect(panel).toContainText("DO NOT fabricate arbitrary percentage Kelly sizing");
    await panel.getByRole("button", { name: "Copy Prompt for AI" }).click();
    const risk = await page.evaluate(() => navigator.clipboard.readText());
    expect(risk).toContain("Missing Empirical Inputs");
    expect(risk).toContain("f* = c * (p*b - q) / b");
    expect(risk).toContain("Volatility-Calibrated Exits");
    await panel.getByRole("button", { name: "Overfit Audit" }).click();
    const bars = canonicalBars(candles, result);
    const limit = Math.min(200, Math.floor(bars.length / 2));
    const pending = postResponse(page, "/api/replay");
    await page.getByRole("button", { name: "Continue to Replay", exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({
      ...REPLAY_MARKET, datasetId: result.datasetId, endAt: bars[limit - 1]!.timestamp + REPLAY_INTERVAL,
      limit, initialCapital: config.initialCapital, feeRate: config.feeRate, slippageRate: config.slippageRate, navigate: false,
    });
    const seed = await response.json() as ReplaySeed & { source: string };
    expect(seed.source).toBe("Frozen research dataset snapshot");
    expect(seed.execution.datasetId).toBe(result.datasetId);
    expect(seed.execution.config).toEqual({ initialCapital: config.initialCapital, feeRate: config.feeRate, slippageRate: config.slippageRate });
    expect(seed.session.bars).toEqual(bars.slice(0, limit));
    expect(seed.session.cursor).toBe(bars[limit - 1]!.timestamp);
    expect(seed.futureBarsLoaded).toBe(0);
    expect(seed.execution.fills).toEqual([]);
    expect(seed.portfolio.quoteBalance).toBe(config.initialCapital);
    await expect(page.locator(".replay-ticket").getByText("REPLAY SIMULATOR", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Tactical Briefing", exact: true }).click();
    await expect(evidence).toContainText("Backtest results are hidden during Replay.");
    await expect(evidence.getByText("SHARPE", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Copy Tactical Briefing" }).click();
    const replayBriefing = await page.evaluate(() => navigator.clipboard.readText());
    expect(replayBriefing).toContain("Backtest results are hidden during Replay.");
    expect(replayBriefing).toContain("Market quote: unavailable during Replay.");
    expect(replayBriefing).not.toContain("Latest Price");
    expect(replayBriefing).not.toContain(result.resultId);
    expect(replayBriefing).not.toContain(result.datasetId);

    await panel.getByRole("button", { name: "Prompt Synthesizer" }).click();
    await expect(panel).toContainText("Backtest results are hidden during Replay.");
    await expect(panel).not.toContainText("Total Return:");
    await panel.getByRole("button", { name: "Copy Prompt for AI" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(result.resultId);
    await panel.getByRole("button", { name: "Risk Guardrails" }).click();
    await expect(panel).toContainText("Backtest results are hidden during Replay.");
    await expect(panel).toContainText("Input source: Current workspace settings");
    await panel.getByRole("button", { name: /Copy Prompt for AI|Copied Prompt to Clipboard/ }).click();
    const replayRisk = await page.evaluate(() => navigator.clipboard.readText());
    expect(replayRisk).not.toContain(result.resultId);
    expect(replayRisk).not.toContain("Backtest Trade Count:");

    await panel.getByRole("button", { name: "Raw Schema" }).click();
    await panel.getByRole("button", { name: "Copy Context JSON" }).click();
    const replayContext = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as Record<string, unknown>;
    expect(replayContext.activeBacktestId).toBeNull();
    expect(replayContext.activeBacktest).toBeNull();
    expect(replayContext.activeBacktestMetrics).toBeNull();
    const stepped = postResponse(page, `/api/replay/${seed.session.id}`);
    await page.getByTestId("replay-step").click();
    const stepResponse = await stepped;
    expect(stepResponse.status()).toBe(200);
    expect(stepResponse.request().postDataJSON()).toMatchObject({ action: "step", expectedCursor: seed.session.cursor, expectedRevision: seed.execution.revision });
    const state = await stepResponse.json() as ReplaySnapshot;
    expect(state.execution.datasetId).toBe(result.datasetId);
    expect(state.execution.revision).toBe(seed.execution.revision + 1);
    expect(state.session.cursor).toBe(bars[limit]!.timestamp);
    expect(state.bar).toEqual(bars[limit]);
    expect(state.session.bars).toEqual(bars.slice(0, limit + 1));
    expect(state.session.bars.every((bar) => bar.timestamp <= state.session.cursor)).toBe(true);
    expect(state.futureBarsLoaded).toBe(0);
    await expect(page.getByTestId("replay-step")).toBeEnabled();
    await page.getByTestId("workspace-research").click();
    await page.getByRole("tab", { name: "AI context", exact: true }).click();
    await panel.getByRole("button", { name: "Tactical Briefing", exact: true }).click();
    await expect(evidence).toContainText(`fastPeriod: ${String(result.parameters.fastPeriod)}`);
    await expect(evidence).toContainText("SHARPE");
  });

  test("AI evidence links saved holdout and walk-forward results by their actual identity", async ({ page, request }) => {
    await trainingCandles(request);
    await prepareWorkspace(request, "research");
    const original = await readJson<BacktestResult>(await request.post("/api/backtests", {
      data: { ...REPLAY_MARKET, strategyId: "sma-crossover", parameters, config, limit: 500 },
    }), 201);
    const evaluation = await readJson<{
      reportId: string;
      resultIds: { training: string[]; holdout: string };
      trainingBoundary: { startIndex: number; endIndexExclusive: number };
      holdoutBoundary: { startIndex: number; endIndexExclusive: number };
    }>(await request.post("/api/evaluations", {
      data: { datasetId: original.datasetId, strategyId: "sma-crossover", candidates: [parameters], config, splitIndex: 300 },
    }), 201);
    const sweep = await readJson<{
      sweepId: string;
      walkForward: { finalTestResultId: string; folds: Array<{ validationResultId: string }> };
    }>(await request.post("/api/sweeps", {
      data: { ...REPLAY_MARKET, strategyId: "sma-crossover", parameters, config, parameter: "fastPeriod", from: 20, to: 20, step: 1, mode: "walk-forward", limit: 500 },
    }), 201);

    await page.goto(VIEW.research);
    await page.getByRole("tab", { name: "AI context", exact: true }).click();
    const panel = page.locator(".context-panel");
    const evidence = panel.getByTestId("ai-backtest-evidence");
    const openResult = async (id: string) => {
      await page.getByRole("tab", { name: "Experiments", exact: true }).click();
      await page.getByRole("button", { name: `Open result ${id.slice(0, 12)}`, exact: true }).click();
    };

    await openResult(evaluation.resultIds.holdout);
    await expect(evidence).toContainText("Holdout (out-of-sample partition)");
    await expect(evidence).toContainText(`Evaluation ${evaluation.reportId}: Holdout partition [${evaluation.holdoutBoundary.startIndex}, ${evaluation.holdoutBoundary.endIndexExclusive})`);
    await expect(evidence).toContainText("retuning after inspection");
    await panel.getByRole("button", { name: "Prompt Synthesizer" }).click();
    await panel.getByRole("button", { name: "Overfit Audit" }).click();
    await expect(panel).toContainText(`Holdout partition [${evaluation.holdoutBoundary.startIndex}, ${evaluation.holdoutBoundary.endIndexExclusive})`);
    await panel.getByRole("button", { name: "Tactical Briefing" }).click();

    await openResult(evaluation.resultIds.training[0]!);
    await expect(evidence).toContainText("Training (in-sample candidate partition)");
    await expect(evidence).toContainText(`Training candidate partition [${evaluation.trainingBoundary.startIndex}, ${evaluation.trainingBoundary.endIndexExclusive})`);

    await openResult(sweep.walkForward.finalTestResultId);
    await expect(evidence).toContainText("Walk-forward final test (out-of-sample)");
    await expect(evidence).toContainText(`Walk-forward ${sweep.sweepId} final test`);
    await expect(evidence).toContainText("retuning after inspection");

    await openResult(sweep.walkForward.folds[0]!.validationResultId);
    await expect(evidence).toContainText("Walk-forward fold validation (out-of-sample fold)");
    await expect(evidence).toContainText("Historical folds are not independent evidence.");

    await openResult(original.resultId);
    await expect(evidence).toContainText("SEGMENT: unknown");
    await expect(evidence).toContainText("Only the 20 most recent evaluations and sweeps are searched");
    await expect(evidence).not.toContainText(`Evaluation ${evaluation.reportId}`);
  });

  test("late Replay creation cannot hijack the user's new research workspace", async ({ page, request }) => {
    const candles = await trainingCandles(request);
    await prepareWorkspace(request, "research");
    await page.goto(VIEW.research);
    await runUiBacktest(page);
    await page.getByTestId("workspace-replay").click();
    const endAt = candles[600]!.timestamp + REPLAY_INTERVAL;
    const start = new Date(endAt);
    const localStart = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await page.getByLabel("START AT · LOCAL TIME").fill(localStart);
    const creation = await gateResponse(page, "**/api/replay", (req) => req.method() === "POST");
    try {
      await page.getByTestId("replay-seed").click();
      const response = await creation.response();
      expect(response.status()).toBe(201);
      const seed = await response.json() as ReplaySeed;
      expect(seed.session.cursor).toBe(candles[600]!.timestamp);
      expect(seed.session.bars.at(-1)).toEqual(candles[600]);
      expect(seed.futureBarsLoaded).toBe(0);
      await page.getByTestId("workspace-research").click();
      await page.getByRole("tab", { name: "Results", exact: true }).click();
      await expect(page.getByRole("button", { name: "Starting replay…", exact: true })).toBeDisabled();
      await creation.deliver();
      // The busy flag clears in the creation handler's finally block, after its navigation guard.
      await expect(page.getByRole("button", { name: "Continue to Replay", exact: true })).toBeEnabled();
      await expect(page.locator("main.mode-layout-research")).toBeVisible();
      await expect(page.getByTestId("replay-step")).toHaveCount(0);
      await expect(page.locator(".replay-ticket")).toHaveCount(0);
      const saved = await readJson<ReplaySnapshot>(await request.get(`/api/replay/${seed.session.id}`));
      expect(saved.session.id).toBe(seed.session.id);
      expect(saved.session.cursor).toBe(seed.session.cursor);
      await page.reload();
      await expect(page.locator("main.mode-layout-research")).toBeVisible();
      await expect(page.locator(".replay-ticket")).toHaveCount(0);
    } finally {
      creation.release();
    }
  });
});
