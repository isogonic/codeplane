"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AndroidIcon,
  AppleIcon,
  SmartPhone01Icon,
  TerminalIcon,
  Layout02Icon,
} from "@hugeicons/core-free-icons"

/*
 * Client component because Next.js can't pre-render tab state. The tabs
 * panel state is local React; everything inside each panel is plain HTML
 * so there's still no runtime data fetching.
 */
type TabId = "macos" | "linux" | "windows" | "npm" | "mobile"

const TABS: { id: TabId; label: string; icon: typeof TerminalIcon }[] = [
  { id: "macos",   label: "macOS",     icon: AppleIcon },
  { id: "linux",   label: "Linux",     icon: TerminalIcon },
  { id: "windows", label: "Windows",   icon: Layout02Icon },
  { id: "npm",     label: "npm / Bun", icon: TerminalIcon },
  { id: "mobile",  label: "Mobile",    icon: SmartPhone01Icon },
]

export function InstallTabs() {
  const [active, setActive] = useState<TabId>("macos")
  return (
    <>
      <div role="tablist" className="mb-7 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              active === t.id
                ? "border-ink text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <HugeiconsIcon icon={t.icon} size={16} strokeWidth={1.5} />
            {t.label}
          </button>
        ))}
      </div>

      {active === "macos" && <PanelMacOS />}
      {active === "linux" && <PanelLinux />}
      {active === "windows" && <PanelWindows />}
      {active === "npm" && <PanelNpm />}
      {active === "mobile" && <PanelMobile />}
    </>
  )
}

function PanelMacOS() {
  return (
    <div className="docs-prose">
      <h2 className="mt-0">macOS</h2>
      <p className="lede !mb-8 !text-[17px]">
        One-line installer for the CLI + standalone <code>.dmg</code> for the desktop app.
        Both are signed for Apple Silicon and Intel.
      </p>
      <h3>CLI · scripted installer</h3>
      <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
      <p className="text-ink-muted">
        Detects <code>darwin-arm64</code> or <code>darwin-x64</code>, downloads the matching
        ~94 MB binary into <code>~/.codeplane/bin/</code>, symlinks <code>codeplane</code>
        into <code>/usr/local/bin</code>. Pin a version with <code>-v 28.2.3</code>; skip the
        PATH edit with <code>--no-modify-path</code>.
      </p>

      <h3>CLI · Homebrew</h3>
      <pre><code>{`brew install devinoldenburg/codeplane/codeplane`}</code></pre>

      <h3>Desktop · <code>.dmg</code></h3>
      <ul>
        <li>
          <a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-macos-apple-silicon.dmg">
            Apple Silicon (M1 / M2 / M3 / M4)
          </a>
        </li>
        <li>
          <a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-macos-intel.dmg">
            Intel
          </a>
        </li>
      </ul>
      <p className="text-ink-muted">
        The desktop app updates itself silently through electron-updater after first launch.
      </p>
    </div>
  )
}

function PanelLinux() {
  return (
    <div className="docs-prose">
      <h2 className="mt-0">Linux</h2>
      <p className="lede !mb-8 !text-[17px]">Standalone binary plus desktop packages for the major distributions.</p>
      <h3>CLI · scripted installer</h3>
      <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
      <h3>Desktop · AppImage / deb / tar.gz</h3>
      <ul>
        <li><a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-linux-x64.AppImage"><code>.AppImage</code></a></li>
        <li><code>.deb</code> — <code>sudo dpkg -i codeplane-desktop-*-linux-amd64.deb</code></li>
        <li><code>.tar.gz</code> — extract anywhere, run <code>./codeplane-desktop</code></li>
      </ul>
      <h3>Headless server</h3>
      <pre><code>{`codeplane serve --port 4096 --hostname 0.0.0.0`}</code></pre>
    </div>
  )
}

function PanelWindows() {
  return (
    <div className="docs-prose">
      <h2 className="mt-0">Windows</h2>
      <p className="lede !mb-8 !text-[17px]">NSIS installer plus PowerShell scripted CLI install.</p>
      <h3>Desktop · installer</h3>
      <p>
        <a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-windows-x64.exe">
          codeplane-desktop-windows-x64.exe
        </a>
      </p>
      <h3>CLI · PowerShell</h3>
      <pre><code>{`irm https://codeplane.cc/install | iex`}</code></pre>
      <h3>CLI · WSL2</h3>
      <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
    </div>
  )
}

function PanelNpm() {
  return (
    <div className="docs-prose">
      <h2 className="mt-0">npm / Bun</h2>
      <p className="lede !mb-8 !text-[17px]">Same single-file native binary, published under <code>codeplane</code> on npm.</p>
      <h3>Global install</h3>
      <pre><code>{`npm install -g codeplane
# or
bun install -g codeplane
# or
pnpm add -g codeplane`}</code></pre>
      <h3>One-shot run</h3>
      <pre><code>{`bunx codeplane web
# or
npx codeplane@latest web`}</code></pre>
    </div>
  )
}

function PanelMobile() {
  return (
    <div className="docs-prose">
      <h2 className="mt-0">Mobile</h2>
      <p className="lede !mb-8 !text-[17px]">Native iOS + Android shells. They wrap the web UI and connect to a Codeplane server you self-host.</p>
      <h3>iOS — TestFlight</h3>
      <p>
        <a className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-surface no-underline" href="https://testflight.apple.com/join/codeplane">
          <HugeiconsIcon icon={AppleIcon} size={14} strokeWidth={1.5} /> Join the TestFlight beta
        </a>
      </p>
      <h3>iOS — sideload <code>.ipa</code></h3>
      <p>Each mobile release ships an <code>.ipa</code> at <a href="https://github.com/devinoldenburg/codeplane/releases">/releases</a> (look for <code>v&lt;x.y.z&gt;-mobile</code>). Pair with AltStore / Sideloadly.</p>
      <h3>Android — Play Store</h3>
      <p>
        <a className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-surface no-underline" href="https://play.google.com/store/apps/details?id=ai.codeplane">
          <HugeiconsIcon icon={AndroidIcon} size={14} strokeWidth={1.5} /> Open Google Play
        </a>
      </p>
      <h3>Android — APK sideload</h3>
      <pre><code>{`adb install Codeplane-Android-<version>.apk`}</code></pre>
    </div>
  )
}
