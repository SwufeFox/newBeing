import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    agentUpgrade: "security",
  },
  distDir: process.env.NEWBEING_NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@newbeing/core", "@newbeing/market-data"],
  serverExternalPackages: ["@newbeing/application", "@newbeing/storage", "better-sqlite3", "ccxt"],
  outputFileTracingIncludes: { "/api/**": ["../../packages/core/dist/**/*.js"] },
  turbopack: {},
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals.push(({ request }, callback) => {
        if (["@newbeing/application", "@newbeing/storage", "better-sqlite3", "bindings"].includes(request ?? "")) {
          callback(null, `commonjs ${request}`);
          return;
        }
        callback();
      });
    }
    return config;
  },
};

export default nextConfig;
