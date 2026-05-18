import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Providers",
  description: "Configure Codeplane model providers, API keys, OAuth sign-in, model defaults, custom OpenAI-compatible endpoints, and provider troubleshooting.",
  alternates: { canonical: "/docs/providers/" },
  openGraph: {
    title: "Providers · Codeplane",
    description: "Configure Codeplane model providers, API keys, OAuth sign-in, model defaults, custom OpenAI-compatible endpoints, and provider troubleshooting.",
    url: "/docs/providers/",
    type: "article",
  },
  twitter: {
    title: "Providers · Codeplane",
    description: "Configure Codeplane model providers, API keys, OAuth sign-in, model defaults, custom OpenAI-compatible endpoints, and provider troubleshooting.",
    card: "summary_large_image",
  },
}

export default function Providers() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/providers/">
        <h1>Providers</h1>
        <p className="lede">
          Codeplane loads the model catalog from <code>models.dev</code>, merges your local
          <code>provider</code> config over it, and exposes connected providers through
          <code>GET /provider</code>. You can use API keys, provider-specific OAuth hooks, or any
          OpenAI-compatible endpoint.
        </p>

        <h2>Fast path</h2>
        <pre><code>{`export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export OPENROUTER_API_KEY=sk-or-...

codeplane web --port 4096`}</code></pre>
        <p>
          The UI reads provider auth methods from <code>GET /provider/auth</code>. Providers with
          OAuth hooks show a sign-in flow; providers that need static credentials use API-key
          prompts or environment variables.
        </p>

        <h2>Persistent config</h2>
        <pre><code>{`{
  "$schema": "https://codeplane.cc/config.json",
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "openai/gpt-5.2-mini",
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "{env:ANTHROPIC_API_KEY}",
        "timeout": 300000
      }
    },
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}",
        "baseURL": "{env:OPENAI_BASE_URL}"
      }
    }
  }
}`}</code></pre>
        <p>
          Provider IDs and model IDs use slash form: <code>provider/model</code>. Environment
          placeholders keep secrets out of the config file and are resolved at runtime.
        </p>

        <h2>Provider config keys</h2>
        <table>
          <thead><tr><th>Key</th><th>Where</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>api</code></td><td>provider</td><td>Provider API style from the catalog.</td></tr>
            <tr><td><code>name</code></td><td>provider</td><td>Display name shown in selectors.</td></tr>
            <tr><td><code>env</code></td><td>provider</td><td>Environment variable names that may satisfy auth.</td></tr>
            <tr><td><code>npm</code></td><td>provider</td><td>Optional provider package used by the AI SDK layer.</td></tr>
            <tr><td><code>whitelist</code></td><td>provider</td><td>Only expose selected model IDs.</td></tr>
            <tr><td><code>blacklist</code></td><td>provider</td><td>Hide selected model IDs.</td></tr>
            <tr><td><code>options.apiKey</code></td><td>provider options</td><td>Static credential or <code>{`{env:VAR}`}</code> placeholder.</td></tr>
            <tr><td><code>options.baseURL</code></td><td>provider options</td><td>Custom base URL for OpenAI-compatible endpoints.</td></tr>
            <tr><td><code>options.enterpriseUrl</code></td><td>provider options</td><td>GitHub Enterprise URL for Copilot auth.</td></tr>
            <tr><td><code>options.timeout</code></td><td>provider options</td><td>Request timeout in milliseconds, or <code>false</code> to disable.</td></tr>
            <tr><td><code>models</code></td><td>provider</td><td>Local model overrides or fully custom model definitions.</td></tr>
          </tbody>
        </table>

        <h2>Custom OpenAI-compatible endpoint</h2>
        <pre><code>{`{
  "provider": {
    "local-vllm": {
      "name": "Local vLLM",
      "api": "openai",
      "options": {
        "baseURL": "http://127.0.0.1:8000/v1",
        "apiKey": "not-used"
      },
      "models": {
        "qwen3-coder": {
          "name": "Qwen3 Coder",
          "limit": { "context": 131072, "output": 8192 },
          "tool_call": true,
          "reasoning": false,
          "temperature": true
        }
      }
    }
  },
  "model": "local-vllm/qwen3-coder"
}`}</code></pre>
        <p>
          Keep the provider ID stable. Sessions persist the selected model ID, so renaming
          <code>local-vllm</code> later can make old sessions point at a missing provider.
        </p>

        <h2>Model controls</h2>
        <ul>
          <li><strong><code>model</code></strong> sets the default model for normal sessions.</li>
          <li><strong><code>small_model</code></strong> is used for lightweight work such as titles and summaries.</li>
          <li><strong><code>disabled_providers</code></strong> hides catalog providers you never use.</li>
          <li><strong><code>enabled_providers</code></strong> switches to allow-list mode: only listed provider IDs remain visible.</li>
          <li><strong><code>provider.*.models.*.variants</code></strong> can disable or tune model variants without copying the whole catalog entry.</li>
        </ul>

        <h2>OAuth and API-key auth</h2>
        <p>
          Provider sign-in is plugin-backed. The server asks each loaded provider auth hook for
          methods, then stores successful credentials in the Codeplane auth store under the provider
          ID. OAuth methods may use browser callbacks or copy-code flows, depending on what the
          upstream provider supports.
        </p>
        <table>
          <thead><tr><th>Endpoint</th><th>What the UI does with it</th></tr></thead>
          <tbody>
            <tr><td><code>GET /provider/auth</code></td><td>Lists auth methods and prompt fields per provider.</td></tr>
            <tr><td><code>POST /provider/:id/oauth/authorize</code></td><td>Creates the provider authorization URL.</td></tr>
            <tr><td><code>POST /provider/:id/oauth/callback</code></td><td>Stores the OAuth access/refresh token or API key returned by the hook.</td></tr>
          </tbody>
        </table>

        <h2>Troubleshooting</h2>
        <table>
          <thead><tr><th>Symptom</th><th>Check</th><th>Fix</th></tr></thead>
          <tbody>
            <tr><td>Provider missing from selector</td><td><code>GET /provider</code> and <code>enabled_providers</code>/<code>disabled_providers</code></td><td>Remove the filter or add the provider ID to the allow-list.</td></tr>
            <tr><td>Model missing</td><td>Provider <code>whitelist</code>, <code>blacklist</code>, model status</td><td>Update filters or enable experimental models only when you intentionally want alpha entries.</td></tr>
            <tr><td>401 from provider</td><td>Resolved env var and auth store</td><td>Regenerate the key, restart the server, or re-run the OAuth sign-in.</td></tr>
            <tr><td>Stream stalls</td><td><code>options.timeout</code> and proxy idle timeouts</td><td>Increase provider timeout or remove a reverse proxy that buffers SSE.</td></tr>
            <tr><td>Wrong endpoint</td><td><code>options.baseURL</code></td><td>Use the API root ending in <code>/v1</code> for OpenAI-compatible servers.</td></tr>
          </tbody>
        </table>

        <p>
          Full config shape: <Link href="/docs/configuration/">Configuration</Link>. Direct endpoint
          calls: <Link href="/docs/api/">HTTP API</Link>.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
