# Third-party notices

newBeing's own source is MIT licensed; third-party dependencies remain under their original licenses. No source code was copied from GPL-3.0 projects (Freqtrade/FreqUI) or from proprietary TradingView Advanced Charts. Package-manager installations retain each dependency's original license files.

| Direct dependency | Version | License | Use / notice |
| --- | --- | --- | --- |
| TradingView Lightweight Charts | 5.2.1 | Apache-2.0 | Chart canvas/series/markers. Preserve upstream license and any shipped NOTICE; chart UI also shows the required TradingView attribution link. |
| CCXT | 4.5.85 | MIT | Public Binance Spot REST adapter; no private keys configured. |
| `@modelcontextprotocol/server` | 2.3.1 | Apache-2.0 | Official MCP server; preserve upstream license and NOTICE. |
| `@modelcontextprotocol/client` | 2.3.1 | Apache-2.0 | Official MCP client used for stdio smoke testing. |
| Drizzle ORM | 0.45.4 | Apache-2.0 | SQLite persistence adapter. |
| Next.js | 16.4.0 | MIT | App Router runtime. |
| React / React DOM | 19.3.0 | MIT | UI runtime. |
| Tailwind CSS | 4.3.3 | MIT | Styling utilities and tokens. |
| Monaco Editor | 0.57.0 | MIT | Locally served editor assets; no CDN required. |
| `@monaco-editor/react` | 4.7.0 | MIT | React wrapper for Monaco. |
| Zustand | 5.0.15 | MIT | Persisted UI state. |
| `better-sqlite3` | 13.0.3 | MIT | Local SQLite driver. |
| Zod | 4.6.5 | MIT | Request and tool schema validation. |
| Lucide React | 0.577.0 | ISC | Interface icons. |
| Radix UI Tabs | 1.1.22 | MIT | Accessible tabs primitive. |
| Class Variance Authority | 0.7.1 | Apache-2.0 | Button variant primitive. |
| `clsx` / `tailwind-merge` | 2.1.1 / 3.7.0 | MIT | Class name composition. |

This table covers direct runtime dependencies at the pinned versions. For full notices, see the corresponding package license files in the lockfile-resolved installation; re-audit licenses before upgrading dependencies or copying source.
