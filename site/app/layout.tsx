import type { Metadata } from "next"
import "./globals.css"

/*
 * Root layout. Loads the global stylesheet + sets the site-wide metadata
 * defaults. Pages can override `metadata` per-route via the App Router's
 * native API.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://codeplane.cc"),
  title: {
    default: "Codeplane — open-source coding agent",
    template: "%s · Codeplane",
  },
  description:
    "Codeplane is an open-source coding agent. Run it from your terminal, desktop, browser, or phone — connected to a single Codeplane server.",
  openGraph: {
    type: "website",
    siteName: "Codeplane",
    url: "https://codeplane.cc",
    images: ["/assets/logo.svg"],
  },
  icons: {
    icon: "/assets/logo.svg",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="font-sans">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
