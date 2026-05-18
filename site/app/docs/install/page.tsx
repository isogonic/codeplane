import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { InstallTabs } from "@/components/install-tabs"
import { latestCliVersion, latestDesktopTag, latestMobileTag } from "@/lib/releases"

export const metadata = {
  title: "Install Codeplane",
  description: "Install Codeplane on macOS, Linux, Windows, or iOS. One-line bash installer, codeplane-ai on npm/Bun, or a signed desktop bundle from the latest release.",
  alternates: { canonical: "/docs/install/" },
  openGraph: {
    title: "Install Codeplane · Codeplane",
    description: "Install Codeplane on macOS, Linux, Windows, or iOS. One-line bash installer, codeplane-ai on npm/Bun, or a signed desktop bundle from the latest release.",
    url: "/docs/install/",
    type: "article",
  },
  twitter: {
    title: "Install Codeplane · Codeplane",
    description: "Install Codeplane on macOS, Linux, Windows, or iOS. One-line bash installer, codeplane-ai on npm/Bun, or a signed desktop bundle from the latest release.",
    card: "summary_large_image",
  },
}

export default async function InstallPage() {
  /* All three are resolved at build time. Each helper has a hardcoded
   * fallback inside so a flaky GitHub API call can't break the build. */
  const [cliVersion, desktopTag, mobileTag] = await Promise.all([
    latestCliVersion(),
    latestDesktopTag(),
    latestMobileTag(),
  ])
  return (
    <>
      <SiteHeader active="install" />
      <section className="py-16">
        <div className="container max-w-prose">
          <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-4">Install</div>
          <h1 className="text-[clamp(36px,5vw,56px)] leading-[1.05] tracking-tightest font-semibold mb-6">
            Get Codeplane on your machine.
          </h1>
          <p className="text-[19px] leading-relaxed text-ink-muted">
            Codeplane ships as a standalone CLI binary (via npm) plus a signed Electron desktop
            bundle. Mobile is iOS-only and invite-only today. Pick the path that fits your platform.
          </p>
        </div>
      </section>

      <section className="py-8">
        <div className="container max-w-prose">
          <InstallTabs desktopTag={desktopTag} cliVersion={cliVersion} mobileTag={mobileTag} />
        </div>
      </section>

      <section className="py-16">
        <div className="container max-w-prose">
          <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Verifying the install</h2>
          <p className="mb-8 text-ink-muted">Same check on every platform.</p>
          <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`codeplane --version
codeplane --help
codeplane web --port 4096`}
          </pre>
          <p>The first command should print the semantic version. The second lists every subcommand. The third boots a local server and opens the web UI.</p>
        </div>
      </section>

      <section className="py-16">
        <div className="container max-w-prose">
          <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Uninstalling</h2>
          <p className="mb-8 text-ink-muted">Codeplane is one binary plus a config directory — nothing in the system registry, nothing in launchd.</p>
          <h3 className="mt-6 font-semibold">macOS / Linux (CLI from npm or bash installer)</h3>
          <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`# bash-installed CLI
rm -rf ~/.codeplane

# npm-installed CLI
npm uninstall -g codeplane-ai

# Codeplane config + local sessions (per-user)
rm -rf ~/.config/codeplane            # Linux / macOS XDG_CONFIG_HOME`}
          </pre>
          <h3 className="mt-6 font-semibold">Desktop app</h3>
          <p>macOS: drag Codeplane out of <code>/Applications</code>. Windows: <strong>Settings → Apps → Codeplane → Uninstall</strong>. Linux: <code>sudo apt remove codeplane-desktop</code> or just delete the unpacked AppImage / tar.gz directory.</p>
          <h3 className="mt-6 font-semibold">iOS</h3>
          <p>Long-press the app icon → Delete.</p>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}
