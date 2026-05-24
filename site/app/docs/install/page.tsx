import Link from "next/link"
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
      <div className="rail">
        <section className="py-16">
          <div className="container max-w-prose">
            <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-4">Install</div>
            <h1 className="text-[clamp(36px,5vw,56px)] leading-[1.05] tracking-tightest font-semibold mb-6">
              Get Codeplane on your machine.
            </h1>
            <p className="text-[19px] leading-relaxed text-ink-muted">
              Codeplane ships as a standalone CLI binary, an npm/Bun wrapper package, and a signed
              Electron desktop bundle. The terminal UI also needs its bundled runtime assets, so the
              install path matters when you are repairing or upgrading an existing machine.
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
            <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Choosing an install path</h2>
            <p className="mb-8 text-ink-muted">
              Use one install owner per machine when possible. Mixing curl and npm works, but
              whichever <code>codeplane</code> appears first on <code>PATH</code> wins.
            </p>
            <table className="my-8 w-full border-collapse text-left text-[13px]">
              <thead>
                <tr><th className="border-b border-line bg-surface-2 px-4 py-3">Path</th><th className="border-b border-line bg-surface-2 px-4 py-3">Use it when</th><th className="border-b border-line bg-surface-2 px-4 py-3">What it installs</th><th className="border-b border-line bg-surface-2 px-4 py-3">Update path</th></tr>
              </thead>
              <tbody>
                <tr><td className="border-b border-line px-4 py-3">Bash installer</td><td className="border-b border-line px-4 py-3">You want a standalone CLI on macOS, Linux, or WSL2.</td><td className="border-b border-line px-4 py-3"><code>~/.codeplane/bin/codeplane</code>, TUI bundle, native TUI dependency.</td><td className="border-b border-line px-4 py-3"><code>codeplane upgrade</code> or rerun the installer.</td></tr>
                <tr><td className="border-b border-line px-4 py-3">npm / Bun global</td><td className="border-b border-line px-4 py-3">You already manage global developer tools with a JS package manager.</td><td className="border-b border-line px-4 py-3"><code>codeplane-ai</code> wrapper plus matching <code>codeplane-&lt;platform&gt;-&lt;arch&gt;</code> package.</td><td className="border-b border-line px-4 py-3"><code>npm install -g codeplane-ai@latest</code> or the equivalent Bun/pnpm command.</td></tr>
                <tr><td className="border-b border-line px-4 py-3">Desktop app</td><td className="border-b border-line px-4 py-3">You want native windows, notifications, and desktop-managed local servers.</td><td className="border-b border-line px-4 py-3">Electron app plus managed local runtime cache.</td><td className="border-b border-line px-4 py-3">Desktop auto-updater from GitHub Releases.</td></tr>
                <tr><td className="border-b border-line px-4 py-3">Source checkout</td><td className="border-b border-line px-4 py-3">You are contributing to Codeplane itself.</td><td className="border-b border-line px-4 py-3">Workspace packages under the repo checkout.</td><td className="border-b border-line px-4 py-3"><code>git pull</code>, <code>bun install</code>, package scripts.</td></tr>
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
            <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">What the bash installer does</h2>
            <p className="mb-8 text-ink-muted">
              The one-liner is a small shell script served from <code>https://codeplane.cc/install</code>.
              It downloads npm tarballs directly; it does not install Node packages globally.
            </p>
            <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`curl -fsSL https://codeplane.cc/install | bash
curl -fsSL https://codeplane.cc/install | bash -s -- --version ${cliVersion}
curl -fsSL https://codeplane.cc/install | bash -s -- --no-modify-path
curl -fsSL https://codeplane.cc/install | bash -s -- --binary /path/to/codeplane`}
            </pre>
            <ol className="mb-8 list-decimal space-y-3 pl-6">
              <li>Detects <code>darwin</code>, <code>linux</code>, or WSL2, then picks <code>arm64</code> or <code>x64</code>. Linux also detects musl, and x64 hosts without AVX2 use a baseline package.</li>
              <li>Resolves the platform npm package, for example <code>codeplane-darwin-arm64</code> or <code>codeplane-linux-x64-musl</code>.</li>
              <li>Downloads the exact tarball from the npm registry and unpacks the full <code>bin/</code> payload into <code>~/.codeplane/bin/</code>.</li>
              <li>Installs <code>runtime/tui/node-main.js</code> and the matching native <code>@opentui/core-*</code> package used by the terminal renderer.</li>
              <li>Repairs same-version installs if the binary exists but the TUI bundle or native TUI dependency is missing.</li>
              <li>Links a Bun runtime into <code>~/.codeplane/bin/bun</code> when Bun is already installed. If Bun is not available, Node.js 22+ can be linked as the fallback runtime.</li>
              <li>Tries to make <code>codeplane</code> available immediately by linking a shim into an existing writable user bin directory already on <code>PATH</code>.</li>
              <li>Unless <code>--no-modify-path</code> is set, writes a shell-profile line that prepends <code>~/.codeplane/bin</code> for future shells.</li>
            </ol>
            <p>
              The installer cannot mutate the parent shell that launched it. If <code>codeplane</code>
              is not found immediately, run <code>~/.codeplane/bin/codeplane</code>, reload your shell,
              or add <code>export PATH=$HOME/.codeplane/bin:$PATH</code> manually.
            </p>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-prose">
            <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Verifying the install</h2>
            <p className="mb-8 text-ink-muted">Check the command on PATH and the binary that owns the TUI assets.</p>
            <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`which -a codeplane
codeplane --version
codeplane --help
codeplane web --port 4096

# Curl installer only
~/.codeplane/bin/codeplane --version
test -f ~/.codeplane/bin/runtime/tui/node-main.js
ls ~/.codeplane/bin/node_modules/@opentui`}
            </pre>
            <p>
              The version command should print the semantic version. <code>which -a</code> must show
              the binary you intend to use first. <code>codeplane web</code> boots a local server and
              opens the web UI; bare <code>codeplane</code> launches the TUI in an interactive terminal.
            </p>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-prose">
            <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Repairing or updating</h2>
            <p className="mb-8 text-ink-muted">
              Reinstalling is safe. User sessions, config, and saved instances do not live in the
              installed binary directory.
            </p>
            <h3 className="mt-6 font-semibold">Curl installer</h3>
            <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`# Latest published version for this platform
curl -fsSL https://codeplane.cc/install | bash

# Exact version, useful when testing a release
curl -fsSL https://codeplane.cc/install | bash -s -- --version ${cliVersion}

# If PATH points at a different binary
~/.codeplane/bin/codeplane --version
~/.codeplane/bin/codeplane upgrade`}
            </pre>
            <h3 className="mt-6 font-semibold">npm / Bun / pnpm</h3>
            <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`npm install -g codeplane-ai@latest
bun install -g codeplane-ai@latest
pnpm add -g codeplane-ai@latest

npm view codeplane-ai version
which -a codeplane
codeplane --version`}
            </pre>
            <p>
              If npm reports a newer install but <code>codeplane --version</code> still prints the old
              version, inspect <code>which -a codeplane</code>. A curl-installed{" "}
              <code>~/.codeplane/bin/codeplane</code> or another global package-manager shim may be
              earlier on <code>PATH</code>.
            </p>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-prose">
            <h2 className="mb-2 text-[28px] leading-tight tracking-tighter font-semibold">Directory layout</h2>
            <p className="mb-8 text-ink-muted">
              The curl-installed binary can be replaced safely. User state lives in the Codeplane
              home directory, which is separate from <code>~/.codeplane/bin</code>.
            </p>
            <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`# Curl installer payload
~/.codeplane/bin/codeplane
~/.codeplane/bin/runtime/tui/node-main.js
~/.codeplane/bin/node_modules/@opentui/core-<platform>-<arch>/
~/.codeplane/bin/bun       # optional runtime link
~/.codeplane/bin/node      # optional Node.js 22+ fallback link

# Codeplane home on macOS
~/Library/Application Support/Codeplane

# Codeplane home on Linux
~/.config/Codeplane

# Codeplane home on Windows
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
            <p className="mb-8 text-ink-muted">Codeplane is one binary tree plus a config directory. Remove the install owner you actually used.</p>
            <h3 className="mt-6 font-semibold">macOS / Linux (CLI from npm or bash installer)</h3>
            <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`# See every command that could shadow another install
which -a codeplane

# bash-installed CLI payload
rm -rf ~/.codeplane

# Remove only installer-owned PATH shims
for shim in "$HOME/.local/bin/codeplane" "$HOME/bin/codeplane" /opt/homebrew/bin/codeplane /usr/local/bin/codeplane; do
  if [ "$(readlink "$shim" 2>/dev/null)" = "$HOME/.codeplane/bin/codeplane" ]; then
    rm -f "$shim"
  elif [ -f "$shim" ] && grep -q "codeplane installer shim" "$shim"; then
    rm -f "$shim"
  fi
done

# npm-installed CLI
npm uninstall -g codeplane-ai

# Codeplane config, sessions, logs, plugins, saved instances, and local runtimes
rm -rf ~/.config/Codeplane            # Linux
rm -rf "$HOME/Library/Application Support/Codeplane"  # macOS`}
            </pre>
            <h3 className="mt-6 font-semibold">Desktop app</h3>
            <p>macOS: drag Codeplane out of <code>/Applications</code>. Windows: <strong>Settings → Apps → Codeplane → Uninstall</strong>. Linux: <code>sudo apt remove codeplane-desktop</code> or just delete the unpacked AppImage / tar.gz directory.</p>
            <h3 className="mt-6 font-semibold">iOS</h3>
            <p>Long-press the app icon → Delete.</p>
            <p className="mt-8 text-ink-muted">
              For exact failure messages and repair commands, see <Link href="/docs/troubleshooting/">Troubleshooting</Link>.
            </p>
          </div>
        </section>
      </div>

      <SiteFooter />
    </>
  )
}
