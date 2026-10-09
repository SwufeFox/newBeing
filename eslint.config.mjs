import nextVitals from "eslint-config-next/core-web-vitals";
import tsParser from "@typescript-eslint/parser";

const config = [
  ...nextVitals,
  { settings: { next: { rootDir: "apps/web/" } } },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tsParser },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: { next: { rootDir: "apps/web/" } },
  },
  { ignores: ["**/.next/**", "**/node_modules/**", "**/dist/**", "**/public/monaco/**"] },
];

export default config;
