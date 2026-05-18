import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Plugins",
  description: "Build custom tools, agents, slash commands, and prompts for Codeplane with the @codeplane-ai/plugin SDK.",
  alternates: { canonical: "/docs/plugins/" },
  openGraph: {
    title: "Plugins · Codeplane",
    description: "Build custom tools, agents, slash commands, and prompts for Codeplane with the @codeplane-ai/plugin SDK.",
    url: "/docs/plugins/",
    type: "article",
  },
  twitter: {
    title: "Plugins · Codeplane",
    description: "Build custom tools, agents, slash commands, and prompts for Codeplane with the @codeplane-ai/plugin SDK.",
    card: "summary_large_image",
  },
}

export default function Plugins() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/plugins/">
        <h1>Plugins</h1>
        <p className="lede">Write your own tools, agents, or prompt presets that load into every Codeplane session. Plugins are plain TypeScript modules registered via <code>@codeplane-ai/plugin</code>.</p>

        <h2>What a plugin can do</h2>
        <ul>
          <li><strong>Add tools</strong> — first-class entries in the agent&apos;s tool registry.</li>
          <li><strong>Add agents</strong> — named personas with their own prompt, model, tool overrides.</li>
          <li><strong>Add prompts</strong> — reusable slash-commands.</li>
          <li><strong>Hook events</strong> — session lifecycle, message stream, permission grant.</li>
        </ul>
        <p>For tools that already exist as MCP servers, prefer <Link href="/docs/mcp/">MCP</Link>.</p>

        <h2>Hello-world plugin</h2>
        <pre><code>{`import { definePlugin, tool } from "@codeplane-ai/plugin"

export default definePlugin({
  id: "my-org.weather",
  version: "0.1.0",
  tools: [
    tool({
      name: "weather",
      description: "Look up the current weather for a city.",
      input: { city: { type: "string", required: true } },
      async run({ input }) {
        const res = await fetch(\`https://wttr.in/\${input.city}?format=3\`)
        return { content: await res.text() }
      },
    }),
  ],
})`}</code></pre>

        <h2>Loading a plugin</h2>
        <p>Drop the file in <code>~/.codeplane/plugins/weather.ts</code> (user-wide) or <code>&lt;project&gt;/.codeplane/plugins/weather.ts</code> (per-project).</p>
        <p>Or import from npm:</p>
        <pre><code>{`// codeplane.json
{
  "plugins": ["@my-org/codeplane-weather"]
}`}</code></pre>

        <h2>Permission model</h2>
        <p>Plugin tools land in the same permission flow as everything else — the user sees <em>Allow / Deny / Always</em> on first call, persisted under session or directory scope.</p>

        <h2>The full API</h2>
        <p>Type-complete: <code>definePlugin</code>, <code>tool</code>, <code>agent</code>, <code>prompt</code>, <code>onSession</code>, <code>onMessage</code>, <code>onPermission</code>. Full reference at <Link href="/docs/sdk/">TypeScript SDK</Link>. Source + examples at <a href="https://github.com/devinoldenburg/codeplane/tree/main/packages/plugin">packages/plugin</a>.</p>

        <h2>Distributing</h2>
        <p>Publish as a regular npm package; users add the name to <code>&quot;plugins&quot;</code> in their <code>codeplane.json</code>. Codeplane verifies plugin signatures when shipped via <code>codeplane.lock</code> (opt-in).</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
