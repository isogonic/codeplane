import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"
import { InstallTabs } from "@/components/install-tabs"
import { HeroInstall } from "@/components/hero-install"
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
      <DocsLayout active="/docs/install/" prose={false}>
        <div className="max-w-prose">
          <div className="eyebrow mb-4">Install</div>
          <h1 className="text-[clamp(30px,4vw,42px)] font-semibold leading-[1.08] tracking-[-0.015em] text-ink">
            Get Codeplane on your machine.
          </h1>
          <p className="lede measure-wide mt-5">
            One line on macOS or Linux, an <code className="bg-surface-3 px-1">npm</code>/Bun package
            anywhere, or a signed desktop bundle. The terminal UI also needs its bundled runtime
            assets — so the install path matters when you’re repairing or upgrading a machine.
          </p>

          <div className="mt-8">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Fastest path · macOS, Linux, WSL
            </div>
            <HeroInstall />
          </div>

          <h2 className="mb-6 mt-14 text-[20px] font-semibold leading-snug tracking-[-0.015em] text-ink">
            Pick your platform
          </h2>
          <div>
            <InstallTabs desktopTag={desktopTag} cliVersion={cliVersion} mobileTag={mobileTag} />
          </div>

          <article className="docs-prose mt-16">
            <h2 className="mt-0">Choosing an install path</h2>
            <p>
              Use one install owner per machine when possible. Mixing curl and npm works, but
              whichever <code>codeplane</code> appears first on <code>PATH</code> wins.
            </p>
            <table>
              <thead>
                <tr><th>Path</th><th>Use it when</th><th>What it installs</th><th>Update path</th></tr>
              </thead>
              <tbody>
                <tr><td>Bash installer</td><td>You want a standalone CLI on macOS, Linux, or WSL2.</td><td><code>~/.codeplane/bin/codeplane</code>, TUI bundle, native TUI dependency.</td><td><code>codeplane upgrade</code> or rerun the installer.</td></tr>
                <tr><td>npm / Bun global</td><td>You already manage global developer tools with a JS package manager.</td><td><code>codeplane-ai</code> wrapper plus matching <code>codeplane-&lt;platform&gt;-&lt;arch&gt;</code> package.</td><td><code>npm install -g codeplane-ai@latest</code> or the Bun/pnpm equivalent.</td></tr>
                <tr><td>Desktop app</td><td>You want native windows, notifications, and desktop-managed local servers.</td><td>Electron app plus managed local runtime cache.</td><td>Desktop auto-updater from GitHub Releases.</td></tr>
                <tr><td>Source checkout</td><td>You are contributing to Codeplane itself.</td><td>Workspace packages under the repo checkout.</td><td><code>git pull</code>, <code>bun install</code>, package scripts.</td></tr>
              </tbody>
            </table>
            <p>
              A server that should be reachable from another device must bind a non-loopback address
              and use Basic Auth — for example{" "}
              <code>codeplane serve --hostname 0.0.0.0 --port 4096 --password &quot;$SECRET&quot;</code>.
            </p>

            <h2>What the bash installer does</h2>
            <p>
              The one-liner is a small shell script served from{" "}
              <code>https://codeplane.cc/install</code>. It downloads npm tarballs directly; it does
              not install Node packages globally.
            </p>
            <pre><code>{`curl -fsSL https://codeplane.cc/install | bash
curl -fsSL https://codeplane.cc/install | bash -s -- --version ${cliVersion}
curl -fsSL https://codeplane.cc/install | bash -s -- --no-modify-path
curl -fsSL https://codeplane.cc/install | bash -s -- --binary /path/to/codeplane`}</code></pre>
            <ol>
              <li>Detects <code>darwin</code>, <code>linux</code>, or WSL2, then picks <code>arm64</code> or <code>x64</code>. Linux also detects musl, and x64 hosts without AVX2 use a baseline package.</li>
              <li>Resolves the platform npm package, for example <code>codeplane-darwin-arm64</code> or <code>codeplane-linux-x64-musl</code>.</li>
              <li>Downloads the exact tarball from the npm registry and unpacks the full <code>bin/</code> payload into <code>~/.codeplane/bin/</code>.</li>
              <li>Installs <code>runtime/tui/node-main.js</code> and the matching native <code>@opentui/core-*</code> package used by the terminal renderer.</li>
              <li>Repairs same-version installs if the binary exists but the TUI bundle or native TUI dependency is missing.</li>
              <li>Links a Bun runtime into <code>~/.codeplane/bin/bun</code> when Bun is already installed. If Bun is not available, Node.js 22+ can be linked as the fallback runtime.</li>
              <li>Tries to make <code>codeplane</code> available immediately by linking a shim into a writable user bin directory already on <code>PATH</code>.</li>
              <li>Unless <code>--no-modify-path</code> is set, writes a shell-profile line that prepends <code>~/.codeplane/bin</code> for future shells.</li>
            </ol>
            <p>
              The installer cannot mutate the parent shell that launched it. If <code>codeplane</code>{" "}
              is not found immediately, run <code>~/.codeplane/bin/codeplane</code>, reload your shell,
              or add <code>export PATH=$HOME/.codeplane/bin:$PATH</code> manually.
            </p>

            <h2>Verifying the install</h2>
            <p>Check the command on PATH and the binary that owns the TUI assets.</p>
            <pre><code>{`which -a codeplane
codeplane --version
codeplane --help
codeplane web --port 4096

# Curl installer only
~/.codeplane/bin/codeplane --version
test -f ~/.codeplane/bin/runtime/tui/node-main.js
ls ~/.codeplane/bin/node_modules/@opentui`}</code></pre>
            <p>
              The version command should print the semantic version. <code>which -a</code> must show
              the binary you intend to use first. <code>codeplane web</code> boots a local server and
              opens the web UI; bare <code>codeplane</code> launches the TUI in an interactive terminal.
            </p>

            <h2>Repairing or updating</h2>
            <p>
              Reinstalling is safe. User sessions, config, and saved instances do not live in the
              installed binary directory.
            </p>
            <h3>Curl installer</h3>
            <pre><code>{`# Latest published version for this platform
curl -fsSL https://codeplane.cc/install | bash

# Exact version, useful when testing a release
curl -fsSL https://codeplane.cc/install | bash -s -- --version ${cliVersion}

# If PATH points at a different binary
~/.codeplane/bin/codeplane --version
~/.codeplane/bin/codeplane upgrade`}</code></pre>
            <h3>npm / Bun / pnpm</h3>
            <pre><code>{`npm install -g codeplane-ai@latest
bun install -g codeplane-ai@latest
pnpm add -g codeplane-ai@latest

npm view codeplane-ai version
which -a codeplane
codeplane --version`}</code></pre>
            <p>
              If npm reports a newer install but <code>codeplane --version</code> still prints the old
              version, inspect <code>which -a codeplane</code>. A curl-installed{" "}
              <code>~/.codeplane/bin/codeplane</code> or another global package-manager shim may be
              earlier on <code>PATH</code>.
            </p>

            <h2>Directory layout</h2>
            <p>
              The curl-installed binary can be replaced safely. User state lives in the Codeplane
              home directory, which is separate from <code>~/.codeplane/bin</code>.
            </p>
            <pre><code>{`# Curl installer payload
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
%APPDATA%\\Codeplane`}</code></pre>
            <p>
              Override with <code>CODEPLANE_HOME_DIR</code>. Logs, data, cache, state, and installed
              runtime binaries can each be redirected with the matching{" "}
              <code>CODEPLANE_*_DIR</code> environment variables.
            </p>

            <h2>Uninstalling</h2>
            <p>Codeplane is one binary tree plus a config directory. Remove the install owner you actually used.</p>
            <h3>macOS / Linux (CLI from npm or bash installer)</h3>
            <pre><code>{`# See every command that could shadow another install
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
rm -rf "$HOME/Library/Application Support/Codeplane"  # macOS`}</code></pre>
            <h3>Desktop app</h3>
            <p>
              macOS: drag Codeplane out of <code>/Applications</code>. Windows:{" "}
              <strong>Settings → Apps → Codeplane → Uninstall</strong>. Linux:{" "}
              <code>sudo apt remove codeplane-desktop</code> or just delete the unpacked AppImage /
              tar.gz directory.
            </p>
            <h3>iOS</h3>
            <p>Long-press the app icon → Delete.</p>
            <p>
              For exact failure messages and repair commands, see{" "}
              <Link href="/docs/troubleshooting/">Troubleshooting</Link>.
            </p>
          </article>
        </div>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
