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

async function firstInstrument(request: APIRequestContext, base: string, kind: string) {
  const response = await getOk(request, `${base}/api/derivatives/markets?kind=${kind}&query=BTC`);
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.source).toBe("fixture");
  expect(data.instruments.length).toBeGreaterThan(0);
  return data.instruments[0] as { id: string; kind: string; venue: string; settle: string };
}

test.beforeEach(async ({ request, baseURL }) => {
  // Shared Replay gates also apply on the derivatives route.
  const workspace = await (await request.get(`${baseURL}/api/workspace`)).json();
  const response = await request.put(`${baseURL}/api/workspace`, { data: { ...workspace.state, activeWorkspace: "terminal" }, headers: { Origin: baseURL! } });
  expect(response.ok()).toBeTruthy();
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
