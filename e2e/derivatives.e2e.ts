import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

type FixturePosition = { instrumentId: string; side: string; quantity: string; leverage: number };
type FixtureAccount = { id: string; available: string; initialBalance: string; feesPaid: string; orderCount: number; positions: FixturePosition[]; orders: Array<{ clientOrderId: string }> };
let accountsBefore: FixtureAccount[] = [];
let attemptId = "";
const touchedInstruments = new Set<string>();

function baselinePosition(instrumentId: string, side = "long"): FixturePosition | undefined {
  return accountsBefore.flatMap((account) => account.positions).find((position) => position.instrumentId === instrumentId && position.side === side);
}

function baselineQuantity(instrumentId: string, side = "long"): number {
  return Number(baselinePosition(instrumentId, side)?.quantity ?? 0);
}

async function expectPositionQuantity(row: Locator, quantity: number): Promise<void> {
  if (quantity === 0) await expect(row).toHaveCount(0);
  else await expect(row.getByRole("cell").nth(2)).toHaveText(String(quantity));
}

async function post(request: APIRequestContext, base: string, body: unknown) {
  if (typeof body === "object" && body !== null && "instrumentId" in body && typeof body.instrumentId === "string") {
    touchedInstruments.add(body.instrumentId);
    if ("clientOrderId" in body) body = { ...body, clientOrderId: `${body.clientOrderId}-${attemptId}` };
  }
  const started = Date.now();
  let response = await request.post(`${base}/api/derivatives/account`, { data: body, headers: { Origin: base } });
  while (response.status() === 500 && Date.now() - started < 120_000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    response = await request.post(`${base}/api/derivatives/account`, { data: body, headers: { Origin: base } });
  }
  return response;
}
async function getOk(request: APIRequestContext, url: string) {
  const started = Date.now();
  let lastStatus = 0;
  while (Date.now() - started < 120_000) {
    const response = await request.get(url);
    if (response.ok()) return response;
    lastStatus = response.status();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("GET " + url + " never became ok, last status " + lastStatus);
}


type FixtureInstrument = { id: string; kind: string; nativeId: string; priceTick: number; venue: string; settle: string };

async function instruments(request: APIRequestContext, base: string, kind: string): Promise<FixtureInstrument[]> {
  const response = await getOk(request, `${base}/api/derivatives/markets?kind=${kind}&query=BTC`);
  const data = await response.json();
  expect(data.source).toBe("fixture");
  expect(data.instruments.length).toBeGreaterThan(0);
  return data.instruments as FixtureInstrument[];
}

async function firstInstrument(request: APIRequestContext, base: string, kind: string): Promise<FixtureInstrument> {
  return (await instruments(request, base, kind))[0]!;
}

async function seedLongPosition(request: APIRequestContext, base: string, instrument: FixtureInstrument, contracts: string, clientOrderId: string): Promise<{ bid: number; ask: number }> {
  const opened = await post(request, base, { action: "open", instrumentId: instrument.id });
  expect(opened.ok()).toBeTruthy();
  const quoteResponse = await getOk(request, `${base}/api/derivatives/market?instrumentId=${encodeURIComponent(instrument.id)}`);
  const { quote } = await quoteResponse.json();
  const filled = await post(request, base, {
    action: "order", instrumentId: instrument.id, clientOrderId, side: "buy", contracts, leverage: baselinePosition(instrument.id)?.leverage ?? 1,
    reduceOnly: false, limitPrice: String(Math.ceil(quote.ask / instrument.priceTick) * instrument.priceTick),
  });
  expect(filled.ok(), `Could not seed ${instrument.id}: ${filled.status()} ${await filled.text()}`).toBeTruthy();
  return { bid: quote.bid, ask: quote.ask };
}

test.beforeAll({ timeout: 360_000 }, async ({ request, baseURL }) => {
  for (const path of ["/", "/derivatives"]) {
    const response = await request.get(`${baseURL}${path}`);
    expect(response.status(), `Compile entry route ${path}`).toBeLessThan(500);
    await response.dispose();
  }
});

test.beforeEach(async ({ request, baseURL }) => {
  attemptId = randomUUID();
  touchedInstruments.clear();
  // Shared Replay gates also apply on the derivatives route.
  const workspace = await (await request.get(`${baseURL}/api/workspace`)).json();
  const response = await request.put(`${baseURL}/api/workspace`, { data: { ...workspace.state, activeWorkspace: "terminal" }, headers: { Origin: baseURL! } });
  expect(response.ok()).toBeTruthy();
  accountsBefore = (await (await getOk(request, `${baseURL}/api/derivatives/accounts`)).json()).accounts;
});

test.afterEach(async ({ request, baseURL }) => {
  // Return only this attempt's added contracts; keep pre-existing holdings and
  // their settlement accounts, fees and immutable fill history intact.
  const base = baseURL!;
  const current: FixtureAccount[] = (await (await getOk(request, `${base}/api/derivatives/accounts`)).json()).accounts;
  for (const account of current) {
    for (const position of account.positions) {
      if (!touchedInstruments.has(position.instrumentId)) continue;
      const added = Number((Number(position.quantity) - baselineQuantity(position.instrumentId, position.side)).toFixed(8));
      if (added <= 0) continue;
      const { instrument, quote } = await (await getOk(request, `${base}/api/derivatives/market?instrumentId=${encodeURIComponent(position.instrumentId)}`)).json();
      const closed = await post(request, base, {
        action: "order", instrumentId: position.instrumentId, clientOrderId: `e2e-cleanup-${randomUUID()}`,
        side: position.side === "long" ? "sell" : "buy", contracts: String(added), leverage: position.leverage, reduceOnly: true,
        limitPrice: String(position.side === "long" ? Math.floor(quote.bid / instrument.priceTick) * instrument.priceTick : Math.ceil(quote.ask / instrument.priceTick) * instrument.priceTick),
      });
      expect(closed.ok(), await closed.text()).toBeTruthy();
      const result = await closed.json();
      expect(Number(result.account.positions.find((item: FixturePosition) => item.instrumentId === position.instrumentId && item.side === position.side)?.quantity ?? 0)).toBe(baselineQuantity(position.instrumentId, position.side));
    }
  }
});

test("ledger navigation and Close follow the selected settlement position", async ({ page, request, baseURL }) => {
  const base = baseURL!;
  const future = (await instruments(request, base, "future")).find((item) => item.venue === "deribit" && item.settle === "USDC");
  const option = (await instruments(request, base, "option")).find((item) => item.venue === "deribit" && item.settle === "USDC");
  expect(future).toBeDefined();
  expect(option).toBeDefined();
  const futureQuote = await seedLongPosition(request, base, future!, "1", "e2e-ui-deribit-future");
  const optionQuote = await seedLongPosition(request, base, option!, "0.01", "e2e-ui-deribit-option");

  await page.goto("/");
  await page.getByRole("link", { name: /Derivatives/ }).click();
  await page.waitForURL("**/derivatives", { timeout: 120000 });
  await expect(page.getByRole("heading", { name: "/ Derivatives" })).toBeVisible({ timeout: 60000 });

  const ledgerOption = page.getByRole("button", { name: `View position ${option!.id}` });
  await expect(ledgerOption).toBeVisible({ timeout: 60000 });
  await ledgerOption.click();
  const contractDetails = page.getByRole("region", { name: "Contract market data" });
  await expect(contractDetails.getByText(option!.id, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("tab", { name: "Options", exact: true })).toHaveAttribute("aria-selected", "true");

  const accountPanel = page.getByRole("region", { name: "Derivatives account" });
  const positionsTable = accountPanel.getByRole("table", { name: "Positions", exact: true });
  const futureRow = positionsTable.getByRole("row").filter({ hasText: future!.id });
  const futureView = futureRow.getByRole("button", { name: `View position ${future!.id}` });
  await expect(futureView).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const futureClose = futureRow.getByRole("button", { name: "Close", exact: true });
  const closeBounds = await futureClose.boundingBox();
  expect(closeBounds?.x).toBeGreaterThanOrEqual(0);
  expect((closeBounds?.x ?? Infinity) + (closeBounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(closeBounds?.height).toBeGreaterThanOrEqual(44);
  await futureView.scrollIntoViewIfNeeded();
  const futureViewBounds = await futureView.boundingBox();
  expect(futureViewBounds?.height).toBeGreaterThanOrEqual(44);
  await futureView.click();
  await expect(contractDetails.getByText(future!.id, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("tab", { name: "Futures", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 1440, height: 1200 });
  await expect(contractDetails.getByText(future!.id, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("tab", { name: "Futures", exact: true })).toHaveAttribute("aria-selected", "true");
  await futureRow.getByRole("button", { name: "Close", exact: true }).click();
  await expect(contractDetails.getByText(future!.id, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("tab", { name: "Futures", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Order action" })).toHaveValue("close");
  await expect(page.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue(String(baselineQuantity(future!.id) + 1));
  await page.getByRole("textbox", { name: "Quantity in contracts" }).fill("1");
  await expect(page.getByRole("textbox", { name: "Price protection" })).toHaveValue(String(futureQuote.bid));
  const submit = page.getByRole("button", { name: "Submit Paper order", exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Paper order filled.", { exact: true })).toBeVisible({ timeout: 60000 });
  await expectPositionQuantity(futureRow, baselineQuantity(future!.id));

  const optionRow = positionsTable.getByRole("row").filter({ hasText: option!.id });
  await optionRow.getByRole("button", { name: "Close", exact: true }).click();
  await expect(contractDetails.getByText(option!.id, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("tab", { name: "Options", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Order action" })).toHaveValue("close");
  await expect(page.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue(String(Number((baselineQuantity(option!.id) + 0.01).toFixed(8))));
  await page.getByRole("textbox", { name: "Quantity in contracts" }).fill("0.01");
  await expect(page.getByRole("textbox", { name: "Price protection" })).toHaveValue(String(optionQuote.bid));
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Paper order filled.", { exact: true })).toBeVisible({ timeout: 60000 });
  await expectPositionQuantity(optionRow, baselineQuantity(option!.id));
});

test("search keeps Paper actions paused until delayed contract results reconcile", async ({ page, request, baseURL }) => {
  const base = baseURL!;
  const future = (await instruments(request, base, "future")).find((item) => item.venue === "deribit" && item.settle === "USDC");
  expect(future).toBeDefined();
  const quote = await seedLongPosition(request, base, future!, "1", "e2e-ui-search-pending");
  const intercepted = new Set<string>();
  const releases = new Map<string, () => void>();
  await page.route("**/api/derivatives/markets?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query") ?? "";
    if (query === "261225" || query === "no-such-contract") {
      intercepted.add(query);
      const deferred = Promise.withResolvers<void>();
      releases.set(query, deferred.resolve);
      await deferred.promise;
    }
    await route.continue();
  });
  let orderPosts = 0;
  let marketPolls = 0;
  page.on("request", (requestEvent) => {
    if (requestEvent.method() === "POST" && new URL(requestEvent.url()).pathname === "/api/derivatives/account") orderPosts += 1;
    if (requestEvent.method() === "GET" && new URL(requestEvent.url()).pathname === "/api/derivatives/market") marketPolls += 1;
  });

  try {
    await page.goto("/");
    await page.getByRole("link", { name: /Derivatives/ }).click();
    await page.waitForURL("**/derivatives", { timeout: 120000 });
    const position = page.getByRole("button", { name: `View position ${future!.id}` });
    await expect(position).toBeVisible({ timeout: 60000 });
    await position.click();
    const contractDetails = page.getByRole("region", { name: "Contract market data" });
    await expect(contractDetails.getByText(future!.id, { exact: true })).toBeVisible({ timeout: 60000 });
    await page.getByRole("textbox", { name: "Quantity in contracts" }).fill("1");
    await page.getByRole("textbox", { name: "Price protection" }).fill(String(Math.floor(quote.bid / future!.priceTick) * future!.priceTick));
    const submit = page.getByRole("button", { name: "Submit Paper order", exact: true });
    await expect(submit).toBeEnabled({ timeout: 60000 });

    const search = page.getByRole("textbox", { name: "Search derivatives" });
    await search.fill("261225");
    const ticket = page.getByRole("region", { name: "Derivatives Paper ticket" });
    await expect(ticket.getByText("Contract search pending. Paper actions are paused until the filtered contracts load.")).toBeVisible();
    await expect(contractDetails).not.toContainText(future!.id);
    await expect(submit).toHaveCount(0);
    await expect.poll(() => intercepted.has("261225")).toBe(true);
    expect(orderPosts).toBe(0);
    const pollsWhilePending = marketPolls;
    // The old selection polled every five seconds; a pending search must hold it.
    await page.waitForTimeout(5_500);
    expect(marketPolls).toBe(pollsWhilePending);
    releases.get("261225")?.();
    await expect(contractDetails).toContainText("okx:future:BTC-USDT-261225");
    await expect(page.getByRole("region", { name: "Contract browser" }).getByRole("button", { name: /BTC-USDT-261225/ })).toHaveAttribute("aria-current", "true");

    await search.fill("no-such-contract");
    await expect(ticket.getByText("Contract search pending. Paper actions are paused until the filtered contracts load.")).toBeVisible();
    await expect.poll(() => intercepted.has("no-such-contract")).toBe(true);
    await expect(submit).toHaveCount(0);
    expect(orderPosts).toBe(0);
    releases.get("no-such-contract")?.();
    await expect(page.getByText("No matching contracts.")).toBeVisible();
    await expect(page.locator('[aria-current="true"]')).toHaveCount(0);
    expect(orderPosts).toBe(0);
    await search.clear();
    await expect(contractDetails).toContainText(future!.id);
    await expect(page.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Order action" })).toHaveValue("open");
    await expect(page.getByRole("textbox", { name: "Price protection" })).toHaveValue(String(quote.ask));
    await expect(submit).toBeDisabled();
  } finally {
    for (const release of releases.values()) release();
  }
});

test("native derivative identities, explicit capital and atomic contract/option Paper fills", async ({ request, baseURL }) => {
  const base = baseURL!;
  const perpetual = await firstInstrument(request, base, "perpetual");
  const future = await firstInstrument(request, base, "future");
  const option = await firstInstrument(request, base, "option");
  expect(new Set([perpetual.id, future.id, option.id]).size).toBe(3);
  expect(perpetual.id).toContain(":perpetual:");
  expect(future.id).toContain(":future:");
  expect(option.id).toContain(":option:");

  const read = await getOk(request, `${base}/api/derivatives/account?instrumentId=${encodeURIComponent(perpetual.id)}`);
  const prior = (await read.json()).account as FixtureAccount | null;
  expect(prior).toEqual(accountsBefore.find((account) => account.id === `derivatives:${perpetual.venue}:${perpetual.settle}`) ?? null);
  const opened = await post(request, base, { action: "open", instrumentId: perpetual.id });
  expect(opened.ok()).toBeTruthy();
  const initial = (await opened.json()).account;
  if (prior) expect(initial).toEqual(prior);
  else {
    expect(Number(initial.initialBalance)).toBe(10000);
    expect(Number(initial.available)).toBe(10000);
    expect(initial.orderCount).toBe(0);
  }
  expect((await (await post(request, base, { action: "open", instrumentId: perpetual.id })).json()).account).toEqual(initial);

  const quoteResponse = await getOk(request, `${base}/api/derivatives/market?instrumentId=${encodeURIComponent(perpetual.id)}`);
  expect(quoteResponse.ok()).toBeTruthy();
  const { quote } = await quoteResponse.json();
  const shortIntent = { action: "order", instrumentId: perpetual.id, clientOrderId: "e2e-perpetual-short", side: "sell", contracts: "0.1", leverage: baselinePosition(perpetual.id, "short")?.leverage ?? 5, reduceOnly: false, limitPrice: String(quote.bid) };
  const short = await post(request, base, shortIntent);
  expect(short.ok()).toBeTruthy();
  const firstFill = await short.json();
  expect(firstFill.order.side).toBe("short");
  expect(Number(firstFill.account.positions.find((position: FixturePosition) => position.instrumentId === perpetual.id && position.side === "short")?.quantity)).toBeCloseTo(baselineQuantity(perpetual.id, "short") + 0.1, 8);
  expect(firstFill.account.orderCount).toBe(initial.orderCount + 1);
  const retried = await (await post(request, base, shortIntent)).json();
  expect(retried.deduplicated).toBe(true);
  expect(retried.account.available).toBe(firstFill.account.available);
  expect(retried.account.orderCount).toBe(initial.orderCount + 1);
  expect(retried.account.positions).toEqual(firstFill.account.positions);
  expect((await post(request, base, { ...shortIntent, contracts: "0.2" })).status()).toBe(422);
  const closed = await post(request, base, { ...shortIntent, clientOrderId: "e2e-perpetual-cover", side: "buy", reduceOnly: true, limitPrice: String(quote.ask) });
  expect(closed.ok()).toBeTruthy();
  const covered = await closed.json();
  expect(Number(covered.account.positions.find((position: FixturePosition) => position.instrumentId === perpetual.id && position.side === "short")?.quantity ?? 0)).toBe(baselineQuantity(perpetual.id, "short"));
  expect(covered.account.positions.filter((position: FixturePosition) => position.instrumentId !== perpetual.id || position.side !== "short")).toEqual(initial.positions.filter((position: FixturePosition) => position.instrumentId !== perpetual.id || position.side !== "short"));
  expect(covered.account.orderCount).toBe(initial.orderCount + 2);
  expect(Number(covered.account.feesPaid) - Number(initial.feesPaid)).toBeCloseTo(Number(firstFill.order.fee) + Number(covered.order.fee), 8);
  expect(Number(covered.account.available) - Number(initial.available)).toBeCloseTo(Number(covered.order.realizedPnl) - Number(firstFill.order.fee) - Number(covered.order.fee), 8);

  const optionOpen = await post(request, base, { action: "open", instrumentId: option.id });
  expect(optionOpen.ok()).toBeTruthy();
  const optionInitial = (await optionOpen.json()).account;
  const optionQuote = (await (await getOk(request, `${base}/api/derivatives/market?instrumentId=${encodeURIComponent(option.id)}`)).json()).quote;
  const optionIntent = { action: "order", instrumentId: option.id, clientOrderId: "e2e-option-long", side: "buy", contracts: "0.01", leverage: 1, reduceOnly: false, limitPrice: String(optionQuote.ask) };
  const naked = await post(request, base, { ...optionIntent, clientOrderId: "e2e-option-naked", side: "sell", contracts: String(Number((baselineQuantity(option.id) + 0.01).toFixed(8))), limitPrice: String(optionQuote.bid) });
  expect(naked.status()).toBe(422);
  const nakedResult = await naked.json();
  expect(nakedResult.error).toContain("naked selling is prohibited");
  expect(nakedResult.account).toEqual(optionInitial);
  const optionFill = await post(request, base, optionIntent);
  expect(optionFill.ok()).toBeTruthy();
  const held = await optionFill.json();
  expect(held.account.settle).toBe(option.settle);
  expect(held.order.side).toBe("long");
  expect(held.order.leverage).toBe(1);
  expect(Number(held.account.positions.find((position: FixturePosition) => position.instrumentId === option.id && position.side === "long")?.quantity)).toBeCloseTo(baselineQuantity(option.id) + 0.01, 8);
  expect(held.account.orderCount).toBe(optionInitial.orderCount + 1);
  const optionClose = await post(request, base, { ...optionIntent, clientOrderId: "e2e-option-close", side: "sell", limitPrice: String(optionQuote.bid) });
  expect(optionClose.ok()).toBeTruthy();
  expect(Number((await optionClose.json()).account.positions.find((position: FixturePosition) => position.instrumentId === option.id && position.side === "long")?.quantity ?? 0)).toBe(baselineQuantity(option.id));
});

test("derivatives navigation, venue coverage labels and narrow layout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Derivatives/ }).click();
  await page.waitForURL("**/derivatives", { timeout: 120000 });
  await expect(page.getByRole("heading", { name: "/ Derivatives" })).toBeVisible({ timeout: 60000 });
  const browser = page.getByRole("region", { name: "Contract browser" });
  await expect(browser.getByRole("button", { name: /BTC-USDT-SWAP/ })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search derivatives" });
  await search.fill("no-matching-contract");
  await expect(page.getByText("No matching contracts.")).toBeVisible();
  await expect(page.locator('[aria-current="true"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Contract market data" })).not.toContainText("okx:perpetual:BTC-USDT-SWAP");
  await search.fill("");
  await expect(browser.getByRole("button", { name: /BTC-USDT-SWAP/ })).toBeVisible();
  const perpetualTab = page.getByRole("tab", { name: "Perpetuals", exact: true });
  const futureTab = page.getByRole("tab", { name: "Futures", exact: true });
  const optionTab = page.getByRole("tab", { name: "Options", exact: true });
  await perpetualTab.focus();
  for (const [key, selected] of [["End", optionTab], ["ArrowRight", perpetualTab], ["ArrowLeft", optionTab], ["Home", perpetualTab], ["ArrowRight", futureTab]] as const) {
    await page.keyboard.press(key);
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab").and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  }
  await expect(page.getByText("Deribit + OKX · Linear contracts", { exact: true })).toBeVisible();
  const deribitFuture = browser.getByRole("button", { name: /BTC_USDC-25DEC26/ });
  await expect(deribitFuture).toBeVisible();
  await deribitFuture.click();
  await expect(page.getByRole("region", { name: "Contract market data" })).toContainText("deribit:future:BTC_USDC-25DEC26");
  await search.fill("261225");
  const filteredFuture = browser.getByRole("button", { name: /BTC-USDT-261225/ });
  await expect(filteredFuture).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("region", { name: "Contract market data" })).toContainText("okx:future:BTC-USDT-261225");
  await search.fill("");
  await expect(browser.getByRole("button", { name: /BTC-USDT-261225/ })).toBeVisible();
  await page.getByRole("tab", { name: "Options", exact: true }).click();
  await expect(page.getByText("Deribit · Long options only", { exact: true })).toBeVisible();
  await expect(browser.getByRole("button", { name: /^80,000 C/ })).toBeVisible();
  await page.setViewportSize({ width: 419, height: 900 });
  await expect(page.getByRole("heading", { name: "/ Derivatives" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

/* Navigation is a shell contract, not a trading one. While Replay owns the
   terminal the derivatives page pauses live markets behind a banner; the
   workspace digits must still leave the page, because that banner's own nav
   advertises them. A guard placed above the navigation branch re-breaks this. */
test("workspace digits leave Derivatives even while Replay pauses it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Derivatives market mode/ }).first().click();
  await page.waitForURL("**/derivatives", { timeout: 120_000 });
  /* The page polls the shared workspace boundary, so answering that one read is
     enough to put it in the paused state the banner describes. */
  await page.route("**/api/workspace", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: { state: { activeWorkspace: "replay" }, updatedAt: 0 } })
    : route.continue());
  await expect(page.locator(".derivatives-banner")).toBeVisible({ timeout: 60_000 });
  await page.unroute("**/api/workspace");
  await page.keyboard.press("1");
  await page.waitForURL("**/w/markets", { timeout: 60_000 });
});

test("Paper tickets open and close both sides and options without stale price repair", async ({ page, request, baseURL }) => {
  const base = baseURL!;
  const perpetual = await firstInstrument(request, base, "perpetual");
  const future = (await instruments(request, base, "future")).find((item) => item.venue === "deribit")!;
  const option = await firstInstrument(request, base, "option");
  for (const instrument of [perpetual, future, option]) expect((await post(request, base, { action: "open", instrumentId: instrument.id })).ok()).toBeTruthy();
  await page.goto("/derivatives");
  const ticket = page.getByRole("region", { name: "Derivatives Paper ticket" });
  const account = page.getByRole("region", { name: "Derivatives account" });
  const submit = ticket.getByRole("button", { name: "Submit Paper order", exact: true });
  const protection = ticket.getByRole("textbox", { name: "Price protection" });
  for (const { instrument, side, contracts, tab } of [
    { instrument: perpetual, side: "long", contracts: "0.01", tab: "Perpetuals" },
    { instrument: perpetual, side: "short", contracts: "0.01", tab: "Perpetuals" },
    { instrument: future, side: "long", contracts: "7", tab: "Futures" },
    { instrument: option, side: "long", contracts: "0.01", tab: "Options" },
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    if (instrument.kind !== "option") await page.getByRole("region", { name: "Contract browser" }).getByRole("button", { name: new RegExp(instrument.nativeId) }).click();
    await expect(page.getByRole("region", { name: "Contract market data" })).toContainText(instrument.id);
    await ticket.getByRole("combobox", { name: "Order action" }).selectOption("open");
    await ticket.getByRole("combobox", { name: "Position side" }).selectOption(side);
    await ticket.getByRole("combobox", { name: "Isolated leverage" }).selectOption(String(baselinePosition(instrument.id, side)?.leverage ?? 1));
    await ticket.getByRole("textbox", { name: "Quantity in contracts" }).fill(contracts);
    await ticket.getByRole("button", { name: side === "long" ? /^Ask / : /^Bid / }).click();
    const entryProtection = await protection.inputValue();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(ticket.getByText("Paper order filled.", { exact: true })).toBeVisible();
    const row = account.getByRole("table", { name: "Positions", exact: true }).getByRole("row").filter({ hasText: instrument.id }).filter({ hasText: side });
    await expectPositionQuantity(row, Number((baselineQuantity(instrument.id, side) + Number(contracts)).toFixed(8)));
    await row.getByRole("button", { name: "Close", exact: true }).click();
    await expect(ticket.getByRole("combobox", { name: "Order action" })).toHaveValue("close");
    await expect(ticket.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue(String(Number((baselineQuantity(instrument.id, side) + Number(contracts)).toFixed(8))));
    if (instrument.kind === "future") {
      const positionContracts = baselineQuantity(instrument.id, side) + Number(contracts);
      await ticket.getByRole("button", { name: "25%", exact: true }).click();
      await expect(ticket.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue(String(Math.floor(positionContracts * 0.25)));
      await ticket.getByRole("button", { name: "MAX", exact: true }).click();
      await expect(ticket.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue(String(positionContracts));
    }
    await ticket.getByRole("textbox", { name: "Quantity in contracts" }).fill(contracts);
    await expect(protection).not.toHaveValue(entryProtection);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(ticket.getByText("Paper order filled.", { exact: true })).toBeVisible();
    await expectPositionQuantity(row, baselineQuantity(instrument.id, side));
  }
  await page.getByRole("textbox", { name: "Search derivatives" }).fill("NO-SUCH-CONTRACT");
  await expect(page.getByText("No matching contracts.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search derivatives" }).clear();
  await page.getByRole("tab", { name: "Perpetuals", exact: true }).click();
  await expect(ticket.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue("");
  await expect(ticket.getByRole("combobox", { name: "Order action" })).toHaveValue("open");
  await expect(protection).toHaveValue("80001");
  await expect(submit).toBeDisabled();
  await expect(ticket.getByText("Paper order filled.", { exact: true })).toHaveCount(0);
});

test("opening MAX fits executable margin and fees while the next contract is rejected", async ({ page, request, baseURL }) => {
  const base = baseURL!;
  const instrument = (await instruments(request, base, "future")).find((item) => item.venue === "deribit")!;
  expect((await post(request, base, { action: "open", instrumentId: instrument.id })).ok()).toBeTruthy();
  await page.goto("/derivatives");
  await page.getByRole("tab", { name: "Futures", exact: true }).click();
  await page.getByRole("region", { name: "Contract browser" }).getByRole("button", { name: new RegExp(instrument.nativeId) }).click();
  const ticket = page.getByRole("region", { name: "Derivatives Paper ticket" });
  const quantity = ticket.getByRole("textbox", { name: "Quantity in contracts" });
  const submit = ticket.getByRole("button", { name: "Submit Paper order", exact: true });
  await ticket.getByRole("combobox", { name: "Isolated leverage" }).selectOption(String(baselinePosition(instrument.id)?.leverage ?? 20));
  await ticket.getByRole("button", { name: "MAX", exact: true }).click();
  const maximum = await quantity.inputValue();
  expect(Number(maximum)).toBeGreaterThan(0);
  await quantity.fill(String(Number(maximum) + 1));
  await submit.click();
  await expect(ticket.getByRole("status")).toContainText("Insufficient settle balance");
  await ticket.getByRole("button", { name: "MAX", exact: true }).click();
  await expect(quantity).toHaveValue(maximum);
  await submit.click();
  await expect(ticket.getByText("Paper order filled.", { exact: true })).toBeVisible();
});

test("invalid native inputs never submit and rejected orders keep definite feedback", async ({ page, request, baseURL }) => {
  const base = baseURL!;
  const instrument = await firstInstrument(request, base, "perpetual");
  expect((await post(request, base, { action: "open", instrumentId: instrument.id })).ok()).toBeTruthy();
  await page.goto("/derivatives");
  const ticket = page.getByRole("region", { name: "Derivatives Paper ticket" });
  const quantity = ticket.getByRole("textbox", { name: "Quantity in contracts" });
  const protection = ticket.getByRole("textbox", { name: "Price protection" });
  const submit = ticket.getByRole("button", { name: "Submit Paper order", exact: true });
  let orderPosts = 0;
  page.on("request", (event) => { if (event.method() === "POST" && new URL(event.url()).pathname === "/api/derivatives/account") orderPosts += 1; });
  await quantity.fill("0.015");
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await expect(quantity).toHaveAttribute("aria-describedby", "derivatives-quantity-error");
  await expect(ticket.getByText(/in steps of 0.01/)).toBeVisible();
  await expect(submit).toBeDisabled();
  await quantity.fill("0.01");
  await protection.fill("80000.05");
  await expect(protection).toHaveAttribute("aria-invalid", "true");
  await expect(protection).toHaveAttribute("aria-describedby", "derivatives-price-error");
  await expect(submit).toBeDisabled();
  expect(orderPosts).toBe(0);
  await ticket.getByRole("button", { name: /^Ask / }).click();
  await ticket.getByRole("combobox", { name: "Isolated leverage" }).selectOption(String(baselinePosition(instrument.id)?.leverage ?? 1));
  await quantity.fill("1000000");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(ticket.getByRole("status")).toContainText("Insufficient settle balance");
  await expect(ticket).not.toContainText("confirm the outcome");
  expect(orderPosts).toBe(1);
});

test("lost fill responses retry the same client order identity", async ({ page, request, baseURL }) => {
  const base = baseURL!;
  const instrument = await firstInstrument(request, base, "perpetual");
  expect((await post(request, base, { action: "open", instrumentId: instrument.id })).ok()).toBeTruthy();
  const intents: Array<{ clientOrderId: string }> = [];
  await page.route("**/api/derivatives/account", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    intents.push(route.request().postDataJSON());
    if (intents.length === 1) {
      const filled = await route.fetch();
      expect(filled.ok()).toBeTruthy();
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await page.goto("/derivatives");
  const ticket = page.getByRole("region", { name: "Derivatives Paper ticket" });
  const submit = ticket.getByRole("button", { name: "Submit Paper order", exact: true });
  await ticket.getByRole("combobox", { name: "Isolated leverage" }).selectOption(String(baselinePosition(instrument.id)?.leverage ?? 1));
  await ticket.getByRole("textbox", { name: "Quantity in contracts" }).fill("0.01");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(ticket).toContainText("confirm the outcome");
  await submit.click();
  await expect(ticket.getByText("Previously filled order confirmed.", { exact: true })).toBeVisible();
  expect(intents).toHaveLength(2);
  expect(intents[1]!.clientOrderId).toBe(intents[0]!.clientOrderId);
  const row = page.getByRole("region", { name: "Derivatives account" }).getByRole("table", { name: "Positions", exact: true }).getByRole("row").filter({ hasText: instrument.id }).filter({ hasText: "long" });
  await expectPositionQuantity(row, Number((baselineQuantity(instrument.id) + 0.01).toFixed(8)));
  await row.getByRole("button", { name: "Close", exact: true }).click();
  await ticket.getByRole("textbox", { name: "Quantity in contracts" }).fill("0.01");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expectPositionQuantity(row, baselineQuantity(instrument.id));
});
