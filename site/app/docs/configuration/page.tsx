import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "Configuration" }

export default function Configuration() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/configuration/">
        <h1>Configuration</h1>
        <p className="lede">
          Codeplane reads <code>codeplane.json</code> from three locations, in order — every
          file <strong>merges</strong> over the previous one, so project settings beat user
          settings, which beat the bundled defaults.
        </p>

        <h2>Where it lives</h2>
        <table>
          <thead><tr><th>Layer</th><th>Path</th><th>Use it for</th></tr></thead>
          <tbody>
            <tr><td>Defaults</td><td>shipped inside the binary</td><td>provider templates, MCP server entries, agent presets</td></tr>
            <tr><td>User</td><td><code>~/.codeplane/codeplane.json</code></td><td>API keys, preferred model, theme</td></tr>
            <tr><td>Project</td><td><code>&lt;project&gt;/.codeplane/codeplane.json</code></td><td>per-repo rules, permission overrides, project agents</td></tr>
          </tbody>
        </table>
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
