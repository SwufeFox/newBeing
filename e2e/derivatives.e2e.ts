import { expect, test, type APIRequestContext } from "@playwright/test";

async function post(request: APIRequestContext, base: string, body: unknown) {
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
    action: "order", instrumentId: instrument.id, clientOrderId, side: "buy", contracts, leverage: 1,
    reduceOnly: false, limitPrice: String(Math.ceil(quote.ask / instrument.priceTick) * instrument.priceTick),
  });
  expect(filled.ok(), `Could not seed ${instrument.id}: ${filled.status()} ${await filled.text()}`).toBeTruthy();
  return { bid: quote.bid, ask: quote.ask };
}

test.beforeEach(async ({ request, baseURL }) => {
  // Shared Replay gates also apply on the derivatives route.
  const workspace = await (await request.get(`${baseURL}/api/workspace`)).json();
  const response = await request.put(`${baseURL}/api/workspace`, { data: { ...workspace.state, activeWorkspace: "terminal" }, headers: { Origin: baseURL! } });
  expect(response.ok()).toBeTruthy();
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
  const positionsTable = accountPanel.getByRole("table").first();
  const futureRow = positionsTable.getByRole("row").filter({ hasText: future!.id });
  await futureRow.getByRole("button", { name: "Close", exact: true }).click();
  await expect(contractDetails.getByText(future!.id, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("tab", { name: "Futures", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Order action" })).toHaveValue("close");
  await expect(page.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue("1");
  await page.getByRole("textbox", { name: "Price protection" }).fill(String(Math.floor(futureQuote.bid / future!.priceTick) * future!.priceTick));
  const submit = page.getByRole("button", { name: "Submit Paper order", exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Paper order filled.", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(futureRow).toHaveCount(0);

  const optionRow = positionsTable.getByRole("row").filter({ hasText: option!.id });
  await optionRow.getByRole("button", { name: "Close", exact: true }).click();
  await expect(contractDetails.getByText(option!.id, { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("tab", { name: "Options", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Order action" })).toHaveValue("close");
  await expect(page.getByRole("textbox", { name: "Quantity in contracts" })).toHaveValue("0.01");
  await page.getByRole("textbox", { name: "Price protection" }).fill(String(Math.floor(optionQuote.bid / option!.priceTick) * option!.priceTick));
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Paper order filled.", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(accountPanel.getByText("No open positions.", { exact: true })).toBeVisible();
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

  const read = await request.get(`${base}/api/derivatives/account?instrumentId=${encodeURIComponent(perpetual.id)}`);
  expect((await read.json()).account).toBeNull();
  const opened = await post(request, base, { action: "open", instrumentId: perpetual.id });
  expect(opened.ok()).toBeTruthy();
  const initial = (await opened.json()).account;
  expect(Number(initial.available)).toBe(10000);
  expect(Number((await (await post(request, base, { action: "open", instrumentId: perpetual.id })).json()).account.available)).toBe(10000);

  const quoteResponse = await getOk(request, `${base}/api/derivatives/market?instrumentId=${encodeURIComponent(perpetual.id)}`);
  expect(quoteResponse.ok()).toBeTruthy();
  const { quote } = await quoteResponse.json();
  const shortIntent = { action: "order", instrumentId: perpetual.id, clientOrderId: "e2e-perpetual-short", side: "sell", contracts: "0.1", leverage: 5, reduceOnly: false, limitPrice: String(quote.bid) };
  const short = await post(request, base, shortIntent);
  expect(short.ok()).toBeTruthy();
  const firstFill = await short.json();
  expect(firstFill.order.side).toBe("short");
  expect(firstFill.account.positions).toHaveLength(1);
  const retried = await (await post(request, base, shortIntent)).json();
  expect(retried.deduplicated).toBe(true);
  expect(retried.account.available).toBe(firstFill.account.available);
  expect(retried.account.orders).toHaveLength(1);
  expect((await post(request, base, { ...shortIntent, contracts: "0.2" })).status()).toBe(422);
  const closed = await post(request, base, { ...shortIntent, clientOrderId: "e2e-perpetual-cover", side: "buy", reduceOnly: true, limitPrice: String(quote.ask) });
  expect(closed.ok()).toBeTruthy();
  const covered = await closed.json();
  expect(covered.account.positions).toHaveLength(0);
  expect(Number(covered.account.available)).toBeLessThan(10000);

  const optionOpen = await post(request, base, { action: "open", instrumentId: option.id });
  expect(optionOpen.ok()).toBeTruthy();
  const optionQuote = (await (await getOk(request, `${base}/api/derivatives/market?instrumentId=${encodeURIComponent(option.id)}`)).json()).quote;
  const optionIntent = { action: "order", instrumentId: option.id, clientOrderId: "e2e-option-long", side: "buy", contracts: "0.01", leverage: 1, reduceOnly: false, limitPrice: String(optionQuote.ask) };
  expect((await post(request, base, { ...optionIntent, clientOrderId: "e2e-option-naked", side: "sell", limitPrice: String(optionQuote.bid) })).status()).toBe(422);
  const optionFill = await post(request, base, optionIntent);
  expect(optionFill.ok()).toBeTruthy();
  const held = await optionFill.json();
  expect(held.account.settle).toBe(option.settle);
  expect(held.order.side).toBe("long");
  expect(held.order.leverage).toBe(1);
  const optionClose = await post(request, base, { ...optionIntent, clientOrderId: "e2e-option-close", side: "sell", limitPrice: String(optionQuote.bid) });
  expect(optionClose.ok()).toBeTruthy();
  expect((await optionClose.json()).account.positions).toHaveLength(0);
});

test("derivatives navigation, product selection and narrow layout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Derivatives/ }).click();
  await page.waitForURL("**/derivatives", { timeout: 120000 });
  await expect(page.getByRole("heading", { name: "/ Derivatives" })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: /BTC-USDT-SWAP/ })).toBeVisible();
  await page.getByRole("tab", { name: "Options", exact: true }).click();
  await expect(page.getByText(/BTC_USDC-25DEC26-80000-C/, { exact: false }).first()).toBeVisible();
  await page.setViewportSize({ width: 419, height: 900 });
  await expect(page.getByRole("heading", { name: "/ Derivatives" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
