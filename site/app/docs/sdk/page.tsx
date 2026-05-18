import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "TypeScript SDK" }

export default function SDK() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/sdk/">
        <h1>TypeScript SDK</h1>
        <p className="lede">Drive Codeplane from your own code. The SDK wraps the <Link href="/docs/api/">HTTP API</Link> with typed methods, streaming helpers, and an event subscription primitive.</p>

        <h2>Install</h2>
        <pre><code>{`npm install @codeplane-ai/sdk
# or
bun add @codeplane-ai/sdk`}</code></pre>

        <h2>Connect</h2>
        <pre><code>{`import { Codeplane } from "@codeplane-ai/sdk/v2"

const client = new Codeplane({
  baseURL: "http://localhost:4096",
  // token: process.env.CODEPLANE_TOKEN,
})

const projects = await client.project.list()
console.log(projects)`}</code></pre>

        <h2>Common operations</h2>

        <h3>Create a session + send a message</h3>
        <pre><code>{`const project = await client.project.create({ directory: "/Users/me/Code/myrepo" })
const session = await client.session.create({ projectID: project.id })

const stream = client.session.send({
  sessionID: session.id,
  text:      "Add a /healthz endpoint to the server.",
})

for await (const event of stream) {
  if (event.type === "text") process.stdout.write(event.delta)
  if (event.type === "tool")  console.log("[tool]", event.name, event.input)
  if (event.type === "done")  break
}`}</code></pre>

        <h3>Subscribe to live updates</h3>
        <pre><code>{`const unsubscribe = client.event.listen((event) => {
  if (event.details.type === "permission.asked") {
    client.permission.respond({
      sessionID:    event.details.properties.sessionID,
      permissionID: event.details.properties.id,
      response:     "always",
    })
  }
})

// Later
unsubscribe()`}</code></pre>

        <h3>List + replay history</h3>
        <pre><code>{`const sessions = await client.session.list({ projectID: project.id })
for (const s of sessions) {
  const messages = await client.message.list({ sessionID: s.id })
  console.log(s.title, messages.length, "messages")
}`}</code></pre>

        <h2>API surface</h2>
        <table>
          <thead><tr><th>Namespace</th><th>What it manages</th></tr></thead>
          <tbody>
            <tr><td><code>client.project</code></td><td>Worktrees.</td></tr>
            <tr><td><code>client.session</code></td><td>Threads: <code>send</code> (streaming), <code>abort</code>, <code>archive</code>, <code>share</code>.</td></tr>
            <tr><td><code>client.message</code></td><td>Read history; replay events.</td></tr>
            <tr><td><code>client.permission</code></td><td>List pending requests, respond.</td></tr>
            <tr><td><code>client.config</code></td><td>Read + patch <code>codeplane.json</code> remotely.</td></tr>
            <tr><td><code>client.agent</code> / <code>client.mode</code></td><td>Inspect available agents and modes.</td></tr>
            <tr><td><code>client.event</code></td><td>SSE subscription primitive.</td></tr>
          </tbody>
        </table>

        <p>Source: <a href="https://github.com/devinoldenburg/codeplane/tree/main/packages/sdk">packages/sdk</a>.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
