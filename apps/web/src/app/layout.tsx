import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "newBeing — Trading Workstation",
  description: "Local-first market research, reproducible backtests and AI-native workspace context.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return <html lang="en" data-theme="dark"><body>{children}</body></html>;
}
