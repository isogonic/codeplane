import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { InstallTabs } from "@/components/install-tabs"

export const metadata = { title: "Install Codeplane" }

export default function InstallPage() {
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
            Codeplane ships as a single standalone binary (no Node or runtime required) plus
            native shells for desktop and mobile. Pick the path that fits your platform.
          </p>
        </div>
      </section>

      <section className="py-8">
        <div className="container max-w-prose">
          <InstallTabs />
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
          <p className="mb-8 text-ink-muted">No registry rot, no system services. Codeplane is a single binary + a config dir.</p>
          <h3 className="mt-6 font-semibold">macOS / Linux</h3>
          <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`rm -rf ~/.codeplane                              # binary + cache
rm -rf ~/Library/Application\\ Support/Codeplane  # macOS user data
rm -rf ~/.config/codeplane                       # Linux user data
sudo rm /usr/local/bin/codeplane                 # PATH symlink`}
          </pre>
          <h3 className="mt-6 font-semibold">Windows</h3>
          <p>Uninstall the desktop app via <strong>Settings → Apps</strong>. Remove <code>%USERPROFILE%\.codeplane\</code> + <code>%APPDATA%\Codeplane\</code>.</p>
          <h3 className="mt-6 font-semibold">Mobile</h3>
          <p>Long-press the app icon → Delete.</p>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}
