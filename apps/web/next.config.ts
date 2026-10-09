import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEWBEING_NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@newbeing/core", "@newbeing/market-data", "@newbeing/storage", "@newbeing/application"],
  serverExternalPackages: ["better-sqlite3", "ccxt"],
};

export default nextConfig;
