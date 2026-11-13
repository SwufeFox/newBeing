import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { BacktestResult, StrategyParameters } from "@newbeing/core";
import { readJson, setTrainingWorkspace, VIEW } from "./replay-api.js";

async function openResearch(page: Page, request: APIRequestContext): Promise<void> {
  await setTrainingWorkspace(request);
  const response = await request.get("/api/workspace");
  const { state } = await readJson<{ state: Record<string, unknown> }>(response);
  await readJson(await request.put("/api/workspace", {
    headers: { origin: new URL(response.url()).origin },
    data: { ...state, activeWorkspace: "research", activeReplayId: null, activeBacktestId: null },
  }));
  await page.goto(VIEW.research);
  await page.getByRole("tab", { name: "Strategy lab", exact: true }).click();
}

test.beforeEach(() => {
  test.skip(process.env.PLAYWRIGHT_API_STUBS === "1", "These regressions require saved fixture-backed research results.");
});

test("replacing numeric research inputs saves the entered capital and costs", async ({ page, request }) => {
  await openResearch(page, request);
  const lab = page.locator(".strategy-lab");
  const capital = lab.getByLabel("INITIAL CAPITAL", { exact: true });
  await capital.focus();
  await capital.press("ControlOrMeta+A");
  await capital.press("Backspace");
  await expect(capital).toHaveValue("");
  await capital.pressSequentially("12000");
  await capital.press("Tab");
  await expect(capital).toHaveValue("12000");
  await lab.getByLabel("POSITION %", { exact: true }).fill("60");
  await lab.getByLabel("FEE (BPS)", { exact: true }).fill("12");
  await lab.getByLabel("SLIPPAGE (BPS)", { exact: true }).fill("7");
  const created = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/backtests" && response.request().method() === "POST",
  );
  await lab.getByRole("button", { name: "Run backtest", exact: true }).click();
  const result = await (await created).json() as BacktestResult;
  expect(result.assumptions).toMatchObject({ initialCapital: 12000, positionFraction: 0.6, feeRate: 0.0012, slippageRate: 0.0007 });
  const stored = await readJson<BacktestResult>(await request.get(`/api/backtests/${result.resultId}`));
  expect(stored.assumptions).toEqual(result.assumptions);
});

test("saved sweep applies its full candidate and fresh evaluation applies without reopening history", async ({ page, request }) => {
  await openResearch(page, request);
  const lab = page.locator(".strategy-lab");
  await lab.locator("#strategy-parameter-fastPeriod").fill("8");
  await lab.locator("#strategy-parameter-slowPeriod").fill("21");
  await lab.getByLabel("INITIAL CAPITAL", { exact: true }).fill("12000");
  await lab.getByLabel("POSITION %", { exact: true }).fill("60");
  await page.getByRole("tab", { name: "Sweep", exact: true }).click();
  const sweepForm = page.locator(".sweep-form");
  await sweepForm.getByLabel("FROM", { exact: true }).fill("6");
  await sweepForm.getByLabel("TO", { exact: true }).fill("10");
  await sweepForm.getByLabel("STEP", { exact: true }).fill("2");
  const created = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/sweeps" && response.request().method() === "POST",
  );
  await page.getByTestId("run-sweep").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const sweep = await response.json() as { sweepId: string; datasetId: string; parameters: StrategyParameters; config: BacktestResult["assumptions"] };
  await lab.locator("#strategy-select").selectOption("rsi-mean-reversion");
  await lab.locator("#strategy-select").selectOption("sma-crossover");
  await lab.getByLabel("INITIAL CAPITAL", { exact: true }).fill("20000");
  await lab.getByLabel("POSITION %", { exact: true }).fill("25");
  await page.getByRole("button", { name: `Open saved sweep ${sweep.sweepId}`, exact: true }).click();
  await page.locator(".sweep-panel").getByRole("button", { name: "Apply", exact: true }).first().click();
  await expect(lab.locator("#strategy-parameter-fastPeriod")).toHaveValue("6");
  await expect(lab.locator("#strategy-parameter-slowPeriod")).toHaveValue(String(sweep.parameters.slowPeriod));
  await expect(lab.getByLabel("INITIAL CAPITAL", { exact: true })).toHaveValue(String(sweep.config.initialCapital));
  await expect(lab.getByLabel("POSITION %", { exact: true })).toHaveValue(String(sweep.config.positionFraction * 100));

  await page.getByRole("tab", { name: "Evaluate", exact: true }).click();
  const evaluation = page.locator(".evaluation-panel");
  await evaluation.getByLabel("Evaluation dataset id", { exact: true }).fill(sweep.datasetId);
  const form = evaluation.locator(".evaluation-form");
  await form.getByLabel("FROM", { exact: true }).fill("6");
  await form.getByLabel("TO", { exact: true }).fill("10");
  await form.getByLabel("STEP", { exact: true }).fill("2");
  const evaluated = page.waitForResponse((entry) =>
    new URL(entry.url()).pathname === "/api/evaluations" && entry.request().method() === "POST",
  );
  await evaluation.getByRole("button", { name: "Run evaluation", exact: true }).click();
  const reportResponse = await evaluated;
  expect(reportResponse.status()).toBe(201);
  const report = await reportResponse.json() as { strategyId: string; selectedParameters: StrategyParameters };
  expect(report.strategyId).toBe("sma-crossover");
  const apply = evaluation.getByRole("button", { name: "Apply to strategy", exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(lab.locator("#strategy-parameter-fastPeriod")).toHaveValue(String(report.selectedParameters.fastPeriod));
  await expect(lab.locator("#strategy-parameter-slowPeriod")).toHaveValue(String(report.selectedParameters.slowPeriod));
});
