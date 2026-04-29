import "./index.css"
import { Meta, Title } from "@solidjs/meta"
import { type JSX } from "solid-js"
import { Footer } from "~/component/footer"
import { Header } from "~/component/header"
import { IconCheck, IconCopy } from "~/component/icon"
import { Legal } from "~/component/legal"
import { LocaleLinks } from "~/component/locale-links"
import { useI18n } from "~/context/i18n"

function CopyStatus() {
  return (
    <span data-component="copy-status">
      <IconCopy data-slot="copy" />
      <IconCheck data-slot="check" />
    </span>
  )
}

function IconWeb(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4 7.5H24V20.5H4V7.5Z" stroke="currentColor" stroke-width="1.5" />
      <path d="M4 11H24" stroke="currentColor" stroke-width="1.5" />
      <path d="M9 24H19" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
      <path d="M14 20.5V24" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

export default function Download() {
  const i18n = useI18n()
  const handleCopyClick = (command: string) => (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement
    void navigator.clipboard.writeText(command)
    button.setAttribute("data-copied", "")
    setTimeout(() => {
      button.removeAttribute("data-copied")
    }, 1500)
  }

  return (
    <main data-page="download">
      <Title>{i18n.t("download.title")}</Title>
      <LocaleLinks path="/download" />
      <Meta name="description" content={i18n.t("download.meta.description")} />
      <div data-component="container">
        <Header hideGetStarted />

        <div data-component="content">
          <section data-component="download-hero">
            <div data-component="hero-icon">
              <IconWeb />
            </div>
            <div data-component="hero-text">
              <h1>{i18n.t("download.hero.title")}</h1>
              <p>{i18n.t("download.hero.subtitle")}</p>
            </div>
          </section>

          <section data-component="download-section">
            <div data-component="section-label">
              <span>[1]</span> {i18n.t("download.section.terminal")}
            </div>
            <div data-component="section-content">
              <button
                data-component="cli-row"
                onClick={handleCopyClick("curl -fsSL https://example.invalid/install | bash")}
              >
                <code>
                  curl -fsSL https://<strong>example.invalid/install</strong> | bash
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("npm i -g codeplane-ai")}>
                <code>
                  npm i -g <strong>codeplane-ai</strong>
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("bun add -g codeplane-ai")}>
                <code>
                  bun add -g <strong>codeplane-ai</strong>
                </code>
                <CopyStatus />
              </button>
              <button data-component="cli-row" onClick={handleCopyClick("brew install devinoldenburg/tap/codeplane")}>
                <code>
                  brew install <strong>devinoldenburg/tap/codeplane</strong>
                </code>
                <CopyStatus />
              </button>
            </div>
          </section>
        </div>

        <Footer />
        <Legal />
      </div>
    </main>
  )
}
