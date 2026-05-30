import type { Metadata, Viewport } from "next"
import "./globals.css"

/*
 * Root layout. Loads the global stylesheet + sets the site-wide metadata
 * defaults: SEO, Open Graph, Twitter card, favicons, web manifest. Pages
 * override `metadata` per-route via the App Router's native API.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://codeplane.cc"),
  title: {
    default: "Codeplane — open-source coding agent for terminal, desktop, web & mobile",
    template: "%s · Codeplane",
  },
  description:
    "Codeplane is an open-source MIT-licensed coding agent. Run it from your terminal, desktop, browser, or phone — connected to a single self-hosted Codeplane server. Bring any model (OpenAI, Anthropic, OpenRouter, Ollama, vLLM, custom), wire in MCP servers, share sessions across surfaces.",
  applicationName: "Codeplane",
  authors: [{ name: "Devin Oldenburg", url: "https://github.com/isogonic" }],
  creator: "Devin Oldenburg",
  publisher: "Codeplane",
  keywords: [
    "coding agent",
    "AI coding assistant",
    "open source",
    "self-hosted",
    "terminal coding agent",
    "TUI coding agent",
    "Claude coding agent",
    "OpenAI coding agent",
    "MCP",
    "Model Context Protocol",
    "OpenRouter",
    "Ollama",
    "vLLM",
    "agent SDK",
  ],
  category: "developer tools",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "Codeplane",
    url: "https://codeplane.cc",
    title: "Codeplane — open-source coding agent",
    description:
      "One server, four front-ends — terminal, desktop, web, mobile. Plug in your model, point it at your repo, pick up the same session from any device.",
    locale: "en_US",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        type: "image/png",
        alt: "Codeplane — a coding agent that lives everywhere you code.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codeplane — open-source coding agent",
    description:
      "Terminal, desktop, web, mobile — one self-hosted agent that follows you across surfaces. MIT, any model, MCP-native.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"],
  },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#100f0e" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        {children}
        {/*
         * JSON-LD structured data — helps Google show the project as a
         * proper SoftwareApplication card in search results.
         */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "SoftwareApplication",
                  name: "Codeplane",
                  url: "https://codeplane.cc",
                  applicationCategory: "DeveloperApplication",
                  operatingSystem: "macOS, Linux, Windows, iOS, Android",
                  description:
                    "Open-source coding agent for terminal, desktop, web, and mobile. One server, four front-ends.",
                  license: "https://opensource.org/licenses/MIT",
                  offers: {
                    "@type": "Offer",
                    price: "0",
                    priceCurrency: "USD",
                  },
                  author: {
                    "@type": "Person",
                    name: "Devin Oldenburg",
                    url: "https://github.com/isogonic",
                  },
                  sameAs: [
                    "https://github.com/isogonic/codeplane",
                  ],
                },
                {
                  "@type": "WebSite",
                  name: "Codeplane",
                  url: "https://codeplane.cc",
                  inLanguage: "en-US",
                  publisher: {
                    "@type": "Organization",
                    name: "Codeplane",
                    logo: { "@type": "ImageObject", url: "https://codeplane.cc/icon-512.png" },
                  },
                },
                {
                  "@type": "Organization",
                  name: "Codeplane",
                  url: "https://codeplane.cc",
                  logo: "https://codeplane.cc/icon-512.png",
                  sameAs: ["https://github.com/isogonic/codeplane"],
                },
              ],
            }),
          }}
        />
      </body>
    </html>
  )
}
