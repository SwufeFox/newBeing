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
    /* `suppressHydrationWarning` is required, not a silencer for a real bug: the
       inline script below writes the device's stored colour-vision mode and
       language onto <html> before hydration, so the root element is *meant* to
       differ from the server HTML. Every other node must still match. */
    <html lang="en" data-ak-theme="terminal" className={notoSans.variable} suppressHydrationWarning>
      <head>
        {/* Colour-vision mode and language are paint-time decisions: read them
            during head parsing so a deuteranopia reader never sees the red/green
            ramp flash past, and so the loading state is announced in the
            language the interface is about to use.
            `next/script` with `beforeInteractive` is injected after hydration in
            the App Router (measured), which is too late to prevent that first
            frame, so this stays a raw inline script. React logs a development-
            only warning about script tags in a component tree; production builds
            are silent and the SSR HTML executes it during parsing. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var p=JSON.parse(localStorage.getItem('newbeing:ui-preferences:v1')||'{}');if(p){if(p.colorVision==='deuteranopia'){document.documentElement.dataset.cv='deuteranopia'}if(p.locale==='zh'){document.documentElement.lang='zh-CN'}}}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
