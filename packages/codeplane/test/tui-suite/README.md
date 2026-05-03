# tui-suite — fast, agent-driven TUI test + driver suite

A complete test, surveillance, agent-driver, and preview suite for any
`@opentui/solid` TUI in this repo. Renders TUIs in-process against a
software buffer (no pty, no spawn) and captures frames as text, styled
spans, ANSI, or HTML.

```
test/tui-suite/
├── harness/          mount(), press(), type(), find(), waitFor(), snapshot helpers
├── fixtures/         small Solid TUI components (list, dialog, input, scroll, …)
├── surveillance/     long-running soak/random-walk runner with metrics
├── agent/            JSON-RPC over stdio so external agents can drive any fixture
├── preview/          Bun HTTP server that streams frames as HTML
├── bin/tui-suite     single CLI entrypoint (preview / dev / agent / surveil / …)
├── snapshots/        saved snapshot files (created on first run)
└── tests/            bun:test files exercising every layer
```

## Quick start

Run the whole suite:

```sh
bun --cwd packages/codeplane test test/tui-suite
```

Pop up a fixture in the browser:

```sh
./test/tui-suite/bin/tui-suite preview list
# → http://127.0.0.1:NNNN — page polls /frame.html every 250ms
```

Drive a fixture from the terminal REPL:

```sh
./test/tui-suite/bin/tui-suite dev list
> press down
> press enter
> find Selected: Charlie
> unmount
```

Capture one frame to stdout:

```sh
./test/tui-suite/bin/tui-suite snapshot list
./test/tui-suite/bin/tui-suite snapshot list --ansi   # full color
```

Run a 200-iteration soak with random keys, get JSON report on stdout:

```sh
./test/tui-suite/bin/tui-suite surveil scroll --iter 200
```

Drive any fixture from another agent, JSON-RPC over stdio:

```sh
./test/tui-suite/bin/tui-suite agent
< {"jsonrpc":"2.0","id":1,"method":"mount","params":{"fixture":"list"}}
> {"jsonrpc":"2.0","id":1,"result":{"ok":true,"cols":100,"rows":30}}
< {"jsonrpc":"2.0","id":2,"method":"press","params":{"chord":"down"}}
> {"jsonrpc":"2.0","id":2,"result":{"ok":true}}
< {"jsonrpc":"2.0","id":3,"method":"find","params":{"needle":"▸ Bravo"}}
> {"jsonrpc":"2.0","id":3,"result":{"row":5,"col":2,"text":"▸ Bravo"}}
```

## Writing a test

```tsx
import { describe, expect, test } from "bun:test"
import { withHarness } from "../harness"
import { ListFixture } from "../fixtures/list"

describe("my list", () => {
  test("down arrow advances selection", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      await h.press("down")
      expect(h.find("▸ Bravo")).not.toBeNull()
    })
  })
})
```

## Harness API

```ts
import { mount, withHarness } from "test/tui-suite/harness"

const h = await mount(() => <MyComponent />, { width: 80, height: 24 })

// input
await h.press("down")              // arrow keys, named keys, modifiers
await h.press("ctrl+a")            // chords parsed from strings
await h.pressSeq(["down","down","enter"])
await h.type("hello")              // literal characters
await h.paste("multi\nline\ntext") // bracketed paste, faster
await h.resize(120, 40)

// observation
h.text()                     // plain rendered text grid
h.frame()                    // { cols, rows, cursor, text, lines: CapturedLine[] }
h.find("Selected: Bravo")    // string or RegExp → { row, col, text } | null
h.findAll(/item \d+/)        // every match
await h.waitForText("Done")  // poll until text appears
await h.waitForGone(/loading/i)
await h.waitFor((h) => h.find("Ready") !== null, 5000)

await h.unmount()
```

### Chord syntax

`"a"` `"down"` `"shift+tab"` `"ctrl+a"` `"cmd+k"` `"alt+enter"` `"f5"`
`"escape"` `"home"` `"end"` `"pageup"` `"pagedown"` `"backspace"` `"space"`

### Snapshot helpers

```ts
import { trimFrame, frameToAnsi, frameToHtml, diffFrames } from "test/tui-suite/harness"
import { expectMatchSnapshot, saveHtmlPreview } from "test/tui-suite/harness/assertions"

trimFrame(h.frame())                    // strip trailing whitespace, stable for snapshots
frameToAnsi(h.frame())                  // ANSI-escaped (24-bit colors + bold/italic/underline)
frameToHtml(h.frame())                  // <span>…</span> per styled run, ready to embed

await expectMatchSnapshot(h, "my-list-after-down")
// snapshots live in test/tui-suite/snapshots/
// run with CODEPLANE_TUI_UPDATE_SNAPSHOTS=1 to update

await saveHtmlPreview(h.frame(), ".artifacts/list.html")
```

## Surveillance / soak

```ts
import { surveil, randomWalkScript } from "test/tui-suite/surveillance"

const report = await surveil(
  () => <ScrollFixture count={1000} />,
  randomWalkScript("scroll-fuzz", ["up","down","pageup","pagedown","home","end"], 6),
  { iterations: 5000, snapshotEvery: 500 },
)

// report.ok                       — false if any failure
// report.failures                  — { iteration, step, message, frameText }
// report.metrics.avgIterationMs    — perf
// report.metrics.distinctFrames    — coverage
// report.metrics.blankFrames       — stall detector
// report.metrics.memPeakHeap       — leak detector
// report.snapshots                 — preserved frames at intervals
```

A script is either a fixed `SurveillanceStep[]` or a function called per iteration:

```ts
const script: SurveillanceScript = {
  name: "manual",
  steps: (iter) => [
    { kind: "press", chord: iter % 2 === 0 ? "down" : "up" },
    { kind: "expect", text: /item/ },
  ],
}
```

Step kinds:
- `{ kind: "press", chord }` `{ kind: "type", text }` `{ kind: "paste", text }`
- `{ kind: "wait", ms }` `{ kind: "resize", width, height }` `{ kind: "settle" }`
- `{ kind: "expect", text: string | RegExp }` — recorded as failure if missing
- `{ kind: "snapshot", label }` — capture frame into report

## Agent driver (JSON-RPC over stdio)

Spawn `tui-suite agent` and pipe newline-delimited JSON-RPC requests in,
read responses out. Useful for external agents that want to operate the
TUI without parsing terminal output.

```
Methods:
  list                                        → { fixtures: [...] }
  mount   { fixture, width?, height? }        → { ok, cols, rows }
  press   { chord }                           → { ok }
  type    { text }                            → { ok }
  paste   { text }                            → { ok }
  resize  { width, height }                   → { ok, cols, rows }
  frame                                       → { text, html, cols, rows, cursor }
  find    { needle: string|{regex,flags} }    → FindResult | null
  findAll { needle }                          → FindResult[]
  waitFor { text, timeoutMs? }                → { ok }
  unmount                                     → { ok }
```

You can also use `AgentClient.fromServer(server)` in-process for tests
that exercise the agent contract without spawning a child.

## Preview server

```sh
tui-suite preview <fixture> [--port N]
```

- `GET  /` — interactive HTML page that polls /frame.html every 250ms
- `GET  /frame.html` — `<pre>` of styled `<span>` runs
- `GET  /frame.json` — `{ text, cols, rows, cursor }`
- `POST /press` — `{ chord }`
- `POST /type` — `{ text }`
- `POST /resize` — `{ width, height }`

The browser page also has inline controls for press/type so you can
poke at the TUI live without touching the CLI.

## Adding a new fixture

1. Create `test/tui-suite/fixtures/foo.tsx` that exports a Solid component.
2. Register it in `test/tui-suite/fixtures/index.tsx`:

   ```tsx
   import { FooFixture } from "./foo"
   FIXTURES.foo = () => <FooFixture />
   ```

3. Add a test in `test/tui-suite/tests/fixtures/foo.test.tsx`.

The new fixture immediately gains preview / dev / agent / surveil support.

## Why in-process?

`@opentui/core/testing` exposes a `TestRenderer` that runs the full
render pipeline against a virtual buffer with a mock keyboard parser.
That means the suite:

- **Boots in <100ms** — no pty, no node spawn, no terminal emulator.
- **Reads frames synchronously** — `getRealCharBytes()` + `getSpanLines()`.
- **Runs hundreds of iterations per second** — surveillance soak in seconds.
- **Works headless in CI** — no DISPLAY, no `script(1)` wrapping.

Same engine the production TUI uses. Frames are byte-identical to what
a real terminal would render.
