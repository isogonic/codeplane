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
          <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Choosing an install path</h2>
          <table className="my-8 w-full border-collapse text-left text-[13px]">
            <thead>
              <tr><th className="border-b border-line bg-surface-2 px-4 py-3">Path</th><th className="border-b border-line bg-surface-2 px-4 py-3">Use it when</th><th className="border-b border-line bg-surface-2 px-4 py-3">Update path</th></tr>
            </thead>
            <tbody>
              <tr><td className="border-b border-line px-4 py-3">Bash installer</td><td className="border-b border-line px-4 py-3">You want one standalone CLI binary on macOS/Linux.</td><td className="border-b border-line px-4 py-3"><code>codeplane upgrade</code></td></tr>
              <tr><td className="border-b border-line px-4 py-3">npm/Bun global</td><td className="border-b border-line px-4 py-3">You already manage developer tools with a JS package manager.</td><td className="border-b border-line px-4 py-3"><code>npm update -g codeplane-ai</code> or reinstall.</td></tr>
              <tr><td className="border-b border-line px-4 py-3">Desktop app</td><td className="border-b border-line px-4 py-3">You want native windows, notifications, and a managed local server.</td><td className="border-b border-line px-4 py-3">Electron updater from GitHub Releases.</td></tr>
              <tr><td className="border-b border-line px-4 py-3">Source checkout</td><td className="border-b border-line px-4 py-3">You are contributing to Codeplane itself.</td><td className="border-b border-line px-4 py-3"><code>git pull</code>, <code>bun install</code>, package scripts.</td></tr>
            </tbody>
          </table>
          <p>
            A server that should be reachable from another device must bind a non-loopback address
            and use Basic Auth. Example: <code>codeplane serve --hostname 0.0.0.0 --port 4096 --password "$SECRET"</code>.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container max-w-prose">
          <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Directory layout</h2>
          <p className="mb-8 text-ink-muted">The binary can be replaced safely; user state lives in the Codeplane home directory.</p>
          <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`# macOS
~/Library/Application Support/Codeplane

# Linux
~/.config/Codeplane

# Windows
%APPDATA%\\Codeplane`}
          </pre>
          <p>
            Override with <code>CODEPLANE_HOME_DIR</code>. Logs, data, cache, state, and installed
            runtime binaries can each be redirected with the matching <code>CODEPLANE_*_DIR</code>
            environment variables.
          </p>
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
