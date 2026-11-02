import { expect, test, type Response } from "@playwright/test";
import { readJson } from "./replay-api.js";

test("walk-forward sweep history opens and deterministically reruns saved fixture results", async ({ page, request }) => {
  test.skip(process.env.PLAYWRIGHT_API_STUBS === "1", "This regression requires the fixture-backed real API.");

  const workspaceResponse = await request.get("/api/workspace");
  const { state } = await readJson<{ state: Record<string, unknown> }>(workspaceResponse);
  await readJson(await request.put("/api/workspace", {
    headers: { origin: new URL(workspaceResponse.url()).origin },
    data: { ...state, exchange: "binance", symbol: "BTC/USDT", timeframe: "15m", activeWorkspace: "research", activeReplayId: null, activeBacktestId: null },
  }));
  const candles = await readJson<{ source: string }>(await request.get("/api/market", { params: { exchange: "binance", symbol: "BTC/USDT", timeframe: "15m", kind: "candles", limit: "80" } }));
  expect(candles.source).toBe("Deterministic test fixture");

  await page.goto("/");
  await expect(page.locator("main.mode-layout-research")).toBeVisible();
  await page.getByRole("tab", { name: "Sweep", exact: true }).click();

  const sweepForm = page.locator(".sweep-form");
  const mode = sweepForm.locator("label").filter({ hasText: "MODE" }).locator("select");
  await expect(mode).toHaveValue("full-sample");
  await expect(mode.locator("option:checked")).toHaveText("Full sample · in-sample");

  await mode.selectOption("walk-forward");
  await sweepForm.locator("label").filter({ hasText: "SELECTION METRIC" }).locator("select").selectOption("sharpeRatio");
  await sweepForm.locator("label").filter({ hasText: "MAX TRAINING DRAWDOWN" }).locator("input").fill("1");

  const createResponsePromise = page.waitForResponse((response: Response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/sweeps",
  );
  await page.getByTestId("run-sweep").click();
  const createResponse = await createResponsePromise;
  const original = await readJson<{
    sweepId: string;
    mode: string;
    values: number[];
    walkForward: {
      selectionMetric?: string;
      selectionConstraints?: { maxTrainingDrawdown: number };
      folds: Array<{ candidateValue: number; trainingMetrics: Record<string, unknown>; validationMetrics: Record<string, unknown> }>;
      finalCandidateValue: number;
      finalTrainingMetrics: Record<string, unknown>;
      finalTestMetrics: Record<string, unknown>;
    };
  }>(createResponse, 201);
  expect(original.mode).toBe("walk-forward");
  expect(original.walkForward.selectionMetric).toBe("sharpeRatio");
  expect(original.walkForward.selectionConstraints).toEqual({ maxTrainingDrawdown: 1 });
  expect(original.walkForward.folds.length).toBe(3);

  const foldDetails = page.locator(".sweep-panel details");
  await foldDetails.first().locator("summary").click();
  await expect(page.getByRole("columnheader", { name: "TRAIN CANDIDATE" }).first()).toBeVisible();
  await expect(page.getByText(/Fold 1 · train \[0,/)).toBeVisible();
  const finalFit = foldDetails.last();
  await finalFit.locator("summary").click();
  await expect(finalFit.getByText("FINAL TRAIN CANDIDATE")).toBeVisible();
  await expect(page.getByText(/Final test \[/)).toBeVisible();

  const initialHistory = await readJson<{ items: Array<{ sweepId: string }> }>(await request.get("/api/sweeps?limit=20"));
  expect(initialHistory.items.some((item) => item.sweepId === original.sweepId)).toBe(true);
  const savedButton = page.getByRole("button", { name: `Open saved sweep ${original.sweepId}`, exact: true });
  await savedButton.click();
  const detailResponse = await page.waitForResponse((response: Response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname === `/api/sweeps/${original.sweepId}`,
  );
  const detail = await readJson<typeof original>(detailResponse);
  expect(detail.walkForward.selectionMetric).toBe("sharpeRatio");
  expect(detail.walkForward.selectionConstraints).toEqual({ maxTrainingDrawdown: 1 });
  expect(detail.walkForward.finalCandidateValue).toBe(original.walkForward.finalCandidateValue);
  expect(detail.walkForward.folds.map((fold) => ({ candidateValue: fold.candidateValue, trainingMetrics: fold.trainingMetrics, validationMetrics: fold.validationMetrics })))
    .toEqual(original.walkForward.folds.map((fold) => ({ candidateValue: fold.candidateValue, trainingMetrics: fold.trainingMetrics, validationMetrics: fold.validationMetrics })));
  expect(detail.walkForward.finalTrainingMetrics).toEqual(original.walkForward.finalTrainingMetrics);
  expect(detail.walkForward.finalTestMetrics).toEqual(original.walkForward.finalTestMetrics);

  const rerunResponsePromise = page.waitForResponse((response: Response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === `/api/sweeps/${original.sweepId}/rerun`,
  );
  await page.getByRole("button", { name: "Deterministic rerun", exact: true }).click();
  const rerun = await readJson<{
    sweepId: string;
    rerunOf?: string;
    walkForward: typeof original.walkForward;
  }>(await rerunResponsePromise, 201);
  expect(rerun.rerunOf).toBe(original.sweepId);
  expect(rerun.walkForward.selectionMetric).toBe("sharpeRatio");
  expect(rerun.walkForward.selectionConstraints).toEqual({ maxTrainingDrawdown: 1 });
  expect(rerun.walkForward.finalCandidateValue).toBe(original.walkForward.finalCandidateValue);
  expect(rerun.walkForward.folds.map((fold) => ({ candidateValue: fold.candidateValue, trainingMetrics: fold.trainingMetrics, validationMetrics: fold.validationMetrics })))
    .toEqual(original.walkForward.folds.map((fold) => ({ candidateValue: fold.candidateValue, trainingMetrics: fold.trainingMetrics, validationMetrics: fold.validationMetrics })));
  expect(rerun.walkForward.finalTrainingMetrics).toEqual(original.walkForward.finalTrainingMetrics);
  expect(rerun.walkForward.finalTestMetrics).toEqual(original.walkForward.finalTestMetrics);
  await expect(page.getByText(/Final test \[/)).toBeVisible();

  const historyAfterRerun = await readJson<{ items: Array<{ sweepId: string }> }>(await request.get("/api/sweeps?limit=20"));
  expect(historyAfterRerun.items.some((item) => item.sweepId === rerun.sweepId)).toBe(true);
});
