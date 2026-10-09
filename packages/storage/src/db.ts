import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type NewBeingDatabase = BetterSQLite3Database<typeof schema>;

function projectRoot(): string {
  const configured = process.env.NEWBEING_DATA_DIR;
  if (configured) return path.resolve(configured);
  let current = process.cwd();
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return path.join(current, ".newbeing");
    const parent = path.dirname(current);
    if (parent === current) return path.join(process.cwd(), ".newbeing");
    current = parent;
  }
}

const globalKey = "__newbeing_sqlite_v1__";
type DbGlobal = typeof globalThis & { [globalKey]?: { sqlite: Database.Database; drizzle: NewBeingDatabase } };

export function getDatabase(): NewBeingDatabase {
  const globalWithDb = globalThis as DbGlobal;
  const cached = globalWithDb[globalKey];
  if (cached) return cached.drizzle;
  const directory = projectRoot();
  mkdirSync(directory, { recursive: true });
  const sqlite = new Database(path.join(directory, "newbeing.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspace_states (
      id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
      description TEXT NOT NULL, parameters TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS experiments (
      result_id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL, strategy_id TEXT NOT NULL, strategy_version TEXT NOT NULL,
      assumptions TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS experiments_created_at_idx ON experiments(created_at DESC);
    CREATE TABLE IF NOT EXISTS paper_accounts (
      id TEXT PRIMARY KEY, quote_balance REAL NOT NULL, base_balance REAL NOT NULL,
      average_entry_price REAL, realized_pnl REAL NOT NULL, fee_rate REAL NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paper_orders (
      client_order_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL,
      quantity REAL NOT NULL, status TEXT NOT NULL, fill_price REAL, fee REAL NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_previews (
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL,
      mode TEXT NOT NULL, reference_price REAL NOT NULL, estimated_notional REAL NOT NULL,
      estimated_fee REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, order_id TEXT
    );
    CREATE INDEX IF NOT EXISTS order_previews_status_idx ON order_previews(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS replay_sessions (
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
      start_at INTEGER NOT NULL, cursor INTEGER NOT NULL, bars TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  const drizzleDb = drizzle(sqlite, { schema });
  globalWithDb[globalKey] = { sqlite, drizzle: drizzleDb };
  return drizzleDb;
}

export function closeDatabaseForTests(): void {
  const globalWithDb = globalThis as DbGlobal;
  const cached = globalWithDb[globalKey];
  if (cached) {
    cached.sqlite.close();
    delete globalWithDb[globalKey];
  }
}
