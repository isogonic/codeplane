import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Plugins",
  description: "Build Codeplane plugins with @codeplane-ai/plugin: tools, auth hooks, provider hooks, event hooks, chat transforms, permission hooks, and workspace adapters.",
  alternates: { canonical: "/docs/plugins/" },
  openGraph: {
    title: "Plugins · Codeplane",
    description: "Build Codeplane plugins with @codeplane-ai/plugin: tools, auth hooks, provider hooks, event hooks, chat transforms, permission hooks, and workspace adapters.",
    url: "/docs/plugins/",
    type: "article",
  },
  twitter: {
    title: "Plugins · Codeplane",
    description: "Build Codeplane plugins with @codeplane-ai/plugin: tools, auth hooks, provider hooks, event hooks, chat transforms, permission hooks, and workspace adapters.",
    card: "summary_large_image",
  },
}

export default function Plugins() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/plugins/">
        <h1>Plugins</h1>
        <p className="lede">
          Plugins are TypeScript or JavaScript modules that export a <code>server</code> function.
          The function receives the SDK client, project metadata, directory paths, a Bun shell
          helper, and returns hooks for tools, auth, provider catalogs, chat events, permissions,
          shell env, and workspace adapters.
        </p>

        <h2>What a plugin can do</h2>
        <ul>
          <li><strong>Add tools</strong> through the <code>tool</code> hook.</li>
          <li><strong>Add provider auth</strong> through <code>auth</code> hooks and OAuth/API-key methods.</li>
          <li><strong>Extend provider catalogs</strong> through <code>provider</code> hooks.</li>
          <li><strong>Observe and transform chat</strong> through <code>chat.message</code>, <code>chat.params</code>, and <code>chat.headers</code>.</li>
          <li><strong>Adjust permissions</strong> before prompts through <code>permission.ask</code>.</li>
          <li><strong>Provide workspace adapters</strong> through <code>experimental_workspace.register</code>.</li>
        </ul>
        <p>For standalone external tools that already speak MCP, prefer <Link href="/docs/mcp/">MCP</Link>.</p>

        <h2>Hello-world tool plugin</h2>
        <pre><code>{`import { tool } from "@codeplane-ai/plugin"

export const server = async () => ({
  tool: {
    weather: tool({
      description: "Look up the current weather for a city.",
      args: {
        city: tool.schema.string().describe("City name, for example Berlin"),
      },
      async execute(args, context) {
        context.metadata({ title: "Weather" })
        const res = await fetch(\`https://wttr.in/\${args.city}?format=3\`)
        return await res.text()
      },
    }),
  },
})`}</code></pre>

        <h2>Loading plugins</h2>
        <p>Drop files in one of the plugin folders:</p>
        <ul>
          <li><code>~/.config/Codeplane/plugins/*.ts</code> for user-wide plugins on Linux.</li>
          <li><code>~/Library/Application Support/Codeplane/plugins/*.ts</code> on macOS.</li>
          <li><code>&lt;project&gt;/.codeplane/plugins/*.ts</code> for project-local plugins.</li>
        </ul>
        <p>Or declare npm/file specs in config:</p>
        <pre><code>{`{
  "plugin": [
    "@my-org/codeplane-tools",
    ["@my-org/codeplane-tools", { "tenant": "prod" }],
    "./plugins/local-tools.ts"
  ]
}`}</code></pre>
        <p>
          Relative plugin paths are resolved relative to the config file that declares them. Run
          <code>codeplane --pure</code> to debug with external plugins disabled.
        </p>

        <h2>OpenCode plugin compatibility</h2>
        <p>
          Codeplane can load OpenCode-style plugins from Codeplane plugin folders. Drop the file
          into the instance <code>plugins/</code> directory or a project <code>.codeplane/plugins/</code>
          directory, and imports from <code>@opencode-ai/plugin</code> resolve to Codeplane's
          compatible plugin SDK.
        </p>
        <pre><code>{`import { tool } from "@opencode-ai/plugin"

export const OpenCodeToolPlugin = async () => ({
  tool: {
    hello: tool({
      description: "Say hello from an OpenCode-style plugin.",
      args: {
        name: tool.schema.string(),
      },
      async execute(args) {
        return \`Hello \${args.name}\`
      },
    }),
  },
})`}</code></pre>
        <p>
          Drop OpenCode-style plugins into Codeplane plugin locations such as
          <code>config/plugins/</code> or <code>.codeplane/plugins/</code>. Codeplane provides
          compatibility shims for <code>@opencode-ai/plugin</code> and <code>@opencode-ai/sdk</code>
          imports without reading OpenCode config folders.
        </p>

        <h2>Tool context</h2>
        <table>
          <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>sessionID</code></td><td>Current session.</td></tr>
            <tr><td><code>messageID</code></td><td>Message that owns the tool call.</td></tr>
            <tr><td><code>agent</code></td><td>Current agent ID.</td></tr>
            <tr><td><code>directory</code></td><td>Current project directory. Prefer this over <code>process.cwd()</code>.</td></tr>
            <tr><td><code>worktree</code></td><td>Project worktree root.</td></tr>
            <tr><td><code>abort</code></td><td>Abort signal for cancellation.</td></tr>
            <tr><td><code>metadata</code></td><td>Set title/metadata for the tool call UI.</td></tr>
            <tr><td><code>ask</code></td><td>Request a permission decision from the user.</td></tr>
          </tbody>
        </table>

        <h2>Auth hook shape</h2>
        <pre><code>{`export const server = async () => ({
  auth: {
    provider: "internal-ai",
    methods: [
      {
        type: "api",
        label: "API key",
        prompts: [{ type: "text", key: "apiKey", message: "API key" }],
        async authorize(inputs) {
          return { type: "success", key: inputs!.apiKey }
        },
      },
    ],
  },
})`}</code></pre>
        <p>
          OAuth methods return an authorization URL and either an automatic callback or a
          copy-code callback. Successful callbacks store API keys or OAuth access/refresh tokens
          under the provider ID.
        </p>

        <h2>Hook reference</h2>
        <table>
          <thead><tr><th>Hook</th><th>Use</th></tr></thead>
          <tbody>
            <tr><td><code>event</code></td><td>Observe server events.</td></tr>
            <tr><td><code>config</code></td><td>Inspect resolved config.</td></tr>
            <tr><td><code>tool</code></td><td>Register custom tools.</td></tr>
            <tr><td><code>auth</code></td><td>Register provider auth methods.</td></tr>
            <tr><td><code>provider</code></td><td>Add or modify provider model catalogs.</td></tr>
            <tr><td><code>chat.message</code></td><td>Observe new user messages and parts.</td></tr>
            <tr><td><code>chat.params</code></td><td>Modify LLM parameters before a request.</td></tr>
            <tr><td><code>chat.headers</code></td><td>Modify provider request headers.</td></tr>
            <tr><td><code>permission.ask</code></td><td>Override ask/allow/deny before a prompt.</td></tr>
            <tr><td><code>shell.env</code></td><td>Inject env vars into shell tool calls.</td></tr>
            <tr><td><code>tool.definition</code></td><td>Modify tool descriptions and schemas sent to the model.</td></tr>
          </tbody>
        </table>

        <h2>Distribution</h2>
        <p>
          Publish plugins as normal npm packages, or keep them as project-local files. If a plugin
          affects auth, tools, or shell environment, document the required env vars next to the
          repo config so teammates can reproduce it.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
