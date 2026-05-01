import { _electron as electron, expect, test, type TestInfo } from "@playwright/test"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"
import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const appVersion = CodeplaneVersion

type SavedInstance = {
  id: string
  url: string
  label?: string
  headers?: Record<string, string>
  ignoreCertificateErrors?: boolean
}

type DesktopLogEntry = {
  ts: string
  pid: number
  scope: string
  event: string
  data?: unknown
}

type RequestLogEntry = {
  cookie: string
  method: string
  origin: string
  pathname: string
  ts: string
}

const exists = (input: string) => fs.access(input).then(() => true).catch(() => false)

function createLineWriter(file: string) {
  let writes = Promise.resolve()

  const write = (entry: unknown) => {
    writes = writes.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`)
    })
  }

  return {
    file,
    write,
    flush: () => writes,
  }
}

async function readJsonLines<T>(file: string) {
  if (!(await exists(file))) return [] as T[]
  const text = await fs.readFile(file, "utf8")
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

async function readDesktopEntries(file: string) {
  return readJsonLines<DesktopLogEntry>(file)
}

async function attachIfExists(testInfo: TestInfo, name: string, file: string, contentType = "application/x-ndjson") {
  if (!(await exists(file))) return
  await testInfo.attach(name, { path: file, contentType })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function createFixtureAssets(version: string, label: string) {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${label}</title>
    <link rel="stylesheet" href="/assets/app.css" />
    <script type="module" src="/assets/app.js"></script>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">Desktop Fixture</p>
        <h1>${label}</h1>
        <p data-testid="fixture-server-version">${version}</p>
        <p data-testid="fixture-providers">loading</p>
        <p data-testid="fixture-theme">loading</p>
        <p data-testid="fixture-path">loading</p>
        <p data-testid="fixture-project-api">loading</p>
        <p data-testid="fixture-provider-api">loading</p>
        <p data-testid="fixture-file-list">loading</p>
        <p data-testid="fixture-find-files">loading</p>
      </header>
      <nav class="actions">
        <button data-testid="fixture-home">Home</button>
        <button data-testid="fixture-projects">Projects</button>
        <button data-testid="fixture-settings">Settings</button>
      </nav>
      <section class="panel">
        <p data-testid="fixture-view">boot</p>
      </section>
    </main>
  </body>
</html>`

  const css = `:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
body {
  margin: 0;
  background: #f5f5f7;
  color: #111827;
}
.shell {
  min-height: 100vh;
  padding: 32px;
}
.hero, .panel {
  background: white;
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
}
.eyebrow {
  margin: 0 0 8px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 12px;
  margin: 20px 0;
}
button {
  appearance: none;
  border: 0;
  border-radius: 999px;
  background: #111827;
  color: white;
  padding: 10px 16px;
  font: inherit;
  cursor: pointer;
}`

const js = `const version = ${JSON.stringify(version)};
const label = ${JSON.stringify(label)};
const themePath = "/assets/themes/amoled.json";
const updateView = (value) => {
  const view = document.querySelector('[data-testid="fixture-view"]');
  if (view) view.textContent = value;
  console.log("fixture:view", value);
};
const setStatus = (id, value) => {
  const node = document.querySelector('[data-testid="' + id + '"]');
  if (node) node.textContent = value;
};
const fetchJson = async (id, url, init, format) => {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    setStatus(id, response.ok ? format(data) : "http:" + response.status);
    console.log("fixture:api", id, response.status);
  } catch (error) {
    setStatus(id, "error");
    console.error("fixture:api:error", id, error);
  }
};

window.addEventListener("DOMContentLoaded", async () => {
  console.log("fixture:init", version, label);
  document.querySelector('[data-testid="fixture-home"]')?.addEventListener("click", () => updateView("home"));
  document.querySelector('[data-testid="fixture-projects"]')?.addEventListener("click", () => updateView("projects"));
  document.querySelector('[data-testid="fixture-settings"]')?.addEventListener("click", () => updateView("settings"));

  try {
    const response = await fetch("/config/providers");
    const providers = await response.json();
    const providerNode = document.querySelector('[data-testid="fixture-providers"]');
    if (providerNode) {
      const count = Array.isArray(providers?.providers)
        ? providers.providers.length
        : Array.isArray(providers)
          ? providers.length
          : Object.keys(providers || {}).length;
      providerNode.textContent = response.ok ? "ok:" + count : "http:" + response.status;
    }
    console.log("fixture:providers", response.status);
  } catch (error) {
    const providerNode = document.querySelector('[data-testid="fixture-providers"]');
    if (providerNode) providerNode.textContent = "error";
    console.error("fixture:providers:error", error);
  }

  try {
    const response = await fetch(themePath);
    const theme = await response.json();
    const themeNode = document.querySelector('[data-testid="fixture-theme"]');
    if (themeNode) themeNode.textContent = response.ok ? "ok:" + Object.keys(theme).length : "http:" + response.status;
    console.log("fixture:theme", response.status, Object.keys(theme).length);
  } catch (error) {
    const themeNode = document.querySelector('[data-testid="fixture-theme"]');
    if (themeNode) themeNode.textContent = "error";
    console.error("fixture:theme:error", error);
  }

  await fetchJson("fixture-path", "/path", undefined, (data) => "ok:" + [data?.home, data?.directory].filter(Boolean).join("|"));
  await fetchJson("fixture-project-api", "/project", undefined, (data) => "ok:" + (Array.isArray(data) ? data.length : 0));
  await fetchJson("fixture-provider-api", "/provider", undefined, (data) => "ok:" + (Array.isArray(data?.all) ? data.all.length : 0));
  await fetchJson(
    "fixture-file-list",
    "/file/list",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory: "/workspace", path: "" }),
    },
    (data) => "ok:" + (Array.isArray(data) ? data.length : 0),
  );
  await fetchJson(
    "fixture-find-files",
    "/find/files",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory: "/workspace", query: "", type: "directory", limit: 10 }),
    },
    (data) => "ok:" + (Array.isArray(data) ? data.length : 0),
  );
});`

  return { css, html, js }
}

async function startFixtureServer(
  testInfo: TestInfo,
  slug: string,
  version: string,
  label: string,
  options?: { assetDelayMs?: number },
) {
  const assets = createFixtureAssets(version, label)
  const writer = createLineWriter(testInfo.outputPath(`${slug}-server.log`))
  const sendJson = (response: http.ServerResponse<http.IncomingMessage>, body: unknown, gzip = false) => {
    const payload = Buffer.from(`${JSON.stringify(body)}\n`)
    if (!gzip) {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      response.end(payload)
      return
    }
    response.writeHead(200, {
      "Content-Encoding": "gzip",
      "Content-Type": "application/json; charset=utf-8",
    })
    response.end(gzipSync(payload))
  }
  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`)
      writer.write({
        cookie: request.headers.cookie ?? "",
        method: request.method ?? "GET",
        origin: request.headers.origin ?? "",
        pathname: url.pathname,
        ts: new Date().toISOString(),
      })

      if (url.pathname === "/global/version") {
        sendJson(response, { current: version })
        return
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        response.end(assets.html)
        return
      }

      if (url.pathname === "/config/providers") {
        if (options?.assetDelayMs) await sleep(options.assetDelayMs)
        sendJson(response, { providers: ["logicplanes"] })
        return
      }

      if (url.pathname === "/path") {
        sendJson(response, { home: "/workspace", directory: "/workspace" }, true)
        return
      }

      if (url.pathname === "/project") {
        sendJson(
          response,
          [{ id: "workspace", worktree: "/workspace", time: { created: 0, updated: 0 }, sandboxes: ["/workspace/codeplane"] }],
          true,
        )
        return
      }

      if (url.pathname === "/provider") {
        sendJson(response, { all: [{ id: "logicplanes" }], enabled: [{ id: "logicplanes" }] }, true)
        return
      }

      if (url.pathname === "/file/list") {
        sendJson(
          response,
          [
            { name: "codeplane", absolute: "/workspace/codeplane", type: "directory" },
            { name: "tunnel-mcp", absolute: "/workspace/tunnel-mcp", type: "directory" },
          ],
          true,
        )
        return
      }

      if (url.pathname === "/find/files") {
        sendJson(response, ["codeplane", "tunnel-mcp"], true)
        return
      }

      if (url.pathname === "/assets/app.css") {
        if (options?.assetDelayMs) await sleep(options.assetDelayMs)
        response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" })
        response.end(assets.css)
        return
      }

      if (url.pathname === "/assets/app.js") {
        if (options?.assetDelayMs) await sleep(options.assetDelayMs)
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" })
        response.end(assets.js)
        return
      }

      if (url.pathname === "/assets/themes/amoled.json") {
        if (options?.assetDelayMs) await sleep(options.assetDelayMs)
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        response.end("missing")
        return
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      response.end("missing")
    })().catch((error) => {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
      response.end(error instanceof Error ? error.message : String(error))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture server failed to bind")

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await writer.flush()
    },
    logFile: writer.file,
    origin: `http://127.0.0.1:${address.port}`,
  }
}

function createProtectedLoginPage(label: string, redirect: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${label} Login</title>
  </head>
  <body>
    <main>
      <h1 data-testid="fixture-login-title">${label} Login</h1>
      <a data-testid="fixture-login-continue" href="/__login?redirect=${encodeURIComponent(redirect)}">Sign in</a>
    </main>
  </body>
</html>`
}

async function startProtectedFixtureServer(testInfo: TestInfo, slug: string, version: string, label: string) {
  const assets = createFixtureAssets(version, label)
  const writer = createLineWriter(testInfo.outputPath(`${slug}-server.log`))
  const sendJson = (response: http.ServerResponse<http.IncomingMessage>, body: unknown, gzip = false) => {
    const payload = Buffer.from(`${JSON.stringify(body)}\n`)
    if (!gzip) {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      response.end(payload)
      return
    }
    response.writeHead(200, {
      "Content-Encoding": "gzip",
      "Content-Type": "application/json; charset=utf-8",
    })
    response.end(gzipSync(payload))
  }
  const authenticated = (request: http.IncomingMessage) => (request.headers.cookie ?? "").includes("codeplane_auth=1")
  const authRedirect = (pathname: string) => `/auth?redirect=${encodeURIComponent(pathname)}`
  const redirectTarget = (requestUrl: URL) => requestUrl.searchParams.get("redirect") || "/"
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`)
    writer.write({
      cookie: request.headers.cookie ?? "",
      method: request.method ?? "GET",
      origin: request.headers.origin ?? "",
      pathname: url.pathname,
      ts: new Date().toISOString(),
    })

    if (url.pathname === "/auth") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(createProtectedLoginPage(label, redirectTarget(url)))
      return
    }

    if (url.pathname === "/__login") {
      response.writeHead(302, {
        Location: redirectTarget(url),
        "Set-Cookie": "codeplane_auth=1; Path=/; HttpOnly",
      })
      response.end()
      return
    }

    if (!authenticated(request)) {
      response.writeHead(302, { Location: authRedirect(url.pathname) })
      response.end()
      return
    }

    if (url.pathname === "/global/version") {
      sendJson(response, { current: version })
      return
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(assets.html)
      return
    }

    if (url.pathname === "/config/providers") {
      sendJson(response, { providers: ["logicplanes"] })
      return
    }

    if (url.pathname === "/path") {
      sendJson(response, { home: "/workspace", directory: "/workspace" }, true)
      return
    }

    if (url.pathname === "/project") {
      sendJson(
        response,
        [{ id: "workspace", worktree: "/workspace", time: { created: 0, updated: 0 }, sandboxes: ["/workspace/codeplane"] }],
        true,
      )
      return
    }

    if (url.pathname === "/provider") {
      sendJson(response, { all: [{ id: "logicplanes" }], enabled: [{ id: "logicplanes" }] }, true)
      return
    }

    if (url.pathname === "/file/list") {
      sendJson(
        response,
        [
          { name: "codeplane", absolute: "/workspace/codeplane", type: "directory" },
          { name: "tunnel-mcp", absolute: "/workspace/tunnel-mcp", type: "directory" },
        ],
        true,
      )
      return
    }

    if (url.pathname === "/find/files") {
      sendJson(response, ["codeplane", "tunnel-mcp"], true)
      return
    }

    if (url.pathname === "/assets/app.css") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" })
      response.end(assets.css)
      return
    }

    if (url.pathname === "/assets/app.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" })
      response.end(assets.js)
      return
    }

    if (url.pathname === "/assets/themes/amoled.json") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      response.end("missing")
      return
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    response.end("missing")
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Protected fixture server failed to bind")

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await writer.flush()
    },
    logFile: writer.file,
    origin: `http://127.0.0.1:${address.port}`,
  }
}

async function seedStore(userDataDir: string, instances: SavedInstance[], lastInstanceId?: string) {
  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(
    path.join(userDataDir, "codeplane-desktop.json"),
    `${JSON.stringify({ instances, lastInstanceId }, null, 2)}\n`,
  )
}

async function seedStaleCache(userDataDir: string, version: string, ageDays: number) {
  const root = path.join(userDataDir, "ui-cache", version)
  const ageMs = ageDays * 24 * 60 * 60 * 1000
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, "index.html"), "<html></html>\n")
  await fs.writeFile(
    path.join(root, "meta.json"),
    `${JSON.stringify(
      {
        fetchedAt: Date.now() - ageMs,
        lastUsedAt: Date.now() - ageMs,
        origin: "http://127.0.0.1:1",
        version,
      },
      null,
      2,
    )}\n`,
  )
}

async function seedFreshCache(userDataDir: string, version: string) {
  const root = path.join(userDataDir, "ui-cache", version)
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, "index.html"), "<html></html>\n")
  await fs.writeFile(
    path.join(root, "meta.json"),
    `${JSON.stringify(
      {
        fetchedAt: Date.now(),
        lastUsedAt: Date.now(),
        origin: "http://127.0.0.1:2",
        version,
      },
      null,
      2,
    )}\n`,
  )
}

async function launchDesktop(
  testInfo: TestInfo,
  options?: { freshVersions?: string[]; instances?: SavedInstance[]; staleVersions?: string[] },
) {
  const root = testInfo.outputPath("desktop-runtime")
  const userDataDir = path.join(root, "user-data")
  const logDir = path.join(root, "logs")

  await fs.mkdir(root, { recursive: true })
  if (options?.instances) {
    await seedStore(userDataDir, options.instances, options.instances[0]?.id)
  }
  for (const version of options?.staleVersions ?? []) {
    await seedStaleCache(userDataDir, version, 31)
  }
  for (const version of options?.freshVersions ?? []) {
    await seedFreshCache(userDataDir, version)
  }

  const app = await electron.launch({
    args: ["."],
    cwd: packageDir,
    env: {
      ...process.env,
      CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE: "1",
      CODEPLANE_DESKTOP_LOG_DIR: logDir,
      CODEPLANE_DESKTOP_TEST_UPDATE: "latest",
      CODEPLANE_DESKTOP_USER_DATA_DIR: userDataDir,
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState("domcontentloaded")
  return {
    app,
    logFile: path.join(logDir, "desktop.log"),
    page,
    userDataDir,
  }
}

async function openSetupFromInstance(
  app: Awaited<ReturnType<typeof electron.launch>>,
  page: { evaluate<T>(pageFunction: () => T): Promise<T> },
) {
  const nextWindow = app.waitForEvent("window")
  await page.evaluate(() => window.codeplaneDesktop.instances.showSetup())
  const setupPage = await nextWindow
  await setupPage.waitForLoadState("domcontentloaded")
  return setupPage
}

test.describe.configure({ mode: "serial" })

test("logs setup actions and opens cached desktop UI", async ({}, testInfo) => {
  const server = await startFixtureServer(testInfo, "primary", appVersion, "Primary workspace", { assetDelayMs: 80 })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined

  try {
    const runtime = await launchDesktop(testInfo)
    app = runtime.app
    let page = runtime.page

    await expect(page.getByText("Connect to your instance")).toBeVisible()
    await expect(page.locator('[data-desktop-action="instance-add"]')).toBeVisible()
    expect(await page.evaluate(() => window.codeplaneDesktop.debug.logPath())).toBe(runtime.logFile)

    await page.locator('[data-desktop-action="instance-add"]').click()
    await expect(page.getByRole("heading", { name: "Add instance" })).toBeVisible()
    await page.locator('[data-desktop-action="form-back"]').click()
    await expect(page.getByText("Connect to your instance")).toBeVisible()

    await page.locator('[data-desktop-action="instance-add"]').click()
    await page.locator('[data-desktop-action="advanced-toggle"]').click()
    await expect(page.locator('[data-desktop-field="instance-headers"]')).toBeVisible()
    await page.locator('[data-desktop-action="form-cancel"]').click()
    await expect(page.getByText("Connect to your instance")).toBeVisible()

    await page.locator('[data-desktop-action="instance-add"]').click()
    await page.locator('[data-desktop-field="instance-name"]').fill("Primary workspace")
    await page.locator('[data-desktop-field="instance-url"]').fill(server.origin)
    await expect(page.getByText(`Reachable. Detected Codeplane ${appVersion}.`)).toBeVisible()
    await page.locator('[data-desktop-action="advanced-toggle"]').click()
    await page.locator('[data-desktop-field="instance-headers"]').fill("x-test-header: desktop")
    await page.locator('[data-desktop-field="ignore-certificates"]').check()

    await page.locator('[data-desktop-action="instance-save"]').click()
    await expect(page.locator('[data-desktop-state="prepare"]')).toBeVisible()
    await expect(page.locator("[data-desktop-prepare-title]")).toHaveText("Preparing local UI cache")
    await expect(page.locator("[data-desktop-prepare-message]")).toContainText(
      /Downloading UI|Downloading UI assets|Finalizing local UI cache/,
    )
    await expect(page.getByText("Connect to your instance")).toBeVisible({ timeout: 15_000 })

    const instanceWindowPromise = app.waitForEvent("window")
    await page.locator('[data-desktop-action="instance-open"]').first().click()
    page = await instanceWindowPromise
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByTestId("fixture-server-version")).toHaveText(appVersion)
    await expect(page.getByTestId("fixture-providers")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-theme")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-path")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-project-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-provider-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-file-list")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-find-files")).toHaveText(/^ok:/)
    await page.getByTestId("fixture-home").click()
    await page.getByTestId("fixture-projects").click()
    await page.getByTestId("fixture-settings").click()
    await expect(page.getByTestId("fixture-view")).toHaveText("settings")

    page = await openSetupFromInstance(app, page)
    await expect(page.locator('[data-desktop-action="updates-check"]')).toBeVisible()
    await page.locator('[data-desktop-action="updates-check"]').click()

    const reopenPromise = app.waitForEvent("window")
    await page.locator('[data-desktop-action="instance-open"]').first().click()
    page = await reopenPromise
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByTestId("fixture-providers")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-theme")).toHaveText(/^ok:/)

    page = await openSetupFromInstance(app, page)
    const row = page.locator('[data-desktop-action="instance-open"]').first()
    await row.hover()
    await page.getByRole("button", { name: "Edit instance" }).click()
    await expect(page.getByRole("heading", { name: "Edit instance" })).toBeVisible()
    await expect(page.locator('[data-desktop-field="instance-name"]')).toHaveValue("Primary workspace")
    await page.locator('[data-desktop-action="instance-remove"]').click()
    await expect(page.getByText("No instances yet")).toBeVisible()

    await expect
      .poll(() => readDesktopEntries(runtime.logFile).then((value) => value.length), {
        message: "desktop log should contain events",
      })
      .toBeGreaterThan(0)

    const logEntries = await readDesktopEntries(runtime.logFile)
    const hasAction = (action: string) =>
      logEntries.some(
        (entry) =>
          entry.scope === "setup" &&
          entry.event === "action.click" &&
          typeof entry.data === "object" &&
          entry.data !== null &&
          "action" in entry.data &&
          entry.data.action === action,
      )

    expect(hasAction("instance-add")).toBe(true)
    expect(hasAction("form-back")).toBe(true)
    expect(hasAction("form-cancel")).toBe(true)
    expect(hasAction("advanced-toggle")).toBe(true)
    expect(hasAction("instance-save")).toBe(true)
    expect(hasAction("updates-check")).toBe(true)
    expect(hasAction("instance-open")).toBe(true)
    expect(hasAction("instance-remove")).toBe(true)
    expect(logEntries.some((entry) => entry.scope === "setup" && entry.event === "prepare.progress")).toBe(true)
    expect(
      logEntries.some(
        (entry) =>
          entry.scope === "ui-host" &&
          entry.event === "cache.miss" &&
          typeof entry.data === "object" &&
          entry.data !== null &&
          "version" in entry.data &&
          entry.data.version === appVersion,
      ),
    ).toBe(true)
    expect(
      logEntries.some(
        (entry) =>
          entry.scope === "ui-host" &&
          entry.event === "cache.hit" &&
          typeof entry.data === "object" &&
          entry.data !== null &&
          "version" in entry.data &&
          entry.data.version === appVersion,
      ),
    ).toBe(true)
    expect(
      logEntries.some(
        (entry) =>
          entry.scope === "window.console" &&
          entry.event === "message" &&
          typeof entry.data === "object" &&
          entry.data !== null &&
          "message" in entry.data &&
          typeof entry.data.message === "string" &&
          entry.data.message.includes("fixture:view settings"),
      ),
    ).toBe(true)
  } finally {
    if (app) await app.close()
    await server.close()
    await attachIfExists(testInfo, "desktop-log", testInfo.outputPath("desktop-runtime/logs/desktop.log"))
    await attachIfExists(testInfo, "primary-server-log", server.logFile)
  }
})

test("downloads separate cached UI bundles per server version", async ({}, testInfo) => {
  const primary = await startFixtureServer(testInfo, "primary", appVersion, "Primary workspace")
  const legacy = await startFixtureServer(testInfo, "legacy", "26.4.0", "Legacy workspace")
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined

  try {
    const runtime = await launchDesktop(testInfo, {
      instances: [
        { id: "primary", label: "Primary workspace", url: primary.origin },
        { id: "legacy", label: "Legacy workspace", url: legacy.origin },
      ],
    })
    app = runtime.app
    let page = runtime.page

    await expect(page.locator('[data-desktop-action="instance-open"]')).toHaveCount(2)

    const primaryWindow = app.waitForEvent("window")
    await page.locator('[data-desktop-action="instance-open"]').first().click()
    page = await primaryWindow
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByTestId("fixture-server-version")).toHaveText(appVersion)
    await expect(page.getByTestId("fixture-providers")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-theme")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-path")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-project-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-provider-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-file-list")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-find-files")).toHaveText(/^ok:/)

    page = await openSetupFromInstance(app, page)

    const legacyWindow = app.waitForEvent("window")
    await page.locator('[data-desktop-action="instance-open"]').nth(1).click()
    page = await legacyWindow
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByTestId("fixture-server-version")).toHaveText("26.4.0")
    await expect(page.getByTestId("fixture-providers")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-theme")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-path")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-project-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-provider-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-file-list")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-find-files")).toHaveText(/^ok:/)

    await expect
      .poll(() => exists(path.join(runtime.userDataDir, "ui-cache", appVersion, "assets", "themes", "amoled.json")))
      .toBe(true)
    await expect
      .poll(() => exists(path.join(runtime.userDataDir, "ui-cache", "26.4.0", "assets", "themes", "amoled.json")))
      .toBe(true)

    const primaryRequests = await readJsonLines<RequestLogEntry>(primary.logFile)
    const legacyRequests = await readJsonLines<RequestLogEntry>(legacy.logFile)
    expect(primaryRequests.filter((entry) => entry.pathname === "/assets/themes/amoled.json")).toHaveLength(1)
    expect(legacyRequests.filter((entry) => entry.pathname === "/assets/themes/amoled.json")).toHaveLength(1)
  } finally {
    if (app) await app.close()
    await primary.close()
    await legacy.close()
    await attachIfExists(testInfo, "desktop-log", testInfo.outputPath("desktop-runtime/logs/desktop.log"))
    await attachIfExists(testInfo, "primary-server-log", primary.logFile)
    await attachIfExists(testInfo, "legacy-server-log", legacy.logFile)
  }
})

test("opens auth-gated instances, completes sign-in, and switches into cached local UI", async ({}, testInfo) => {
  const server = await startProtectedFixtureServer(testInfo, "protected", appVersion, "Protected workspace")
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined

  try {
    const runtime = await launchDesktop(testInfo, {
      instances: [{ id: "protected", label: "Protected workspace", url: server.origin }],
    })
    app = runtime.app
    let page = runtime.page

    const instanceWindow = app.waitForEvent("window")
    await page.locator('[data-desktop-action="instance-open"]').first().click()
    page = await instanceWindow
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByTestId("fixture-login-title")).toHaveText("Protected workspace Login")

    await page.getByTestId("fixture-login-continue").click()
    await expect(page.getByTestId("fixture-server-version")).toHaveText(appVersion, { timeout: 15_000 })
    await expect(page.getByTestId("fixture-providers")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-theme")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-path")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-project-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-provider-api")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-file-list")).toHaveText(/^ok:/)
    await expect(page.getByTestId("fixture-find-files")).toHaveText(/^ok:/)
    await page.getByTestId("fixture-settings").click()
    await expect(page.getByTestId("fixture-view")).toHaveText("settings")

    const logEntries = await readDesktopEntries(runtime.logFile)
    expect(logEntries.some((entry) => entry.scope === "main" && entry.event === "instance.open.auth-required")).toBe(true)
    expect(logEntries.some((entry) => entry.scope === "main" && entry.event === "instance.bootstrap.success")).toBe(true)

    const requests = await readJsonLines<RequestLogEntry>(server.logFile)
    expect(requests.some((entry) => entry.pathname === "/auth")).toBe(true)
    expect(
      requests.some((entry) => entry.pathname === "/config/providers" && entry.cookie.includes("codeplane_auth=1")),
    ).toBe(true)
  } finally {
    if (app) await app.close()
    await server.close()
    await attachIfExists(testInfo, "desktop-log", testInfo.outputPath("desktop-runtime/logs/desktop.log"))
    await attachIfExists(testInfo, "protected-server-log", server.logFile)
  }
})

test("removes UI caches that have been unused for more than 30 days", async ({}, testInfo) => {
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined

  try {
    const runtime = await launchDesktop(testInfo, {
      freshVersions: ["fresh-version"],
      staleVersions: ["stale-version"],
    })
    app = runtime.app

    await expect.poll(() => exists(path.join(runtime.userDataDir, "ui-cache", "stale-version"))).toBe(false)
    await expect.poll(() => exists(path.join(runtime.userDataDir, "ui-cache", "fresh-version"))).toBe(true)
  } finally {
    if (app) await app.close()
    await attachIfExists(testInfo, "desktop-log", testInfo.outputPath("desktop-runtime/logs/desktop.log"))
  }
})
