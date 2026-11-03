import type { Metadata, Viewport } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

// CJK body face only. The display/label/mono faces are self-hosted in
// app/fonts.css (Novecento Sans Wide, Bender, JetBrains Mono) — the real
// Arknights type roles, not a serif.
const notoSans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-noto-sans",
  display: "swap",
});

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
  return (
    <html lang="en" data-theme="dark" className={notoSans.variable}>
      <body>{children}</body>
    </html>
  );
}
