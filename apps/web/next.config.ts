import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@newbeing/core", "@newbeing/market-data", "@newbeing/storage", "@newbeing/application"],
  serverExternalPackages: ["better-sqlite3", "ccxt"],
};

export default nextConfig;
