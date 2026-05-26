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
  "server": { /* default serve/web network options */ },
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "openai/gpt-5.2-mini",
  "provider": { /* model providers and overrides */ },
  "permission": { /* what the agent may do without asking */ },
  "agent": { /* named primary and sub-agent configs */ },
  "mcp": { /* local and remote Model Context Protocol servers */ },
  "plugin": ["@my-org/codeplane-plugin"],
  "instructions": ["AGENTS.md", ".codeplane/rules.md"],
  "command": { /* project command definitions */ },
  "commit": { "coauthor": false },
  "autoupdate": "notify",
  "share": "manual",
  "tool_output": { "max_lines": 2000, "max_bytes": 51200 },
  "compaction": { "auto": true, "prune": true }
}`}</code></pre>

        <h2>server</h2>
        <pre><code>{`"server": {
  "port": 4096,
  "hostname": "127.0.0.1",
  "mdns": false,
  "mdnsDomain": "codeplane.local",
  "cors": ["https://codeplane.example.com"]
}`}</code></pre>
        <p>
          These values become defaults for <code>codeplane serve</code> and <code>codeplane web</code>.
          Explicit CLI flags win over config. If neither config nor CLI sets <code>port</code>, the
          CLI default is <code>0</code>, so the OS selects a free port.
        </p>

        <h2>provider and models</h2>
        <pre><code>{`"provider": {
  "anthropic": {
    "options": {
      "apiKey": "{secret:anthropic-api-key}",
      "timeout": 300000
    }
  },
  "openai": {
    "options": {
      "apiKey": "{secret:openai-api-key}",
      "baseURL": "{env:OPENAI_BASE_URL}"
    }
  },
  "local-ollama": {
    "name": "Ollama",
    "api": "openai",
    "options": {
      "baseURL": "http://localhost:11434/v1",
      "apiKey": "ollama"
    }
  }
},
"model": "anthropic/claude-sonnet-4-6",
"small_model": "openai/gpt-5.2-mini",
"disabled_providers": ["example-provider"]`}</code></pre>
        <p>
          String values may use <code>{`{secret:name}`}</code>, <code>{`{env:VAR}`}</code>, and{" "}
          <code>{`{file:path}`}</code> placeholders. Instance secrets live under{" "}
          <code>data/secrets/</code> and the settings UI can create them without leaving plaintext
          tokens in <code>codeplane.jsonc</code>. See{" "}
          <Link href="/docs/providers/">Providers</Link> for model overrides, OAuth, and custom
          OpenAI-compatible endpoints.
        </p>

        <h2>permission</h2>
        <pre><code>{`"permission": {
  "read": "allow",
  "edit": {
    "*": "ask",
    "**/*.lock": "deny"
  },
  "bash": {
    "git diff*": "allow",
    "git log*": "allow",
    "bun test*": "allow",
    "*": "ask"
  }
}`}</code></pre>
        <p>Full grammar at <Link href="/docs/permissions/">Permissions</Link>.</p>

        <h2>tools</h2>
        <pre><code>{`"tools": {
  "browser": true,
  "computer": true
}`}</code></pre>
        <p>
          Use <code>tools</code> for simple global on/off switches. Both <code>browser</code> and
          <code>computer</code> are <strong>disabled by default</strong>. Set either to
          <code>true</code> to enable it. <code>browser</code> controls the Desktop-only Chrome
          automation tool. <code>computer</code> controls native desktop mouse, keyboard, and
          screenshot access.
        </p>

        <h2>agent</h2>
        <pre><code>{`"agent": {
  "build": {
    "description": "Implement features, edit files, run tests.",
    "model":  "anthropic/claude-sonnet-4-6",
    "prompt": "You are a careful senior engineer..."
  },
  "review": {
    "description": "Read-only code reviewer.",
    "model":  "anthropic/claude-opus-4-7",
    "permission": { "edit": "deny", "bash": "deny" }
  }
}`}</code></pre>
        <p>
          Agent files can also live under <code>agents/*.md</code> or <code>.codeplane/agents/*.md</code>.
          Frontmatter supplies keys such as <code>model</code>, <code>mode</code>, <code>steps</code>,
          <code>color</code>, and <code>permission</code>; the Markdown body becomes the prompt.
        </p>

        <h2>mode</h2>
        <pre><code>{`"mode": {
  "plan": {
    "description": "Think first, no file edits.",
    "permission": { "edit": "deny", "bash": "deny" },
    "prompt": "Produce a step-by-step plan before any action..."
  }
}`}</code></pre>

        <h2>mcp</h2>
        <pre><code>{`"mcp": {
  "filesystem": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Code"],
    "environment": { "LOG_LEVEL": "warn" },
    "timeout": 30000
  },
  "remote-docs": {
    "type": "remote",
    "url": "https://mcp.example.com/sse",
    "headers": { "Authorization": "{secret:mcp-authorization}" },
    "oauth": false
  }
}`}</code></pre>
        <p>Full reference at <Link href="/docs/mcp/">MCP servers</Link>.</p>

        <h2>secret placeholders</h2>
        <pre><code>{`{
  "provider": {
    "github": {
      "options": {
        "apiKey": "{secret:github-token}"
      }
    }
  },
  "mcp": {
    "cloudflare": {
      "type": "local",
      "command": ["npx", "-y", "@cloudflare/mcp-server-cloudflare", "run"],
      "environment": {
        "CLOUDFLARE_API_TOKEN": "{secret:cloudflare-token}"
      }
    }
  }
}`}</code></pre>
        <p>
          <code>{`{secret:name}`}</code> reads from <code>data/secrets/name</code> inside the
          current instance. Codeplane resolves the real value only when it loads config or spawns
          the MCP server, so shared config files and screenshots do not leak the plaintext secret.
        </p>

        <h2>plugin and instructions</h2>
        <pre><code>{`"plugin": [
  "./plugins/company-tools.ts",
  ["@my-org/codeplane-plugin", { "tenant": "prod" }]
],
"instructions": [
  "AGENTS.md",
  ".codeplane/security.md",
  "docs/engineering/**/*.md"
]`}</code></pre>
        <p>
          Relative plugin paths are resolved relative to the config file that declared them. The
          instruction list supplements the built-in discovery of <code>AGENTS.md</code> and
          compatible project instruction files.
        </p>

        <h2>command</h2>
        <pre><code>{`"command": {
  "fix-tests": {
    "template": "Find the failing tests, fix the root cause, and rerun the smallest reliable test command.",
    "description": "Repair a broken test suite",
    "agent": "build",
    "model": "anthropic/claude-sonnet-4-6",
    "subtask": false
  }
}`}</code></pre>
        <p>
          Commands are prompt templates. You can define them inline, or place Markdown files under
          <code>commands/*.md</code> or <code>.codeplane/commands/*.md</code>; frontmatter supplies
          <code>description</code>, <code>agent</code>, <code>model</code>, and
          <code>subtask</code>, while the Markdown body becomes <code>template</code>.
        </p>

        <h2>runtime behavior</h2>
        <table>
          <thead><tr><th>Key</th><th>Values</th><th>Use it for</th></tr></thead>
          <tbody>
            <tr><td><code>share</code></td><td><code>manual</code>, <code>auto</code>, <code>disabled</code></td><td>Control public session sharing.</td></tr>
            <tr><td><code>autoupdate</code></td><td><code>true</code>, <code>false</code>, <code>notify</code></td><td>Auto-install patches or show update notifications.</td></tr>
            <tr><td><code>commit.coauthor</code></td><td><code>true</code>, <code>false</code></td><td>Add <code>Co-Authored-By: codeplaneai[bot] &lt;287208015+codeplaneai[bot]@users.noreply.github.com&gt;</code> so GitHub shows the <a href="https://github.com/apps/codeplaneai">CodeplaneAI app</a> as a co-author.</td></tr>
            <tr><td><code>snapshot</code></td><td><code>true</code>, <code>false</code></td><td>Enable filesystem snapshots for revert/undo.</td></tr>
            <tr><td><code>tool_output.max_lines</code></td><td>positive integer</td><td>Truncate long tool output previews after this many lines.</td></tr>
            <tr><td><code>tool_output.max_bytes</code></td><td>positive integer</td><td>Truncate long tool output previews after this many bytes.</td></tr>
            <tr><td><code>compaction.auto</code></td><td><code>true</code>, <code>false</code></td><td>Compact automatically when context is full.</td></tr>
            <tr><td><code>compaction.prune</code></td><td><code>true</code>, <code>false</code></td><td>Prune old tool outputs during compaction.</td></tr>
          </tbody>
        </table>

        <h2>Validating</h2>
        <pre><code>{`jq . codeplane.json && \\
  curl -fsSL https://codeplane.cc/config.json | \\
  npx ajv-cli validate -s /dev/stdin -d codeplane.json`}</code></pre>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
