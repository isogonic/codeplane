import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Configuration",
  description: "The codeplane.json reference — every provider, model, MCP server, permission rule, and agent setting, with sensible defaults.",
  alternates: { canonical: "/docs/configuration/" },
  openGraph: {
    title: "Configuration · Codeplane",
    description: "The codeplane.json reference — every provider, model, MCP server, permission rule, and agent setting, with sensible defaults.",
    url: "/docs/configuration/",
    type: "article",
  },
  twitter: {
    title: "Configuration · Codeplane",
    description: "The codeplane.json reference — every provider, model, MCP server, permission rule, and agent setting, with sensible defaults.",
    card: "summary_large_image",
  },
}

export default function Configuration() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/configuration/">
        <h1>Configuration</h1>
        <p className="lede">
          Codeplane reads <code>codeplane.jsonc</code> (JSON-with-comments;{" "}
          <code>codeplane.json</code> also accepted) from each of these locations in turn — every
          file <strong>merges</strong> over the previous one, so project settings beat instance
          settings, which beat user-global settings, which beat the bundled defaults.
        </p>

        <h2>Where it lives</h2>
        <table>
          <thead><tr><th>Layer</th><th>Path</th><th>Use it for</th></tr></thead>
          <tbody>
            <tr><td>Defaults</td><td>shipped inside the binary</td><td>provider templates, MCP server entries, agent presets</td></tr>
            <tr><td>User · macOS</td><td><code>~/Library/Application Support/Codeplane/codeplane.jsonc</code></td><td>API keys, preferred model, theme</td></tr>
            <tr><td>User · Linux</td><td><code>$XDG_CONFIG_HOME/Codeplane/codeplane.jsonc</code><br/>(defaults to <code>~/.config/Codeplane/</code>)</td><td>same as above</td></tr>
            <tr><td>User · Windows</td><td><code>%APPDATA%\Codeplane\codeplane.jsonc</code></td><td>same as above</td></tr>
            <tr><td>Per-instance</td><td><code>{`<user-root>/instances/<id>/codeplane.jsonc`}</code></td><td>everything an isolated instance overrides — providers, MCP, plugins, agents</td></tr>
            <tr><td>Project</td><td><code>{`<project>/.codeplane/codeplane.jsonc`}</code></td><td>per-repo rules, permission overrides, project agents</td></tr>
          </tbody>
        </table>
        <p className="text-ink-muted">
          Override the user root with <code>CODEPLANE_HOME_DIR</code> (full path). Per-instance is
          enabled automatically when you pass <code>--instance &lt;id&gt;</code> to any CLI command;
          the directory is created on first use.
        </p>
        <p>Schema published at <a href="https://codeplane.cc/config.json">https://codeplane.cc/config.json</a>:</p>
        <pre><code>{`{
  "$schema": "https://codeplane.cc/config.json",
  ...
}`}</code></pre>

        <h2>Top-level shape</h2>
        <pre><code>{`{
  "$schema": "https://codeplane.cc/config.json",
  "provider":   { /* models + auth */ },
  "permission": { /* what the agent may do without asking */ },
  "agent":      { /* personalities the user can switch between */ },
  "mode":       { /* per-mode prompt + tool overrides */ },
  "mcp":        { /* Model Context Protocol servers */ },
  "rules":      { /* per-directory rule files */ },
  "commit":     { /* git commit author / co-author config */ },
  "telemetry":  false,
  "theme":      "system"
}`}</code></pre>

        <h2>provider</h2>
        <pre><code>{`"provider": {
  "anthropic": {
    "apiKey": "{env:ANTHROPIC_API_KEY}",
    "default": "claude-sonnet-4-6"
  },
  "openai": {
    "apiKey": "{env:OPENAI_API_KEY}",
    "baseUrl": "{env:OPENAI_BASE_URL}",
    "default": "gpt-5.2"
  },
  "openrouter": { "apiKey": "{env:OPENROUTER_API_KEY}" },
  "ollama":     { "baseUrl": "http://localhost:11434/v1" }
}`}</code></pre>
        <p>String values may use <code>{`{env:VAR}`}</code> placeholders.</p>

        <h2>permission</h2>
        <pre><code>{`"permission": {
  "edit":  "ask",
  "shell": "ask",
  "read":  "allow",
  "rules": {
    "shell": {
      "npm:*":      "allow",
      "git diff*":  "allow",
      "rm -rf*":    "ask"
    },
    "edit": {
      "**/*.lock":  "deny"
    }
  }
}`}</code></pre>
        <p>Full grammar at <Link href="/docs/permissions/">Permissions</Link>.</p>

        <h2>agent</h2>
        <pre><code>{`"agent": {
  "build": {
    "description": "Implement features, edit files, run tests.",
    "model":  "anthropic:claude-sonnet-4-6",
    "prompt": "You are a careful senior engineer..."
  },
  "review": {
    "description": "Read-only code reviewer.",
    "model":  "anthropic:claude-opus-4-7",
    "tools":  { "edit": "deny", "shell": "deny" }
  }
}`}</code></pre>

        <h2>mode</h2>
        <pre><code>{`"mode": {
  "plan": {
    "description": "Think first, no file edits.",
    "tools": { "edit": "deny" },
    "prompt": "Produce a step-by-step plan before any action..."
  }
}`}</code></pre>

        <h2>mcp</h2>
        <pre><code>{`"mcp": {
  "filesystem": {
    "command": "npx",
    "args":    ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Code"]
  },
  "github": {
    "command": "uvx",
    "args":    ["mcp-server-github"],
    "env":     { "GITHUB_TOKEN": "{env:GITHUB_TOKEN}" }
  }
}`}</code></pre>
        <p>Full reference at <Link href="/docs/mcp/">MCP servers</Link>.</p>

        <h2>rules / commit / theme / telemetry</h2>
        <pre><code>{`"rules":     ["./AGENTS.md", "./.codeplane/rules.md"],
"commit":    { "coauthor": true },
"theme":     "system",
"telemetry": false`}</code></pre>
        <p><code>telemetry</code> is disabled by default; Codeplane has no telemetry endpoint — the key exists so you can confirm it&apos;s off in audits.</p>

        <h2>Validating</h2>
        <pre><code>{`jq . codeplane.json && \\
  curl -fsSL https://codeplane.cc/config.json | \\
  npx ajv-cli validate -s /dev/stdin -d codeplane.json`}</code></pre>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
