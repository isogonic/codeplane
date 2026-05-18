import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "TypeScript SDK",
  description: "Drive Codeplane from TypeScript: generated clients, local server helpers, Basic Auth headers, directory routing, events, and SDK regeneration.",
  alternates: { canonical: "/docs/sdk/" },
  openGraph: {
    title: "TypeScript SDK · Codeplane",
    description: "Drive Codeplane from TypeScript: generated clients, local server helpers, Basic Auth headers, directory routing, events, and SDK regeneration.",
    url: "/docs/sdk/",
    type: "article",
  },
  twitter: {
    title: "TypeScript SDK · Codeplane",
    description: "Drive Codeplane from TypeScript: generated clients, local server helpers, Basic Auth headers, directory routing, events, and SDK regeneration.",
    card: "summary_large_image",
  },
}

export default function SDK() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/sdk/">
        <h1>TypeScript SDK</h1>
        <p className="lede">
          <code>@codeplane-ai/sdk</code> is generated from the server OpenAPI metadata and wrapped
          with helpers for directory routing, local server startup, and response compatibility
          checks.
        </p>

        <h2>Install</h2>
        <pre><code>{`npm install @codeplane-ai/sdk
# or
bun add @codeplane-ai/sdk`}</code></pre>

        <h2>Connect to an existing server</h2>
        <pre><code>{`import { createCodeplaneClient } from "@codeplane-ai/sdk/v2"

const client = createCodeplaneClient({
  baseUrl: "http://127.0.0.1:4096",
  headers: {
    Authorization: "Basic " + Buffer.from("codeplane:" + process.env.CODEPLANE_SERVER_PASSWORD).toString("base64"),
  },
})

const health = await client.global.health()
console.log(health)`}</code></pre>
        <p>
          Use <code>baseUrl</code>, not <code>baseURL</code>. If the server uses Basic Auth, send a
          normal <code>Authorization: Basic ...</code> header.
        </p>

        <h2>Route requests to a directory</h2>
        <pre><code>{`const client = createCodeplaneClient({
  baseUrl: "http://127.0.0.1:4096",
  directory: "/Users/me/Code/app",
})

const project = await client.project.current()`}</code></pre>
        <p>
          The SDK sets <code>x-codeplane-directory</code> and rewrites it into query params where
          older server routes expect them. For workspace-mode experiments, pass
          <code>experimental_workspaceID</code>.
        </p>

        <h2>Start an embedded local server</h2>
        <pre><code>{`import { createCodeplane } from "@codeplane-ai/sdk/v2"

const { client, server } = await createCodeplane({
  port: 0,
  hostname: "127.0.0.1",
})

try {
  console.log(await client.global.version())
} finally {
  await server.stop()
}`}</code></pre>

        <h2>Common operations</h2>
        <table>
          <thead><tr><th>Namespace</th><th>What it manages</th></tr></thead>
          <tbody>
            <tr><td><code>client.global</code></td><td>Health, version, update metadata, global event stream.</td></tr>
            <tr><td><code>client.project</code></td><td>Project list/current/update/git init.</td></tr>
            <tr><td><code>client.session</code></td><td>Session list/get/create/delete/status and higher-level session actions.</td></tr>
            <tr><td><code>client.permission</code></td><td>Pending approvals and replies.</td></tr>
            <tr><td><code>client.question</code></td><td>Pending question prompts and replies.</td></tr>
            <tr><td><code>client.config</code></td><td>Resolved config and config updates.</td></tr>
            <tr><td><code>client.provider</code></td><td>Provider catalog, auth methods, OAuth authorize/callback.</td></tr>
            <tr><td><code>client.mcp</code></td><td>Configured MCP server status.</td></tr>
          </tbody>
        </table>

        <h2>Events</h2>
        <p>
          Generated SDK methods cover JSON endpoints. For low-level SSE, connect directly to
          <code>/event</code> or use the generated event helpers exposed by the current SDK build.
          Reconnect with <code>Last-Event-ID</code> to use server replay.
        </p>

        <h2>Regenerating the SDK</h2>
        <pre><code>{`bun --cwd packages/sdk/js script/build.ts`}</code></pre>
        <p>
          The script asks the CLI to generate the OpenAPI spec, then regenerates both SDK surfaces.
          Run it after route, schema, or version changes that affect generated output.
        </p>

        <h2>When to use raw HTTP instead</h2>
        <ul>
          <li>You are debugging server route behavior and need exact request/response payloads.</li>
          <li>You are using another language.</li>
          <li>You are testing a route not yet represented in the generated client.</li>
        </ul>
        <p>Raw endpoint map: <Link href="/docs/api/">HTTP API</Link>.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
