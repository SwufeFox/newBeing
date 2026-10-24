import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getWorkspaceState } from "@newbeing/storage";
import { getDerivativesAccount } from "@newbeing/application/derivatives";
import { DERIVATIVES_POLICY } from "@newbeing/application/derivatives-types";
import { getDerivativeInstrument, getDerivativeQuote, listDerivativeInstruments } from "@newbeing/market-data/derivatives";

function guardReplay(): void {
  if (getWorkspaceState().state.activeWorkspace === "replay") throw new Error("Live derivatives and normal Paper portfolios are hidden during frozen Replay.");
}
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { result: value } };
}
function failure(error: unknown) {
  return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Derivatives read failed." }], isError: true as const };
}

/** Read-only extension: neither account opening nor any order command is registered. */
export function registerDerivativesTools(server: McpServer): void {
  server.registerTool("list_derivative_instruments", {
    title: "List public derivatives",
    description: "Discover OKX linear perpetual/futures or Deribit options using native product IDs. Returns contract size, expiry, settlement currency, strike and right where applicable.",
    inputSchema: z.object({ kind: z.enum(["perpetual", "future", "option"]), query: z.string().max(80).default("") }),
    annotations: { readOnlyHint: true },
  }, async ({ kind, query }) => {
    try {
      guardReplay();
      const instruments = await listDerivativeInstruments(kind, query);
      guardReplay();
      return result({ instruments, note: "Quantities are contracts. Instrument prices and option premiums use the specified settlement units." });
    } catch (error) { return failure(error); }
  });

  server.registerTool("get_derivative_market", {
    title: "Read a derivative market",
    description: "Read native derivative metadata and current bid/ask/mark, plus available funding, IV and delta. A mark is not an execution quote. Never available during frozen Replay.",
    inputSchema: z.object({ instrument_id: z.string().min(8).max(240).regex(/^(okx|deribit):(perpetual|future|option):[^\s]+$/) }),
    annotations: { readOnlyHint: true },
  }, async ({ instrument_id }) => {
    try {
      guardReplay();
      const instrument = await getDerivativeInstrument(instrument_id);
      const quote = await getDerivativeQuote(instrument.id);
      guardReplay();
      return result({ instrument, quote, policy: DERIVATIVES_POLICY });
    } catch (error) { return failure(error); }
  });

  server.registerTool("get_derivative_portfolio", {
    title: "Read local derivatives Paper portfolio",
    description: "Read the independent derivatives Paper ledger for one venue and settlement currency. Does not open or fund an account, prepare an order, or submit any trade.",
    inputSchema: z.object({ venue: z.enum(["okx", "deribit"]), settle: z.string().regex(/^[A-Z0-9]{1,20}$/) }),
    annotations: { readOnlyHint: true },
  }, async ({ venue, settle }) => {
    try {
      guardReplay();
      return result({ account: getDerivativesAccount(venue, settle) ?? null, policy: DERIVATIVES_POLICY, execution: "Paper commands are available only in the trusted workstation UI." });
    } catch (error) { return failure(error); }
  });
}
