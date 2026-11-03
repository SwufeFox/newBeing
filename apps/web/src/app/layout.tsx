import type { Metadata, Viewport } from "next";
import { Noto_Sans_SC } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeSync } from "@/components/theme-sync";

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
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var r=localStorage.getItem("newbeing-workspace-v1");var s=r?JSON.parse(r):null;var t=s&&s.state&&s.state.theme;if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`}
        </Script>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
