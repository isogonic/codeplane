import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Keybinds",
  description: "Every shortcut across web, desktop, and TUI. Custom bindings, sequence chords, and the keymap escape hatch.",
  alternates: { canonical: "/docs/keybinds/" },
  openGraph: {
    title: "Keybinds · Codeplane",
    description: "Every shortcut across web, desktop, and TUI. Custom bindings, sequence chords, and the keymap escape hatch.",
    url: "/docs/keybinds/",
    type: "article",
  },
  twitter: {
    title: "Keybinds · Codeplane",
    description: "Every shortcut across web, desktop, and TUI. Custom bindings, sequence chords, and the keymap escape hatch.",
    card: "summary_large_image",
  },
}

export default function Keybinds() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/keybinds/">
        <h1>Keybinds</h1>
        <p className="lede">Every shortcut across the web, desktop, and TUI front-ends. On macOS use <span className="kbd">⌘</span> where the table says <code>Mod</code>; on Windows / Linux use <span className="kbd">Ctrl</span>.</p>

        <h2>Global</h2>
        <table>
          <thead><tr><th>Key</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td><span className="kbd">Mod+K</span></td><td>Open the quick switcher.</td></tr>
            <tr><td><span className="kbd">Mod+N</span></td><td>New session in the current project.</td></tr>
            <tr><td><span className="kbd">Mod+B</span></td><td>Toggle the left sidebar.</td></tr>
            <tr><td><span className="kbd">Mod+\</span></td><td>Toggle the right side panel.</td></tr>
            <tr><td><span className="kbd">Mod+/</span></td><td>Search the active session.</td></tr>
            <tr><td><span className="kbd">Mod+,</span></td><td>Open settings.</td></tr>
            <tr><td><span className="kbd">Mod+Shift+P</span></td><td>Command palette.</td></tr>
            <tr><td><span className="kbd">?</span></td><td>Show the keybind overlay.</td></tr>
          </tbody>
        </table>

        <h2>Composer</h2>
        <table>
          <thead><tr><th>Key</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td><span className="kbd">Enter</span></td><td>Send message.</td></tr>
            <tr><td><span className="kbd">Shift+Enter</span></td><td>Newline.</td></tr>
            <tr><td><span className="kbd">Mod+Enter</span></td><td>Force send.</td></tr>
            <tr><td><span className="kbd">Esc</span></td><td>Cancel a streaming reply.</td></tr>
            <tr><td><span className="kbd">↑</span> / <span className="kbd">↓</span></td><td>Cycle through your previous messages.</td></tr>
            <tr><td><span className="kbd">/</span></td><td>Open the slash-command popover.</td></tr>
            <tr><td><span className="kbd">@</span></td><td>Open the file / agent mention popover.</td></tr>
          </tbody>
        </table>

        <h2>Timeline</h2>
        <table>
          <thead><tr><th>Key</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td><span className="kbd">j</span> / <span className="kbd">k</span></td><td>Scroll down / up by one message (TUI).</td></tr>
            <tr><td><span className="kbd">Mod+R</span></td><td>Revert to the previous user message.</td></tr>
            <tr><td><span className="kbd">Mod+Shift+R</span></td><td>Retry the current turn.</td></tr>
            <tr><td><span className="kbd">Mod+L</span></td><td>Clear the visible buffer.</td></tr>
            <tr><td><span className="kbd">Mod+C</span></td><td>Copy the focused message.</td></tr>
          </tbody>
        </table>

        <h2>Customizing</h2>
        <pre><code>{`// ~/.codeplane/keybinds.json
{
  "command.session.new":      ["mod+t"],
  "command.sidebar.toggle":   ["mod+\\\\"],
  "composer.send":            ["mod+enter"]
}`}</code></pre>
        <p>Full list of command IDs is in the in-app command palette (<span className="kbd">Mod+Shift+P</span>).</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
