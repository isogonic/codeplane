# AGENTS.md — Codeplane operations & contribution guide

This file is the operational manual for any agent (human or LLM) working in this
repository. It covers what the codebase looks like, how the day-to-day workflow
runs, and **especially** the full end-to-end release process — including every
common failure mode I've personally hit and how to avoid them.

If you're reading this because you were spawned to ship a release, jump to
[Release process](#release-process). If you're new to the repo, read top to
bottom.

---

## TL;DR — the short version

- **Default branch**: `main` (not `dev` — older docs lie).
- **Package manager**: Bun (`packageManager: bun@1.3.13` in root `package.json`).
- **Lockfile**: `bun.lock`. Never commit `package-lock.json` (it's gitignored).
- **Workspaces**: `packages/*`, `packages/sdk/js`, `packages/slack`.
- **Lint**: `bun lint` from repo root (oxlint, 0 errors required, warnings tolerated).
- **Typecheck**: `bun turbo typecheck` from repo root (8 packages must all pass).
- **Tests**: cannot run from repo root (guard `do-not-run-tests-from-root`); run from each package dir, e.g. `bun --cwd packages/codeplane test`.
- **Version bump**: `bun run version:bump` for a patch, or `bun run version:bump minor|major|X.Y.Z`. It edits `packages/shared/src/version.ts` and syncs every versioned file.
- **Release**: tag a `vX.Y.Z` GitHub release on `main`; the `npm-release` and `desktop-release` workflows trigger automatically and publish to npm + GitHub releases.
- **Tools must be parallel** when independent — see [Style guide → Tool calling](#tool-calling).
- **Use Bun APIs** (`Bun.file`, `Bun.write`) over `node:fs/promises` when both work.

If the user shouts "BUMP ALL PUSH ALL AND CREATE NEW RELEASE HERE WE GOOO" at
you, follow the [Release checklist](#release-checklist-do-not-skip-steps)
exactly.

---

## Table of contents

1. [Repository overview](#repository-overview)
2. [Workspaces & packages map](#workspaces--packages-map)
3. [Day-to-day workflow checklist](#day-to-day-workflow-checklist)
4. [Style guide](#style-guide)
5. [Testing](#testing)
6. [Typecheck](#typecheck)
7. [Linting](#linting)
8. [Git workflow](#git-workflow)
9. [Release process](#release-process)
10. [Build pipeline deep dive](#build-pipeline-deep-dive)
11. [CI workflows reference](#ci-workflows-reference)
12. [Architecture overview](#architecture-overview)
13. [CLI command structure](#cli-command-structure)
14. [Server / API architecture](#server--api-architecture)
15. [TUI architecture](#tui-architecture)
16. [Desktop shell architecture](#desktop-shell-architecture)
17. [Local instance management](#local-instance-management)
18. [Update flow audit](#update-flow-audit)
19. [Common pitfalls / footguns](#common-pitfalls--footguns)
20. [Environment variables reference](#environment-variables-reference)
21. [Configuration files reference](#configuration-files-reference)
22. [Quick command reference](#quick-command-reference)

---

## Repository overview

Codeplane is a fully open-source AI coding agent with a shared CLI, TUI, web
app, and desktop app. Every surface (CLI / TUI / web / desktop) talks to the
same server runtime and reads the same `Codeplane` home folder for config,
plugins, skills, and saved instances.

This repo is a **Bun monorepo** managed with `turbo` for cross-package tasks.
The default branch is `main`. The fork upstream is
[`sst/opencode`](https://github.com/sst/opencode).

Top-level layout (root):

```
opencode/
├── AGENTS.md                  ← you are here
├── README.md                  ← user-facing landing page
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── package.json               ← root workspace + scripts
├── bun.lock
├── bunfig.toml
├── turbo.json                 ← turbo task graph
├── tsconfig.json              ← root tsconfig (extended by packages)
├── .oxlintrc.json             ← oxlint config (rules + ignorePatterns)
├── .gitignore
├── .github/
│   ├── workflows/
│   │   ├── npm-release.yml    ← triggered on v* tag push
│   │   └── desktop-release.yml← triggered on v* tag push
│   └── TEAM_MEMBERS
├── packages/                  ← all workspace packages
│   ├── app/                   ← SolidJS web app
│   ├── codeplane/             ← server, CLI, TUI host
│   ├── containers/            ← container build helpers
│   ├── desktop/               ← Electron shell
│   ├── docs/                  ← docs site
│   ├── extensions/            ← editor extensions (Zed, etc.)
│   ├── function/              ← serverless function entry
│   ├── identity/
│   ├── plugin/                ← @codeplane-ai/plugin SDK
│   ├── script/                ← release/publish scripts
│   ├── sdk/                   ← OpenAPI-generated SDK
│   │   └── js/                ← @codeplane-ai/sdk
│   ├── shared/                ← @codeplane-ai/shared (home, version, instance, …)
│   ├── slack/                 ← Slack integration
│   ├── storybook/
│   ├── ui/                    ← @codeplane-ai/ui (shared SolidJS components)
│   └── web/                   ← Astro marketing site (logo assets live here)
├── sdks/
│   └── vscode/                ← VSCode extension package
└── script/
    ├── publish.ts             ← top-level release driver
    ├── bump-version.ts        ← bumps packages/shared/src/version.ts + syncs files
    └── sync-version.ts        ← propagates version across versioned files
```

Each subpackage may have its own `AGENTS.md` with package-specific rules.

---

## Workspaces & packages map

`package.json` declares:

```jsonc
"workspaces": {
  "packages": ["packages/*", "packages/sdk/js", "packages/slack"],
  "catalog": { ... }   // pinned versions for deps used across packages
}
```

The **catalog** is **no longer the single source of truth**. Bumping a version
inside `workspaces.catalog` does not propagate to package consumers — see the
top of the previous AGENTS.md for the (legacy) `node /tmp/inline-all.mjs`
workaround. In practice, edit consumer `package.json` files directly.

### What each package does

| Package | What it is | Key files |
| :--- | :--- | :--- |
| `@codeplane-ai/app` (`packages/app`) | The SolidJS single-page web app users see in the browser / desktop shell. Routes, settings, sessions, providers. | `src/pages/`, `src/components/`, `src/context/`, `src/i18n/` |
| `codeplane` (`packages/codeplane`) | The CLI + server + TUI host. The biggest package in the repo. | `src/cli/cmd/`, `src/server/`, `src/tui/`, `src/installation/`, `src/global/`, `script/build.ts`, `script/postinstall.mjs` |
| `@codeplane-ai/desktop` (`packages/desktop`) | The Electron shell. Owns the `electron-updater` flow and spawns local Codeplane servers. | `src/main/main.ts`, `src/main/preload.ts`, `src/setup/app.tsx` |
| `@codeplane-ai/shared` (`packages/shared`) | Pure cross-package utilities: home folder paths, version constant, local instance manager, encoding/util helpers. | `src/home.ts`, `src/version.ts`, `src/local-instance.ts`, `src/local-runtime.ts`, `src/util/` |
| `@codeplane-ai/sdk` (`packages/sdk/js`) | OpenAPI-generated client SDK for the codeplane server. | `script/build.ts`, `src/v2/client.ts` |
| `@codeplane-ai/plugin` (`packages/plugin`) | Plugin SDK consumed by external plugins. | `src/index.ts`, `src/tui.ts` |
| `@codeplane-ai/ui` (`packages/ui`) | Shared SolidJS component library (Button, Dialog, Toast, …). | `src/components/`, `src/i18n/`, `src/theme/` |
| `@codeplane-ai/script` (`packages/script`) | Release-script helpers. Reads env vars (`CODEPLANE_VERSION`, `CODEPLANE_BUMP`, `CODEPLANE_CHANNEL`, `CODEPLANE_RELEASE`). | `src/index.ts` (exports `Script.{version,channel,preview,release,team}`) |
| `@codeplane-ai/web` (`packages/web`) | Astro-built marketing site. Hosts the **logo SVGs** referenced by the README (`src/assets/logo-ornate-{light,dark}.svg`). | `src/assets/`, `astro.config.mjs` |
| `@codeplane-ai/extensions/zed` | Zed editor extension manifest (`extension.toml`). | `extension.toml` |
| `sdks/vscode` | VS Code extension. Has its own `package.json`. | `sdks/vscode/package.json` |

Per-platform npm packages **published from the build** (not in this repo as
sources, generated into `packages/codeplane/dist/<name>/`):

- `codeplane-darwin-arm64`, `codeplane-darwin-x64` (+ `-baseline` variants)
- `codeplane-linux-arm64`, `codeplane-linux-x64` (+ `-baseline`, `-musl`)
- `codeplane-windows-arm64`, `codeplane-windows-x64` (+ `-baseline`)

Each platform package contains the Bun-compiled `bin/codeplane` standalone
executable and a `bin/runtime/tui/node-main.js` SolidJS TUI bundle. Each one
**must** declare `@opentui/core-{platform}-{arch}` as an npm `dependencies`
entry — see [TUI native dependency](#tui-native-dependency-opentuicore-platform-arch).

---

## Day-to-day workflow checklist

Before any commit / push:

- [ ] `bun turbo typecheck` — all 8 packages must pass
- [ ] `bun lint` — must report `0 errors` (warnings are tolerated)
- [ ] `bun --cwd packages/codeplane test` — for changes touching `codeplane/`
  (also `app/`, `shared/`, `ui/` as appropriate). Tests cannot run from repo
  root.

Before any release:

- [ ] All of the above
- [ ] Local build smoke test: `bun --cwd packages/codeplane script/build.ts --skip-embed-web-ui --skip-install --single` produces a working `dist/codeplane-<platform>-<arch>/bin/codeplane --version`.
- [ ] `git fetch origin main` and rebase if remote has commits you don't.
- [ ] Bump version with `bun run version:bump` (patch) or `bun run version:bump X.Y.Z` (exact).
- [ ] Commit with a release-style message.
- [ ] Push to `origin/main`.
- [ ] `gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes ...` — see [Release notes template](#release-notes-template).

---

## Style guide

### General principles

- **Keep things in one function** unless composable or reusable. Don't
  pre-emptively extract.
- **Avoid `try`/`catch`** where possible. Effect-style error channels and
  early-return JSON envelopes (see the `/global/upgrade` route) are usually
  better.
- **Avoid `any`**. Use `unknown` + narrowing, branded types, or explicit
  schemas via `effect`'s `Schema`.
- **Use Bun APIs** (`Bun.file`, `Bun.write`, `Bun.spawn`) when both Bun and
  Node APIs work — Bun's are faster and the runtime is Bun.
- **Rely on type inference**. Avoid explicit annotations or interfaces unless
  necessary for an exported boundary or for clarity.
- **Functional array methods** (`flatMap`, `filter`, `map`) over `for` loops.
  Use type guards on `filter` to maintain inference downstream:

  ```ts
  // Good
  const items = list.filter((x): x is NonNull<typeof x> => x !== null)

  // Bad
  const items: NonNull<typeof x>[] = []
  for (const x of list) if (x !== null) items.push(x)
  ```

- **Inline single-use values**. Reduce variable count when the value is only
  used once:

  ```ts
  // Good
  const journal = await Bun.file(path.join(dir, "journal.json")).json()

  // Bad
  const journalPath = path.join(dir, "journal.json")
  const journal = await Bun.file(journalPath).json()
  ```

- **In `src/config`**, follow the existing self-export pattern at the top of
  the file (`export * as ConfigAgent from "./agent"`) when adding a new config
  module.

### Module shape (no namespaces)

Do **not** use `export namespace Foo { ... }` for module organization. It is
not standard ESM, prevents tree-shaking, and breaks Node's native TypeScript
runner. Use **flat top-level exports + a self-reexport at the bottom**:

```ts
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@codeplane/Foo") {}
export const layer = Layer.effect(Service, ...)
export const defaultLayer = layer.pipe(...)

export * as Foo from "./foo"
```

Consumers import the namespace projection:

```ts
import { Foo } from "@/foo/foo"

yield * Foo.Service
Foo.layer
Foo.defaultLayer
```

Namespace-private helpers stay as non-exported top-level declarations in the
same file — they remain inaccessible to consumers (they are not projected by
`export * as`) but are usable by the file's own code.

For `index.ts` files, use `"."` instead of `"./index"`:

```ts
// src/foo/index.ts
export const thing = ...

export * as Foo from "."
```

For multi-sibling directories (e.g. `src/session/`, `src/config/`), keep each
sibling as its own file with its own self-reexport. **Do not add a barrel
`index.ts`** — it forces every import through the barrel and defeats
tree-shaking.

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context:

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of
reassignment:

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control flow

Avoid `else` statements. Prefer early returns:

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema definitions (Drizzle)

Use `snake_case` for field names so column names don't need to be redefined as
strings:

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

### Effect

Use these rules when writing or migrating Effect code. Full reference in
`packages/codeplane/specs/effect/migration.md`.

#### Core

- Use `Effect.gen(function* () { ... })` for composition.
- Use `Effect.fn("Domain.method")` for named/traced effects and
  `Effect.fnUntraced` for internal helpers.
- `Effect.fn` / `Effect.fnUntraced` accept pipeable operators as extra
  arguments — avoid unnecessary outer `.pipe()` wrappers.
- Use `Effect.callback` for callback-based APIs.
- Prefer `DateTime.nowAsDate` over `new Date(yield* Clock.currentTimeMillis)`
  when you need a `Date`.

#### Schemas and errors

- Use `Schema.Class` for multi-field data.
- Use branded schemas (`Schema.brand`) for single-value types.
- Use `Schema.TaggedErrorClass` for typed errors.
- Use `Schema.Defect` instead of `unknown` for defect-like causes.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)` over
  `yield* Effect.fail(new MyError(...))` for direct early-failure branches.

#### Runtime vs InstanceState

- Use `makeRuntime` (from `src/effect/run-service.ts`) for all services.
  Returns `{ runPromise, runFork, runCallback }` backed by a shared `memoMap`
  that deduplicates layers.
- Use `InstanceState` (from `src/effect/instance-state.ts`) for per-directory
  or per-project state that needs per-instance cleanup. Uses `ScopedCache`
  keyed by directory — each open project gets its own state, automatically
  cleaned up on disposal.
- If two open directories should not share one copy of the service, it needs
  `InstanceState`.
- Do the work directly in the `InstanceState.make` closure — `ScopedCache`
  handles run-once semantics. Don't add fibers, `ensure()` callbacks, or
  `started` flags on top.
- Use `Effect.addFinalizer` or `Effect.acquireRelease` inside the
  `InstanceState.make` closure for cleanup (subscriptions, process teardown,
  etc.).
- Use `Effect.forkScoped` inside the closure for background stream consumers
  — the fiber is interrupted when the instance is disposed.
- To make a service's `init()` non-blocking, fork `InstanceState.get(state)`
  at the `init()` call site (e.g. `Effect.forkIn(scope)`), not by forking work
  inside the `InstanceState.make` closure. Forking inside the closure leaves
  state incomplete for other methods that read it.
- `src/project/bootstrap.ts` already wraps every service `init()` in
  `Effect.forkDetach`, so `init()` is fire-and-forget in production. Keep
  `init()` methods synchronous internally; the caller controls concurrency.

#### Effect v4 beta API

- `Effect.fork` and `Effect.forkDaemon` do not exist. Use
  `Effect.forkIn(scope)` to fork a fiber into a specific scope.

#### Preferred Effect services

In effectified services, prefer yielding existing Effect services over
dropping down to ad hoc platform APIs:

- `FileSystem.FileSystem` over raw `fs/promises`
- `ChildProcessSpawner.ChildProcessSpawner` with `ChildProcess.make(...)` over
  custom process wrappers
- `HttpClient.HttpClient` over raw `fetch`
- `Path.Path`, `Config`, `Clock`, `DateTime` when those concerns are already
  inside Effect code
- `Effect.repeat` or `Effect.schedule` with `Effect.forkScoped` for background
  loops or scheduled tasks

#### Effect.cached for deduplication

Use `Effect.cached` when multiple concurrent callers should share a single
in-flight computation rather than storing `Fiber | undefined` or
`Promise | undefined` manually. See `specs/effect/migration.md` for the full
pattern.

#### Instance.bind — ALS for native callbacks

`Instance.bind(fn)` captures the current Instance AsyncLocalStorage context
and restores it synchronously when called.

Use it for native addon callbacks (`@parcel/watcher`, `node-pty`, native
`fs.watch`, etc.) that need to call `Bus.publish` or anything that reads
`Instance.directory`.

You do **not** need it for `setTimeout`, `Promise.then`, `EventEmitter.on`,
or Effect fibers.

```typescript
const cb = Instance.bind((err, evts) => {
  Bus.publish(MyEvent, { ... })
})
nativeAddon.subscribe(dir, cb)
```

### Tool calling

> **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.**

When two operations are independent, send them in the same batch:

- Multiple `Bash` invocations → one message with multiple `<Bash>` tool calls.
- Multiple `Read` invocations → one message with multiple `<Read>` tool calls.

Sequential is required only when one call's output feeds the next call's
input.

### SolidJS

- Always prefer `createStore` over multiple `createSignal` calls when the
  state has more than one related field.
- Reactive deps: read inside `createEffect` / `createMemo`. Don't pre-compute
  signals into local variables in the body — that breaks tracking.
- For SolidJS-rendered TUI components (`@opentui/solid`), the JSX compiles to
  `template`/`createComponent` calls via the Solid Babel plugin. The plugin
  is registered by `@opentui/solid/bun-plugin`'s `createSolidTransformPlugin`
  during `Bun.build`.

---

## Testing

- **Cannot run from repo root**. The root `test` script is hard-failing
  (`do-not-run-tests-from-root`). Run from a package dir:
  ```bash
  bun --cwd packages/codeplane test
  bun --cwd packages/shared test
  bun --cwd packages/ui test
  bun --cwd packages/app test
  ```
- **Avoid mocks** as much as possible. Test the actual implementation. Don't
  duplicate logic into the test.
- **Test isolation**: many tests in `packages/codeplane/test/` share global
  filesystem/database state. The aggregate `bun test` run can produce
  cross-file pollution failures (sync replay, workspace restore, shell prompt
  tests) that **all pass cleanly when run per-file**:
  ```bash
  bun --cwd packages/codeplane test test/sync/index.test.ts
  bun --cwd packages/codeplane test test/workspace/workspace-restore.test.ts
  bun --cwd packages/codeplane test test/session/prompt.test.ts
  ```
  These flakes are pre-existing infrastructure issues — do not block a release
  on them. Document them in the release notes only if they're new.
- **Network-dependent tests**: `test/provider/copilot/copilot-chat-model.test.ts`
  and `test/session/processor-effect.test.ts` (the "preserve text start time"
  test) hit external APIs and frequently time out under CI / aggregate runs.
  Same as above — pre-existing flakes.
- **TypeScript-only tests**: when fixing type errors in test files, prefer
  the smallest possible cast (e.g. `expect(result).toEqual(input as any)`
  when zod's strict-parsed type doesn't match the loose input literal). Don't
  rewrite a test's intent.

---

## Typecheck

- **Always run from package directories** or via turbo. Never call `tsc`
  directly:
  ```bash
  # All packages
  bun turbo typecheck

  # Single package
  bun turbo typecheck --filter=codeplane
  bun --cwd packages/codeplane typecheck
  ```
- The repo uses `tsgo` (TypeScript Go) for speed. Each package's
  `tsconfig.json` extends `@tsconfig/bun`.
- **Eight packages** participate in typecheck currently: `app`, `codeplane`,
  `console-app`, `console-core`, `console-function`, `desktop`, `enterprise`,
  `function`, `plugin`, `sdk`, `shared`, `slack`, `ui` (some retired in
  v27.4.7). Always check the count after running — if it dropped, investigate.
- **Common typecheck errors and fixes**:
  - `Object literal may only specify known properties, and 'X' does not exist
    in type Y` in a test file: usually a strict-parsed zod type vs loose input
    literal. Cast input with `as any`.
  - `Property 'updated' is missing in type ...` for SDK Session types: pass
    full `time: { created, updated }` instead of just `{ created }`.
  - `Type 'number' is not assignable to type 'void | Promise<void>'` in a
    `defer` callback: wrap arrow body in `{}` instead of using expression form
    (`defer(() => count++)` → `defer(() => { count++ })`).
  - `Invalid tsconfig` from oxlint: missing `rootDir` when `outDir` is set
    and `paths` map outside the `include` root. Add explicit `rootDir`.

---

## Linting

- `bun lint` runs `oxlint` from the repo root.
- Config: `.oxlintrc.json`. Currently allows ~2400 warnings, requires `0
  errors`.
- `ignorePatterns` includes `**/.cache/`, `**/node_modules`, `**/dist`,
  `**/.build`, `**/.sst`, `**/*.d.ts`, `**/sdk.gen.ts`. If you find oxlint
  scanning a generated/cache directory, add it here.
- Some rules are intentionally disabled for this codebase:
  - `require-yield` — Effect uses `function*` with `Effect.gen`/`Effect.fnUntraced` that don't always yield.
  - `no-unassigned-vars` — SolidJS uses `let ref: T | undefined` for JSX ref bindings.
  - `no-unused-expressions` — SolidJS tracks reactive deps by reading
    properties inside `createEffect`.
  - `no-control-regex` — intentional ANSI escape / null-byte sanitization.
  - `triple-slash-reference` — SST and plugin tools require triple-slash refs.
  - `no-shadow` — Effect's nested `function*` closures inherently shadow.
  - `unicorn/consistent-function-scoping` — namespace-heavy codebase makes
    this too noisy.
- Type-aware rules enabled (warn level): `typescript/no-base-to-string`,
  `typescript/no-floating-promises`, `typescript/no-misused-spread`.

---

## Git workflow

- **Default branch**: `main`. Older docs say `dev` — they're wrong, ignore.
- **Local `main`** may not exist after a fresh clone if the remote default
  is via HEAD. Use `origin/main` for diffs.
- **Worktrees** (`.worktrees/` and `.claude/worktrees/`) are gitignored.
- **Stray PNGs / `.tgz`** at repo root are gitignored
  (`/openai-*-dropdown.png`, `/screenshot-*.png`, `*.tgz`). If you see one,
  don't commit it.

### Commit message style

Look at recent commits (`git log -3 --oneline`) before writing your own. The
prevailing style:

- **Plain release commits**: `Release v27.4.X` — short single-line summary +
  body bullet list of changes + Co-Authored-By trailer.
- **Conventional-commit-ish fixes**: `fix(scope): short description` — for
  bug fixes that aren't a release. Examples:
  - `fix(tui): launch packaged TUI bundle and bump to v27.4.4`
  - `fix(updates): show desktop-managed status for instances spawned by the desktop shell`
  - `fix(build): publish @opentui/core-{platform}-{arch} as platform-pkg dep`
  - `ci(desktop-release): publish releases as real, not as drafts`
  - `chore: drop stray browser screenshots, gitignore future ones`

Always include the `Co-Authored-By` trailer for AI-authored commits:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Use a `HEREDOC` for the message body to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
fix(scope): short description

Longer body explaining the why, not just the what.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Push & rebase flow

```bash
git push origin main
# If rejected with non-fast-forward:
git fetch origin main
git pull --rebase origin main
# Resolve conflicts (usually version bumps), then:
git rebase --continue
git push origin main
```

When rebasing my own version-bump commit onto an upstream version-bump commit
(e.g. `Release v27.4.2` from upstream), the conflict is in every
`package.json` and `version.ts`. Resolve by keeping **theirs** (= the commit
being rebased = mine):

```bash
git checkout --theirs README.md bun.lock packages/*/package.json \
  packages/extensions/zed/extension.toml packages/shared/package.json \
  packages/shared/src/version.ts sdks/vscode/package.json
git add .
git rebase --continue
```

### Never do these

- `git push --force` to `main`. Ever.
- `git rebase -i` or any interactive git command (no TTY in agent
  environments).
- `git rebase --no-edit` (not a valid flag for rebase, will error).
- Skip pre-commit hooks (`--no-verify`) without an explicit user request.
- Amend an existing commit (`--amend`). Always create a new commit instead —
  if a hook failed, the commit didn't happen, so amending would silently
  modify the previous commit.

---

## Release process

This is the most failure-prone workflow in the repo. Read it carefully.

### Release checklist (do not skip steps)

```
1. git status — check for uncommitted in-flight work (decide: ship or stash)
2. git fetch origin main && git log HEAD..origin/main — rebase if behind
3. bun run version:bump patch            — bumps packages/shared/src/version.ts
                                            and runs version:sync
   # or: bun run version:bump X.Y.Z      — exact version, v-prefix accepted
4. Confirm version:bump output           — packageJsons should match the expected
                                            release bump count, README updates if needed
5. bun turbo typecheck                   — all 8 packages must be green
6. bun lint                              — 0 errors (warnings ok)
7. (optional but recommended) build smoke test:
     cd packages/codeplane
     bun script/build.ts --skip-embed-web-ui --skip-install --single
     # then verify dist/codeplane-<platform>-<arch>/bin/codeplane --version
8. git add -A
9. git commit -m "Release v27.4.X+1"
10. git push origin main
11. gh release create vX.Y.Z --target main --title "vX.Y.Z" \
       --notes "$(cat <<'EOF' ... EOF)"
12. Watch the workflow runs:
       gh run list --limit 4 --workflow=npm-release
       gh run list --limit 4 --workflow=desktop-release
13. After npm-release succeeds, verify:
       npm install -g codeplane-ai@X.Y.Z && codeplane --version
```

If you hit a failure mid-flow, see [Common pitfalls / footguns](#common-pitfalls--footguns).

### How the version bump propagates

`bun run version:bump [patch|minor|major|X.Y.Z]` runs
`script/bump-version.ts`. It updates the single source of truth,
`packages/shared/src/version.ts`, then calls the same sync path as
`bun run version:sync`.

`bun run version:sync` runs `script/sync-version.ts`, which reads the current
version source and updates:

- Every `package.json` `version` field (9 currently on a release bump).
- `README.md` desktop-tag URLs, "current desktop release" badges, and the
  CLI/desktop/mobile badges.

The script's output looks like:

```
$ bun run version:bump patch
Bumped Codeplane version 28.21.5 -> 28.21.6
{
  "version": "28.21.6",
  "packageJsons": 9,
  "readme": true
}
```

`packageJsons` is the number of files changed in that run. If it drops below
the expected release bump count, verify that a workspace was intentionally
removed or stopped carrying a `version` field.

### The two release tag workflows

A single `vX.Y.Z` tag push triggers **both** workflows:

1. **`.github/workflows/npm-release.yml`** — runs `script/publish.ts`. Builds
   the CLI / per-platform packages and publishes to npm.
2. **`.github/workflows/desktop-release.yml`** — builds the Electron desktop
   shell and creates a paired `vX.Y.Z-desktop` GitHub release with installers
   for macOS (arm64 + x64), Linux (deb / AppImage / tar.gz), and Windows
   (.exe).

Both workflows are also triggered by `workflow_dispatch` if you need to
manually re-run a release without re-tagging.

### npm-release flow

The driver is `script/publish.ts`. It:

1. Fetches origin tags + checks out the source tag in detached HEAD.
2. Calls `prepareReleaseFiles()`:
   - `syncVersionFiles(Script.version)` — same code as `bun run version:sync`.
   - `bun install` — refresh lockfile.
   - **`bun run --cwd packages/codeplane build`** — runs
     `packages/codeplane/script/build.ts`. **This is where most failures
     happen** — see [Build pipeline deep dive](#build-pipeline-deep-dive).
   - `./packages/sdk/js/script/build.ts` — regenerates the JS SDK.
3. Publishes to npm (one package per platform plus the meta `codeplane-ai`).

If the build fails, the npm publish never happens — but the GitHub release
entry created via `gh release create` already exists. **Always check
`gh run list --workflow=npm-release` after a release** to confirm publish
succeeded. v27.4.18 and v27.4.19 both shipped a GitHub release with no npm
artifacts because of a bundler error nobody noticed at first.

### desktop-release flow

`.github/workflows/desktop-release.yml` is triggered on every `v*` tag push.
The flow:

1. **`resolve` job**: parses the tag. If the tag is `v*-desktop` and was pushed
   directly (not via the paired CLI tag), exits without doing anything.
   Otherwise resolves `source_tag = vX.Y.Z` and `desktop_tag = vX.Y.Z-desktop`.
2. **`create-release` job**: creates the desktop GitHub release **as a real
   release immediately** (not a draft — the historic `--draft` flag was
   removed in v27.4.13's workflow fix). Title and notes mirror the source
   release.
3. **`build-desktop` matrix**: builds for `mac` (dmg + zip, arm64 + x64),
   `linux` (deb + AppImage + tar.gz, x64), and `win` (nsis + zip, x64).
   Uses `electron-builder`. Each platform uploads its artifacts to the
   already-created desktop release as they finish.
4. **`publish-release` job**: runs with `if: always()` so a single failed or
   hanging matrix job (most often the slow Windows build) doesn't leave the
   release un-promoted. Mirrors title/notes from the source release and sets
   `--latest`.

The reason `if: always()` matters: prior to the v27.4.13 workflow fix, every
desktop release sat as a Draft until **all** matrix jobs finished. A hung
Windows build meant the release never went live. Now the release is visible
the moment `create-release` runs and is auto-promoted to `--latest` even if
one matrix job fails.

### Release notes template

GitHub release notes follow a fixed structure. **Do not** title or open the
notes with `Codeplane <version>`. Start at `## Highlights`. Keep section
headings factual.

For a routine release:

```md
## Highlights

Codeplane **vX.Y.Z** rolls forward in-flight <area> work and bumps version
metadata across all workspaces.

## What's new

- **<area>**: short bullet describing the change.
- **<area>**: …

## Validation

- **Typecheck**: 8/8 packages clean (`bun turbo typecheck`).
- **Lint**: 0 errors (`bun lint`).

## Release artifacts

- npm: `codeplane-ai@X.Y.Z`, `@codeplane-ai/sdk@X.Y.Z`, `@codeplane-ai/plugin@X.Y.Z`
- Desktop installers publish on the paired `vX.Y.Z-desktop` release line —
  created as a real release immediately (no draft).
```

For a hotfix (most common case for this repo):

```md
## Hotfix

Codeplane **vX.Y.Z** fixes <one-sentence description of the user-visible bug>.

### Root cause

A precise paragraph explaining what was wrong, ideally referencing the file
and line that contained the bug.

### Fix

1. **`path/to/file`**: bullet describing the change.
2. **`path/to/other`**: bullet describing the change.

### Verified

- Test command run, expected output, actual output (or "smoke test passes").
- Typecheck / lint status.

### Upgrade

\`\`\`sh
npm install -g codeplane-ai@X.Y.Z
\`\`\`

## Release artifacts

- npm: `codeplane-ai@X.Y.Z`, `@codeplane-ai/sdk@X.Y.Z`, `@codeplane-ai/plugin@X.Y.Z`
- Desktop installers publish on the paired `vX.Y.Z-desktop` release line.
```

`gh release create` with `--notes "$(cat <<'EOF' ... EOF)"` — the heredoc
preserves Markdown formatting including code blocks.

### Verifying a release end-to-end

```bash
# 1. Confirm the GitHub release exists and is not a draft
gh release list --limit 4

# 2. Confirm the npm publish succeeded
gh run list --workflow=npm-release --limit 4

# 3. Install and smoke-test
npm install -g codeplane-ai@X.Y.Z
codeplane --version
codeplane               # should launch the TUI

# 4. Confirm desktop assets uploaded
gh release view vX.Y.Z-desktop --json assets | \
  jq -r '.assets[].name' | sort

# 5. Confirm desktop release is promoted to Latest
gh release list --limit 4 | grep "Latest"
```

If `codeplane --version` returns the **old** version after `npm install -g`,
something failed silently. Check the `npm install -g` exit code — if it
warned about `Could not find a matching Codeplane binary package`, the
postinstall hit the optional-dependency race fixed in v27.4.7. See
[postinstall race](#postinstall-race-cant-find-codeplane-platform-arch).

---

## Build pipeline deep dive

`packages/codeplane/script/build.ts` is the most failure-prone file in the
repo. Read this section before changing it.

### Two Bun.build calls

The build does **two** independent `Bun.build` calls per platform:

1. **Main CLI bundle** (line ~217). Entrypoint `./src/index.ts`. Output:
   `dist/<name>/bin/codeplane` (Bun-compiled standalone executable).
2. **TUI bundle** (`buildTUIBundle`, line ~82). Entrypoint
   `./src/tui/node-main.tsx`. Output: `dist/<name>/bin/runtime/tui/node-main.js`
   plus copied wasm parsers and audio assets.

These are **bundled separately** so the main CLI binary stays small and the
TUI ships as a regenerable JS file the launcher spawns via Bun.

### Build configuration that MUST stay correct

#### Main CLI bundle

```js
await Bun.build({
  // CRITICAL: top-level `target: "bun"` so the bundler classifier accepts
  // "bun" builtin imports in dynamic chunks (e.g. solid-plugin.ts pulled in
  // by tui/launcher.ts → buildDevEntry's dynamic import). Without this the
  // bundler defaults to a browser-style classifier even though
  // `compile.target` produces a Bun standalone.
  target: "bun",
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  external: ["node-gyp", /* + opentui plugin entries marked external */],
  format: "esm",
  minify: true,
  splitting: true,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: name.replace(pkg.name, "bun") as any,  // → "bun-darwin-arm64" etc.
    outfile: `dist/${name}/bin/codeplane`,
    execArgv: [`--user-agent=codeplane/${Script.version}`, "--use-system-ca", "--"],
    windows: {},
  },
  files: embeddedFileMap ? { "codeplane-web-ui.gen.ts": embeddedFileMap } : {},
  entrypoints: ["./src/index.ts", ...(embeddedFileMap ? ["codeplane-web-ui.gen.ts"] : [])],
  define: {
    CODEPLANE_VERSION: `'${Script.version}'`,
    CODEPLANE_MIGRATIONS: JSON.stringify(migrations),
    CODEPLANE_CHANNEL: `'${Script.channel}'`,
    CODEPLANE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
  },
})
```

#### TUI bundle

```js
const buildTUIBundle = async (outdir: string) => {
  // CRITICAL: the Solid Babel transform plugin must be loaded — without it
  // the bundler can't import jsxDEV from @opentui/solid/jsx-runtime (it
  // ships only .d.ts).
  const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
  const result = await Bun.build({
    entrypoints: ["./src/tui/node-main.tsx"],
    // CRITICAL: target MUST be "bun" — the new TUI uses bun:ffi via
    // @opentui/core and registerBunPlugin via @opentui/solid. The historic
    // target: "node" was wrong and broke from v27.4.18 onward.
    target: "bun",
    format: "esm",
    minify: true,
    splitting: false,
    outdir,
    plugins: [createSolidTransformPlugin()],
    conditions: ["browser"],
  })
  if (!result.success) throw new AggregateError(...)
}
```

#### Per-platform package.json with @opentui/core dep

Critical for the TUI to actually launch on a fresh install. After the build,
each `dist/<name>/package.json` MUST declare a runtime dep on the matching
`@opentui/core-{platform}-{arch}`:

```js
const opentuiCorePackage =
  `@opentui/core-${item.os === "win32" ? "win32" : item.os}-${item.arch}`
const opentuiCoreVersion = pkg.dependencies["@opentui/core"]

await Bun.file(`dist/${name}/package.json`).write(
  JSON.stringify({
    name,
    version: Script.version,
    license: pkg.license,
    repository: { type: "git", url: repoURL },
    bugs: { url: `${repoURL}/issues` },
    homepage: repoURL,
    os: [item.os],
    cpu: [item.arch],
    dependencies: {
      [opentuiCorePackage]: opentuiCoreVersion,
    },
  }, null, 2),
)
```

The TUI bundle does
`require(`@opentui/core-${process.platform}-${process.arch}/index.ts`)` at
runtime, so this dep MUST be installed alongside. If it's missing, you get:

```
error: Cannot find module '@opentui/core-darwin-arm64/index.ts' from
'/.../codeplane-darwin-arm64/bin/runtime/tui/node-main.js'
```

This was the v27.4.21 hotfix. Don't regress it.

### TUI source layout (post-v27.4.18 restructure)

Inside `packages/codeplane/src/tui/`:

```
tui/
├── _compat/              ← compatibility shims for non-tui modules importing tui logic
├── asset/                ← embedded TUI assets (sounds, wasm parsers, highlight queries)
├── attach.ts             ← cli/cmd "attach" entrypoint
├── boot/                 ← boot wizard (instance picker, dir picker, local-form)
├── client.ts             ← SDK client construction + URL normalization
├── component/            ← SolidJS components (DialogX, Prompt, Spinner, …)
├── config/               ← TUI runtime config (themes, parsers)
├── context/              ← context providers (theme, sdk, sync, editor, exit, keybind, …)
├── dispatch.ts           ← parses argv to decide tui vs web vs subcommand
├── feature-plugins/      ← built-in TUI plugin modules (system/plugins, system/session-v2)
├── instance-service.ts   ← thin wrapper around shared/instance-store
├── launcher.ts           ← spawns the TUI bundle with a Bun runtime
├── node-main.tsx         ← TUI entrypoint built by buildTUIBundle
├── plugin/
│   ├── runtime.ts        ← `TuiPluginRuntime` (host for TUI plugins)
│   └── slots.tsx         ← <Slot> JSX component
├── presenter.ts, scenes.tsx, view.tsx, theme.ts ← legacy split (replaced in v27.4.18)
├── routes/               ← route components (home, session/, …)
├── thread.ts             ← cli/cmd "thread" entrypoint
├── ui/                   ← OpenTUI primitives (dialog, toast, spinner, link)
├── validate-session.ts
├── win32.ts              ← Windows-only ConHost initialization
└── worker.ts             ← cross-thread RPC worker
```

#### Module reachability rules (critical for build correctness)

The main CLI bundle starts at `src/index.ts` and **must not transitively
reach** any module that imports the `bun` builtin at module top-level. The
forbidden chain looks like:

```
src/index.ts
  → cli/cmd/instance.ts
  → tui/instance-service.ts (OK)
  → tui/client.ts (OK)
src/index.ts
  → cli/cmd/tui.ts
  → tui/launcher.ts (OK — bun-plugin import is dynamic inside buildDevEntry)
src/index.ts
  → config/plugin.ts
  → tui/_compat/plugin-shared.ts (OK — re-exports core only)
```

If a new file in `tui/` static-imports something that imports
`@opentui/solid/bun-plugin`, `@opentui/solid/runtime-plugin-support`, or any
`from "bun"` constant — and that file is reachable from `src/index.ts` — the
main bundle build will fail. Dynamic-import the offending dependency or move
the import to `tui/node-main.tsx` (the TUI entry, bundled with `target: "bun"`).

### How to debug a build failure

1. **Run the build locally** with `--single` to skip the cross-compile loop:
   ```bash
   cd packages/codeplane
   rm -rf dist
   bun script/build.ts --skip-embed-web-ui --skip-install --single
   ```
2. **Distinguish main bundle vs TUI bundle failures** by reading the `error`
   path:
   - Errors that mention `node_modules/.bun/@opentui+solid/...
     runtime-plugin-support-configure.ts` are reaching the Solid runtime
     plugin via the main bundle. Check `tui/plugin/runtime.ts` and any
     non-`tui/` file that imports it.
   - Errors that mention `@opentui/solid/jsx-runtime.d.ts: No matching export
     "jsxDEV"` are TUI bundle errors. The `createSolidTransformPlugin()` is
     missing — verify `buildTUIBundle` registers it.
   - Errors that mention a source `.tsx` file with `from "bun"` — replace
     with `from "node:url"` (for `fileURLToPath`/`pathToFileURL`) or another
     non-bun standard module.
3. **Add temporary debug logging** before / after the failing `Bun.build`
   call:
   ```js
   console.log("[debug] cwd=", process.cwd())
   const result = await Bun.build({ ... })
   console.log("[debug] success?", result.success, "logs:", result.logs.length)
   for (const log of result.logs) console.log("[debug log]", log.message)
   if (!result.success) process.exit(1)
   ```
4. **Smoke-test the binary** once the build succeeds:
   ```bash
   ./dist/codeplane-darwin-arm64/bin/codeplane --version
   ```
   The build script does this automatically when the target matches the
   current platform.

### Embedded web UI

Unless `--skip-embed-web-ui` is passed, the build runs `bun run --cwd
packages/app build` and embeds every file under `packages/app/dist/` into the
binary as `with { type: "file" }` blobs (one import per file). The result is
exposed at runtime via the `codeplane-web-ui.gen.ts` virtual entry.

Skip this step (with `--skip-embed-web-ui`) when iterating on a build issue
locally — it cuts the build time roughly in half.

### Release vs single vs cross-platform

Build script flags:

- `--single` — only build for the current platform/arch. Fastest path for
  iteration.
- `--baseline` — also build baseline (non-AVX2) variants when paired with
  `--single`.
- `--skip-install` — skip the `bun install --no-save --os="*" --cpu="*"
  @parcel/watcher@<version>` step at the top. Use when you've already
  installed once.
- `--skip-embed-web-ui` — skip building the web app and embedding it into
  the binary.

Without flags, the script builds **all 12 platform variants** and is slow
(~10 minutes locally, ~5 minutes on CI per platform).

### What gets shipped to npm

Each `dist/<name>/` becomes one npm package:

```
codeplane-darwin-arm64/
├── package.json          ← generated by build.ts (with @opentui/core dep)
└── bin/
    ├── codeplane         ← Bun standalone binary
    └── runtime/
        └── tui/
            ├── node-main.js
            ├── *.wasm    ← tree-sitter parsers
            ├── *.scm     ← highlight queries
            └── *.wav     ← UI sounds
```

Plus the meta package `codeplane-ai`:

```
codeplane-ai/
├── package.json          ← optionalDependencies for every codeplane-{platform}-{arch}
├── postinstall.mjs       ← hardlinks the platform binary into bin/.codeplane
├── bin/
│   └── codeplane         ← Node JS shim that finds + spawns the platform binary
└── LICENSE
```

The npm wrapper (`packages/codeplane/bin/codeplane`) is the JS shim. It:

1. Checks `CODEPLANE_BIN_PATH` env var for an explicit override.
2. Checks `<scriptDir>/.codeplane` for a postinstall-hardlinked fast-start
   binary.
3. Walks `node_modules` ancestors looking for the matching
   `codeplane-{platform}-{arch}/bin/codeplane`.
4. Spawns the resolved binary with `CODEPLANE_BIN_DIR` set to the real
   platform-package bin dir (so the spawned binary can locate its sibling
   assets like `runtime/tui/node-main.js` even when run via the hardlinked
   `.codeplane`).

---

## CI workflows reference

### `.github/workflows/npm-release.yml`

Runs `script/publish.ts` on every `v*` tag push. Publishes to npm.

Key steps:

1. Checkout, install bun, run `bun install`.
2. `bun run script/publish.ts` — drives the per-platform build via
   `script/build.ts` and runs `npm publish` on each `dist/<name>/`.

Failure modes I've actually seen:

- `Build failed: Browser build cannot import Bun builtin: "bun"` — fixed in
  v27.4.20. Do not regress.
- `Cannot find module '@opentui/core-darwin-arm64/index.ts'` — fixed in
  v27.4.21. Do not regress.
- Network error fetching tarball during cross-platform `@parcel/watcher`
  install — usually retries succeed on rerun.

### `.github/workflows/desktop-release.yml`

Runs on every `v*` tag push (including `v*-desktop`). Builds Electron
installers for macOS / Linux / Windows.

Key jobs:

- `resolve` — resolves `source_tag` and `desktop_tag`. Skips if push was a
  `v*-desktop` tag (avoids infinite loop with the paired tag).
- `create-release` — creates the desktop GitHub release **as a real release
  immediately** (no `--draft`). Per the v27.4.13 workflow fix.
- `build-desktop` — matrix over `macos-14`, `ubuntu-24.04`, `windows-2025`
  with `electron-builder`. Uploads artifacts to the desktop release.
- `publish-release` — runs with `if: always()` so a single matrix failure
  doesn't block promotion to `--latest`.

Failure modes I've actually seen:

- Windows build hangs in `setup-bun` action for 10+ minutes. Cancel and
  retry, or wait — `if: always()` ensures `publish-release` still runs.
- electron-builder native module rebuild fails on Linux when missing
  `libnss3.so` headers — usually a transient action runner issue.

### Workflow auth

Both workflows use the auto-injected `GITHUB_TOKEN` for `gh release` /
`gh api` calls. npm publish uses the `NPM_TOKEN` repo secret (must be a
classic automation token with publish permissions for the
`@codeplane-ai/*` scope and `codeplane-{platform}-{arch}` packages).

If npm publish ever 403s, the token expired — regenerate at
[npmjs.com → Access Tokens](https://www.npmjs.com/settings/your-username/tokens)
and update the `NPM_TOKEN` secret.

---

## Architecture overview

Codeplane is one product with multiple frontends sharing the same runtime
model and shared state.

### High-level component map

```
                          ┌──────────────────┐
                          │  Codeplane home  │
                          │   ~/Library/...  │
                          └────────▲─────────┘
                                   │ (instances.json,
                                   │  codeplane.jsonc, plugins/, …)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
   ┌────┴─────┐               ┌────┴─────┐               ┌────┴─────┐
   │   CLI    │               │  Desktop │               │   Web    │
   │ (yargs)  │               │ (Electron)               │ (Astro)  │
   └────┬─────┘               └────┬─────┘               └────────  ┘
        │                          │ spawns
        │ in-process               │
   ┌────┴──────────────────────────┴─────────┐
   │           Codeplane server              │
   │     (Hono + Effect, SQLite store)       │
   └─────────────────────────────────────────┘
                       ▲
                       │ HTTP / SSE
                       │
                  ┌────┴─────┐
                  │  SolidJS │
                  │   TUI    │
                  └──────────┘
```

### Shared `Codeplane` home folder

One shared OS-native home folder named `Codeplane`. Desktop, TUI, CLI, local
instances, plugins, skills, and shared instance state all live under that
root.

Default root:

- **macOS**: `~/Library/Application Support/Codeplane`
- **Windows**: `%APPDATA%\Codeplane`
- **Linux**: `$XDG_CONFIG_HOME/Codeplane` or `~/.config/Codeplane`

Layout (see `packages/shared/src/home.ts`):

```
Codeplane/
├── codeplane.jsonc             ← global config (or codeplane.json / config.json)
├── instances.json              ← shared saved-instance registry
├── agents/                     ← custom agents
├── bin/
├── cache/
├── commands/                   ← custom slash commands
├── data/
├── local_server/
│   ├── binaries/               ← cached local runtime binaries by version
│   └── <instance-id>/          ← one managed local server + its data
│       ├── bin/
│       ├── cache/
│       ├── data/
│       ├── log/
│       └── state/
├── log/
├── plugins/
├── skills/
└── state/
```

`codeplane config paths` shows the live values on the user's machine.

### Path resolution

`packages/shared/src/home.ts` exports `paths()` which respects the following
env vars (each falls back to a derived default):

- `CODEPLANE_HOME_DIR` — root override (default: per-OS path above)
- `CODEPLANE_DATA_DIR` — default `<root>/data`
- `CODEPLANE_CACHE_DIR` — default `<root>/cache`
- `CODEPLANE_STATE_DIR` — default `<root>/state`
- `CODEPLANE_BIN_DIR` — default `<root>/bin`
- `CODEPLANE_LOG_DIR` — default `<root>/log`

`CODEPLANE_TEST_HOME` overrides the OS-derived home for test isolation.

### Managed config locations

For device management or system-wide deployment, Codeplane ALSO reads managed
config from:

- **macOS**: `/Library/Application Support/Codeplane`
- **Windows**: `%ProgramData%\Codeplane`
- **Linux**: `/etc/Codeplane`

Managed config is merged below user config — user config takes precedence per
key.

---

## CLI command structure

All CLI commands live in `packages/codeplane/src/cli/cmd/` and are registered
in `packages/codeplane/src/index.ts` as yargs `CommandModule`s wrapped by the
`cmd()` typed helper from `cli/cmd/cmd.ts`.

Top-level commands:

| Command | Description | File |
| :--- | :--- | :--- |
| `tui` | Start the terminal UI | `cli/cmd/tui.ts` |
| `web` | Start the server + open the web app | `cli/cmd/web.ts` |
| `serve` | Start the headless server | `cli/cmd/serve.ts` |
| `instance` | Manage saved instances + local runtime | `cli/cmd/instance.ts` |
| `config` | Inspect/manage Codeplane config | `cli/cmd/config.ts` |
| `upgrade` | Upgrade codeplane to latest or pinned version | `cli/cmd/upgrade.ts` |
| `agent` | Manage agents | `cli/cmd/agent.ts` |
| `models` | Manage models | `cli/cmd/models.ts` |
| `mcp` | Manage MCP servers | `cli/cmd/mcp.ts` |
| `plug` | Manage plugins | `cli/cmd/plug.ts` |
| `providers` | Manage providers | `cli/cmd/providers.ts` |
| `account` | Manage console account | `cli/cmd/account.ts` |
| `acp` | Agent Communication Protocol entry | `cli/cmd/acp.ts` |
| `db` | Database commands (drizzle generate) | `cli/cmd/db.ts` |
| `debug` | Debug subcommands (snapshot, scrap, agent, file, lsp, ripgrep, …) | `cli/cmd/debug/` |
| `export` / `import` | Export / import sessions | `cli/cmd/export.ts`, `cli/cmd/import.ts` |
| `generate` | Code generation (OpenAPI etc.) | `cli/cmd/generate.ts` |
| `github` | GitHub integration | `cli/cmd/github.ts` |
| `pr` | PR-related commands | `cli/cmd/pr.ts` |
| `run` | Run a one-shot agent task | `cli/cmd/run.ts` |
| `session` | Session subcommands | `cli/cmd/session.ts` |
| `stats` | Session stats | `cli/cmd/stats.ts` |
| `uninstall` | Uninstall codeplane | `cli/cmd/uninstall.ts` |

`instance` subcommands (most common):

| Subcommand | What it does |
| :--- | :--- |
| `instance list` | List saved instances |
| `instance add [target]` | Save a remote URL or `--local` instance |
| `instance show <id>` | Show a saved instance record |
| `instance use <id>` | Mark as default selection |
| `instance remove <id>` | Remove a saved instance |
| `instance probe <target>` | Probe a saved id or URL via `/global/version` |
| `instance open <id>` | Resolve and open (start a local runtime if needed) |
| `instance local target` | Show the resolved npm target for this machine |
| `instance local status [version]` | Show whether a runtime version is installed |
| `instance local install [version]` | Install a runtime from npm |
| `instance local update` | Install latest runtime + repoint saved local instances |

`config` subcommands:

| Subcommand | What it does |
| :--- | :--- |
| `config show` | Print effective or shared global config |
| `config get <path>` | Read a value (`--global` for shared only) |
| `config set <path> <value>` | Set a shared global value (`--json` to parse value as JSON) |
| `config unset <path>` | Remove a shared global value |
| `config paths` | Show canonical config and data paths |

### Argv resolution

When the user runs bare `codeplane` (no subcommand), `tui/dispatch.ts` decides:

- Interactive terminal (`process.stdin.isTTY && process.stdout.isTTY`) → `tui`
- Non-interactive → `web`

The dispatcher mutates argv to insert the chosen subcommand before yargs
parses. Global flags like `--print-logs`, `--pure`, `--log-level`, `-h`,
`-v` short-circuit the auto-insertion.

---

## Server / API architecture

The server is built with [Hono](https://hono.dev/) + [Effect](https://effect.website/).
Entry point: `packages/codeplane/src/server/`. Every HTTP route is defined
with `describeRoute({ summary, description, operationId, responses })` so the
OpenAPI schema can be regenerated.

Common patterns:

- All handlers return JSON envelopes (`{ success: true, ... }` or
  `{ success: false, error: "..." }`). Even error paths return parseable
  JSON, never empty 5xx bodies.
- Server-Sent Events for real-time updates (sessions, sync events).
- `AppRuntime.runPromise(...)` runs an Effect at the route boundary.
- `Effect.catch(...)` wraps each fallible step; the route handler also has
  an outer JS `try/catch` around `runPromise(...)` so any unhandled defect
  becomes a structured 500 instead of a no-body 500. **This guarantee was
  added in v27.4.11 — do not regress.**

### `/global/upgrade` route

The most-touched server route in the recent history. Located at
`packages/codeplane/src/server/routes/global.ts`.

Behavior:

1. `svc.method()` returns the detected install method:
   - `selfhosted` — `CODEPLANE_UPGRADE_SCRIPT` env var set
   - `desktop` — `CODEPLANE_DESKTOP_MANAGED=1` (set by the desktop shell when
     it spawns a local server, see v27.4.9)
   - `curl` — `process.execPath` includes `.codeplane/bin` or `.local/bin`
   - `npm` / `yarn` / `pnpm` / `bun` — match by listing global packages
   - `brew` / `scoop` / `choco` — match by listing the OS package manager
   - `unknown` — no match
2. If `method === "unknown"` → 400 with `"Unknown installation method"`.
3. If `method === "desktop"` → 400 with `"Updates for desktop-managed
   instances are handled by the Codeplane desktop app. Open the desktop
   app's Updates panel to install a new version."`
4. Otherwise resolve the target version (body `target` or `svc.latest(method)`).
5. If target equals current version → 200 with `skipped: true`.
6. Run `svc.upgrade(method, target)`. On error → 500 with the error message.
7. On success → 200 with `restart` and `restartRequired` flags depending on
   method.
8. Outer `try/catch` around `runPromise` returns 500 with `Upgrade failed:
   <message>` for any unhandled failure.

**Do not regress the outer try/catch** — it's the only thing protecting the
client from no-body 500 responses.

---

## TUI architecture

### Two TUIs in the repo

There were two generations of TUI in this repo:

- **Legacy TUI**: an `opentui`-based TUI loaded via the OLD architecture.
  Files like `tui/app.tsx`'s pre-v27.4.18 incarnation, `presenter.ts`,
  `scenes.tsx`, `view.tsx`, `theme.ts`. **All deleted in v27.4.18** in favor
  of the new layout.
- **New SolidJS TUI**: `tui/node-main.tsx` is the entry. Uses
  `@opentui/solid` (SolidJS bindings on top of `@opentui/core`'s native
  bun:ffi renderer). Bundled separately (`buildTUIBundle`) and spawned via
  Bun.

### TUI lifecycle

1. User runs `codeplane` (or `codeplane tui`).
2. CLI yargs handler in `cli/cmd/tui.ts` calls `launchTUI(args)`.
3. `tui/launcher.ts` resolves a runtime (`bun` preferred, `node` fallback)
   and the path to `runtime/tui/node-main.js` (next to `process.execPath` or
   `CODEPLANE_BIN_DIR`).
4. `launcher` `spawn()`s the runtime + the bundle as a child process,
   inheriting stdio.
5. The child process loads `node-main.js`, registers the OpenTUI Solid
   runtime plugin, parses argv, runs the boot wizard, and finally hands off
   to `tui/app.tsx`'s `tui()` function.

### Critical files (DO NOT BREAK)

- `tui/launcher.ts` — the only file in `tui/` reachable from the main CLI
  bundle besides `tui/dispatch.ts`. Imports MUST stay carefully gated:
  - **No** static `import "@opentui/solid/runtime-plugin-support"` (would
    pull `runtime-plugin-support-configure.ts` which has `from "bun"`).
  - **No** static `import "@opentui/solid/bun-plugin"` (same reason).
    Dynamic-import inside `buildDevEntry` only.
  - The `bundledRuntimeCandidates` list controls runtime resolution order:
    bundled bun > bundled bun.exe > bundled runtime/bun > runtime/bun.exe >
    bundled node > runtime/node > runtime/node.exe > `which.sync("bun")` >
    `which.sync("node")`.
  - `resolveBundledEntry` searches several candidate paths AND walks up
    `node_modules` ancestors as a last resort (so npm hardlinked installs
    where `process.execPath` is in a sibling package still resolve).
- `tui/node-main.tsx` — the TUI entry. **MUST** start with
  `import "@opentui/solid/runtime-plugin-support"` so the runtime plugin is
  installed before any other TUI code loads.
- `tui/plugin/runtime.ts` — `TuiPluginRuntime`. **MUST NOT** statically
  import `@opentui/solid/runtime-plugin-support` (it's reachable via
  `tui/app.tsx` indirectly — moved to `node-main.tsx` in v27.4.20).
- `tui/component/dialog-status.tsx` and `tui/component/prompt/autocomplete.tsx`
  — **MUST** use `from "node:url"` for `fileURLToPath` / `pathToFileURL`,
  not `from "bun"` (pre-v27.4.20 was `from "bun"` and broke the build).

### TUI native dependency: `@opentui/core-{platform}-{arch}`

The TUI uses `bun:ffi` via `@opentui/core` to render. The native binding ships
in per-platform packages: `@opentui/core-darwin-arm64`,
`@opentui/core-linux-x64`, `@opentui/core-win32-x64`, etc.

The main `@opentui/core` package lists these as `optionalDependencies`, so
when YOU install `@opentui/core`, npm pulls the right one for your platform.

But our published `codeplane-{platform}-{arch}` packages **bundle**
`@opentui/core` into `runtime/tui/node-main.js`. The bundled code does:

```js
require(`@opentui/core-${process.platform}-${process.arch}/index.ts`)
```

at runtime to load the native binding. So **the `codeplane-{platform}-{arch}`
package itself MUST list the matching `@opentui/core-{platform}-{arch}` as a
real `dependencies` entry**.

This is added in `packages/codeplane/script/build.ts` when generating
`dist/<name>/package.json`. **Never remove it.** If you remove it, every
fresh install fails with:

```
Cannot find module '@opentui/core-darwin-arm64/index.ts' from
'/.../codeplane-darwin-arm64/bin/runtime/tui/node-main.js'
```

This was the v27.4.21 hotfix.

### TUI plugin runtime

`tui/plugin/runtime.ts` exposes `TuiPluginRuntime` — the host for TUI plugins
loaded from `Codeplane/plugins/` and from npm packages. Plugins extend the
TUI via:

- `Slot` JSX components for sidebar / app placement
- Theme registration
- Custom dialogs

Plugins use `@codeplane-ai/plugin/tui` types to declare their shape. See
`packages/plugin/src/tui.ts`.

---

## Desktop shell architecture

`packages/desktop/` is an Electron app. Entry: `src/main/main.ts`.

### Main responsibilities

- Owns the BrowserWindow.
- Handles `electron-updater` for auto-updating the desktop shell itself.
- Spawns local Codeplane server processes via `local-instance.ts`
  (re-exports `createLocalInstanceManager` from `@codeplane-ai/shared`).
- Routes the `ui-host.ts` proxy that lets the renderer talk to the local
  server.
- Implements IPC handlers for `updater:check`, `updater:download`,
  `updater:install`, `updater:release-notes`, etc. (see `src/main/preload.ts`
  for the IPC surface).

### Update flow (electron-updater)

`autoUpdater.checkForUpdates()` is wired up in `setupAutoUpdater()` (around
line 1860 of `src/main/main.ts`). It's gated by:

- `app.isPackaged` — must be a packaged build (not unpacked dev).
- `process.env.CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE !== "1"`.
- `mockUpdaterMode()` returns null (else uses mock).

If gated off, IPC handlers return a clear `Desktop auto-update is only
available in packaged builds.` message instead of silently doing nothing.

### Spawning local servers

`packages/shared/src/local-instance.ts` is the manager. It:

1. `download(version)` — installs the codeplane runtime into
   `<binariesDir>/<version>/bin/codeplane` via npm tarball fetch.
2. `start({ id, binaryVersion })` — spawns the binary with `serve --hostname
   127.0.0.1 --port 0` and waits for the "listening on" log line to extract
   the ephemeral port.
3. **Always sets `CODEPLANE_DESKTOP_MANAGED=1` in the spawn env.** This is
   what makes `Installation.method()` return `"desktop"` so the in-instance
   Settings UI shows the "managed by desktop" message instead of "automatic
   updates unavailable". **Do not remove.**
4. Other env vars set: `CODEPLANE_HOME_DIR`, `CODEPLANE_DATA_DIR`,
   `CODEPLANE_CACHE_DIR`, `CODEPLANE_STATE_DIR`, `CODEPLANE_BIN_DIR`,
   `CODEPLANE_LOG_DIR`, `XDG_*` mirrors, `HOME`.

---

## Local instance management

Each saved local instance gets its own subdirectory under
`<root>/local_server/<instance-id>/` with isolated `data/`, `cache/`, `state/`,
`bin/`, `log/`. The `config/` subdirectory holds a per-instance `codeplane.json`
so two parallel local instances never clobber each other.

The shared local runtime binaries cache (`<root>/local_server/binaries/`) is
keyed by version — multiple local instances can share the same downloaded
binary version.

The CLI subcommands (`codeplane instance local install/update/status/target`)
and the desktop's local-instance manager both go through
`packages/shared/src/local-runtime.ts` for the actual download/install logic.

`local-runtime.ts` resolves the npm package name via:

```
codeplane-{platform}-{arch}[-baseline][-musl]
```

Where:
- `platform` = `darwin` / `linux` / `windows`
- `arch` = `arm64` / `x64`
- `baseline` = AVX2-not-supported variant (x64 only, decided by `sysctl
  hw.optional.avx2_0` on macOS, `/proc/cpuinfo` on Linux,
  `IsProcessorFeaturePresent(40)` via PowerShell on Windows)
- `musl` = `/etc/alpine-release` exists OR `ldd --version` mentions musl

---

## Update flow audit

Five update paths exist; all must work end-to-end. (This audit drove the
v27.4.19 hotfix.)

### 1. CLI `codeplane upgrade`

`packages/codeplane/src/cli/cmd/upgrade.ts`. Behavior:

- `svc.method()` detects install method.
- If `method === "unknown"`, prompts the user for a method (npm / pnpm /
  yarn / bun / brew / curl / cancel). **Used to be a yes/no dialog that left
  method unset and hit a default-case error — fixed in v27.4.19.**
- If `method === "desktop"`, prints "use the desktop app's Updates panel"
  and exits cleanly. **Added in v27.4.19.**
- Otherwise calls `svc.latest(method)` (with the picked method, not the
  detected one — so brew users get the brew formula's version).
- Calls `svc.upgrade(method, target)` and shows a spinner.

### 2. Server `POST /global/upgrade`

See [/global/upgrade route](#globalupgrade-route).

### 3. In-instance Settings UI

`packages/app/src/components/settings-general.tsx` reads `versionInfo()`
from `packages/app/src/context/updates.tsx` (which fetches `GET
/global/version`). The UI:

- Hides the "Update Now" button when `method === "unknown"` or `method === "desktop"`.
- Renders the matching i18n description: `descriptionUpToDate`,
  `descriptionHasUpdate`, `descriptionUnknownMethod`, or
  `descriptionDesktopManaged`.
- New i18n key `descriptionDesktopManaged` was added in v27.4.9 with EN/DE
  translations.

### 4. Desktop electron-updater

See [Desktop shell architecture](#desktop-shell-architecture) → "Update flow".

### 5. Local instance update (`codeplane instance local update`)

Updates the shared cached binary used by all desktop local instances. Uses
`local-runtime.ts` to fetch the latest npm tarball.

### Method type (`packages/codeplane/src/installation/index.ts`)

```ts
export type Method =
  | "curl"
  | "selfhosted"
  | "desktop"
  | "npm"
  | "yarn"
  | "pnpm"
  | "bun"
  | "brew"
  | "scoop"
  | "choco"
  | "unknown"
```

`latestImpl` and `upgradeImpl` switch on this type. **Every member must have
both a `latest` resolution and an `upgrade` command.** Yarn was missing from
both for several releases — fixed in v27.4.19. Don't add a new method
without wiring all three (detection, latest, upgrade).

---

## Common pitfalls / footguns

### postinstall race: "Can't find codeplane-{platform}-{arch}"

Symptom (during `npm install -g codeplane-ai`):

```
npm error Failed to setup codeplane binary: Could not find a matching
Codeplane binary package for darwin/arm64. Tried codeplane-darwin-arm64
```

Cause: The `postinstall.mjs` runs before npm has fully linked the optional
platform dependency into `node_modules`, so `require.resolve(
'codeplane-darwin-arm64/package.json')` fails.

Fix (already shipped in v27.4.7): the postinstall now retries `findBinary()`
5x with 200ms async backoff, and on final failure **warns and exits 0**
instead of failing the install. The CLI still launches via the wrapper's
runtime resolution; only the fast-start cache (the hardlink at
`codeplane-ai/bin/.codeplane`) is skipped.

If you ever see this error again, the retry/warn-and-exit-0 logic in
`packages/codeplane/script/postinstall.mjs` was regressed.

### Bundle reaches `runtime-plugin-support-configure.ts`

Symptom (during `bun script/build.ts`):

```
error: Browser build cannot import Bun builtin: "bun".
When bundling for Bun, set target to 'bun'
    at .../@opentui/solid/scripts/runtime-plugin-support-configure.ts:1:45
```

Cause: a file reachable from `src/index.ts` static-imports
`@opentui/solid/runtime-plugin-support` (whose top-level executes
`ensureRuntimePluginSupport()` which uses `registerBunPlugin` via `from
"bun"`).

Fix: don't statically import that module from anywhere in the main bundle's
reachability cone. The side-effect import lives ONLY in
`tui/node-main.tsx` (the TUI entry, bundled with `target: "bun"` via
`buildTUIBundle`).

If you need the runtime plugin in code reachable from the main bundle,
dynamic-import it inside an async function:

```ts
const { TuiPluginRuntime } = await import("@/tui/plugin/runtime")
```

### Bundle reaches `solid-plugin.ts`

Symptom: same `from "bun"` error but at
`@opentui/solid/scripts/solid-plugin.ts`.

Cause: a static import of `@opentui/solid/bun-plugin` is reachable from the
main bundle.

Fix: dynamic-import inside the function that needs it. See
`packages/codeplane/src/tui/launcher.ts` → `buildDevEntry()` for the
canonical example:

```ts
const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
```

### TUI bundle: "No matching export 'jsxDEV' in jsx-runtime.d.ts"

Symptom (during `buildTUIBundle`):

```
error: No matching export in
"@opentui/solid/jsx-runtime.d.ts" for import "jsxDEV"
    at .../tui/context/helper.tsx
```

Cause: `@opentui/solid/jsx-runtime` only ships a `.d.ts` file. The bundler
needs the Solid Babel transform plugin to resolve JSX into
`template`/`createComponent` calls instead of looking for the runtime.

Fix: register `createSolidTransformPlugin()` in the `Bun.build` `plugins`
array. `buildTUIBundle` already does this. If you forked the function,
register it.

### "Mkdir '/$bunfs'" EROFS error

Symptom (when launching the CLI):

```
Error: EROFS: read-only file system, mkdir '/$bunfs'
```

Cause: in a Bun-compiled standalone binary, `import.meta.url` and
`__dirname` resolve under the virtual `/$bunfs/root/` filesystem. Code that
tries to `fs.mkdir(path.join(__dirname, "..", ".cache", ...))` ends up
writing to the read-only bun virtual fs.

Fix: detect the packaged-binary case and bail out cleanly. See
`tui/launcher.ts` → `isPackagedBinary()`:

```ts
function isPackagedBinary() {
  return import.meta.url.startsWith("file:///$bunfs/") ||
         import.meta.url.startsWith("file:///%24bunfs/")
}
```

`buildDevEntry()` checks this first and throws a friendly "TUI bundle
missing" error pointing at the missing `runtime/tui/node-main.js`, instead
of attempting the read-only mkdir.

### TUI bundle missing after install

Symptom (when launching the CLI):

```
Codeplane TUI bundle missing from this install. Expected
runtime/tui/node-main.js next to the executable. Reinstall the codeplane
package or set CODEPLANE_TUI_BUNDLE to a built node-main.js.
```

Cause: the npm postinstall hardlinked the binary into `codeplane-ai/bin/
.codeplane`, so `process.execPath` is in `codeplane-ai/bin/` — but the TUI
bundle lives next to the **real** binary in
`codeplane-darwin-arm64/bin/runtime/tui/node-main.js`.

Fix: the wrapper script (`packages/codeplane/bin/codeplane`) sets
`CODEPLANE_BIN_DIR` to the real platform-package bin dir. The launcher reads
it first, then falls back to `path.dirname(process.execPath)`, then walks
`node_modules` ancestors looking for the matching platform package's
`runtime/tui/node-main.js`.

If you regress any of these layers, the TUI fails to launch on every
hardlinked install. v27.4.6 hotfix shipped the wrapper change; v27.4.6's
launcher gained the walk-up fallback for backwards compat with installs that
predate the wrapper change.

### `process.execPath` weirdness in compiled binaries

In a Bun-compiled standalone binary:

- `process.execPath` returns the **real, resolved** path of the binary on
  disk (with macOS `/tmp` → `/private/tmp` resolution).
- `process.argv[0]` returns the literal string `"bun"`.
- `import.meta.url` returns `file:///$bunfs/root/...` (the virtual fs).

Use `process.execPath` for "where am I on disk", `import.meta.url` for "what
file inside the bundle am I", and `process.argv[0]` for nothing useful in
this codebase.

### Cross-file test pollution

The `bun --cwd packages/codeplane test` aggregate run can produce ~9
failures that all pass when each test file is run in isolation:

- `test/sync/index.test.ts` — Sync replay tests
- `test/workspace/workspace-restore.test.ts`
- `test/session/prompt.test.ts`
- `test/memory/abort-leak.test.ts` (timing-sensitive)
- `test/provider/copilot/copilot-chat-model.test.ts` (network)
- `test/session/processor-effect.test.ts` "preserve text start time"
  (network)

Run individually to confirm a test is real-failing vs a pollution flake:

```bash
bun --cwd packages/codeplane test test/sync/index.test.ts
```

This is a pre-existing testing infrastructure issue. **Do not block a
release on aggregate-run failures** unless an individual file run also
fails.

### Drafts left after desktop-release

Pre-v27.4.13, the `desktop-release` workflow created its release with
`--draft`. If a single matrix build hung (especially Windows), the release
sat as a Draft forever.

Fix shipped in v27.4.13: the `create-release` job no longer passes
`--draft`, and the `publish-release` job uses `if: always()` so it runs
even if a matrix build failed.

If you ever see a Draft desktop release stuck again, manually promote with:

```bash
gh release edit vX.Y.Z-desktop --draft=false --latest
```

And then verify the workflow YAML didn't regress.

### npm publish silently failing while GitHub release succeeds

Symptom: `gh release create vX.Y.Z` returns the release URL (looks
successful), but `npm install -g codeplane-ai@X.Y.Z` returns 404 from npm.

Cause: the GitHub release entry is created by your local `gh release create`
call. The npm publish happens in the `npm-release` workflow triggered by the
tag. If the workflow fails at `bun run --cwd packages/codeplane build`, the
publish step never runs, but the GitHub release still exists.

Fix: **always check `gh run list --workflow=npm-release` after a release**.
If it failed, fix the build, bump the version one more time, and re-release.
Don't try to push a re-publish under the same version — npm versions are
immutable.

This bit us with v27.4.18 and v27.4.19 — both shipped a GitHub release but
no npm package. v27.4.20 was the first publishable release on the new TUI.

### `bun lint` flagging `.cache/` files

Symptom: `Found 1 error` from oxlint with the error in
`packages/codeplane/.cache/tui/node-main.js`.

Cause: oxlint scanned the dev cache directory. Fix shipped in v27.4.7 — the
`ignorePatterns` in `.oxlintrc.json` now includes `**/.cache/`. If you see
this again, it regressed.

### `customConditions: ["browser"]` in tsconfig

`packages/codeplane/tsconfig.json` sets `customConditions: ["browser"]`. This
is a TS-only setting that affects which `package.json` `exports` branch the
language server resolves. It does NOT change Bun's bundler behavior.

Bun's bundler reads its own `conditions: [...]` array passed to `Bun.build`.
The build script passes `conditions: ["browser"]` to mirror the TS setting.

These are separate concerns. Don't conflate them.

### `jsxImportSource: "@opentui/solid"` in tsconfig

`packages/codeplane/tsconfig.json` sets `jsxImportSource: "@opentui/solid"`.
`@opentui/solid/jsx-runtime` ships only a `.d.ts`. The actual JSX transform
happens via the Solid Babel plugin during bundling — TypeScript only needs
the types.

---

## Environment variables reference

### Codeplane runtime

| Var | Effect |
| :--- | :--- |
| `CODEPLANE_HOME_DIR` | Override the shared home root |
| `CODEPLANE_DATA_DIR` | Override `<root>/data` |
| `CODEPLANE_CACHE_DIR` | Override `<root>/cache` |
| `CODEPLANE_STATE_DIR` | Override `<root>/state` |
| `CODEPLANE_BIN_DIR` | Override `<root>/bin`. ALSO read by the TUI launcher to find `runtime/tui/node-main.js`. |
| `CODEPLANE_LOG_DIR` | Override `<root>/log` |
| `CODEPLANE_TEST_HOME` | Test-only home root override |
| `CODEPLANE_TUI_BUNDLE` | Explicit path to a TUI `node-main.js` (skips bundle discovery) |
| `CODEPLANE_TUI_NODE` | Explicit Node binary path (legacy) |
| `CODEPLANE_TUI_RUNTIME` | Explicit runtime binary (bun or node) |
| `CODEPLANE_BIN_PATH` | Wrapper-only: explicit binary to spawn (overrides everything) |
| `CODEPLANE_DESKTOP_MANAGED` | Set to `"1"` by the desktop shell when spawning a server. Tells `Installation.method()` to return `"desktop"`. |
| `CODEPLANE_UPGRADE_SCRIPT` | Path to a self-hosted upgrade script. Tells `Installation.method()` to return `"selfhosted"`. |
| `CODEPLANE_CHANNEL` | Release channel (`latest` for stable, anything else for preview) |
| `CODEPLANE_BUMP` | semver bump kind (`patch` / `minor` / `major`) — used by `script/index.ts` |
| `CODEPLANE_VERSION` | Explicit version override — used by `script/index.ts` |
| `CODEPLANE_RELEASE` | Truthy → real release flow; falsy → preview |
| `CODEPLANE_LOCAL_SHUTDOWN_GRACE_MS` | Local instance shutdown grace period (default 4000) |
| `CODEPLANE_NPM_FETCH_TIMEOUT_MS` | Timeout for npm tarball fetch in local-runtime (default 120000) |
| `CODEPLANE_NPM_REGISTRY` | Registry override for local-runtime |
| `CODEPLANE_DESKTOP_USER_DATA_DIR` | Desktop-only: override Electron's userData dir |
| `CODEPLANE_DESKTOP_LOG_DIR` | Desktop-only: override the desktop log dir |
| `CODEPLANE_DESKTOP_TEST_NOTIFICATIONS` | Desktop-only: trigger a test notification on startup |
| `CODEPLANE_DESKTOP_TEST_UPDATE` | Desktop-only: mock-update mode |
| `CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE` | Desktop-only: disable autoUpdater entirely |
| `CODEPLANE_LOG_LEVEL` | TUI logging level (`INFO` default) |
| `CODEPLANE_CLIENT` | Set by the launcher to `"tui"` for the spawned TUI |

### npm-related

| Var | Effect |
| :--- | :--- |
| `npm_config_registry` | Standard npm config — read by local-runtime |
| `NPM_TOKEN` | CI-only: used by the npm-release workflow for `npm publish` |
| `GITHUB_TOKEN` / `GH_TOKEN` | Auth for `gh` commands and GitHub API in `installation/latest` |

### Workflow / build

| Var | Effect |
| :--- | :--- |
| `MODELS_DEV_API_JSON` | Path to a local models.dev API JSON (skips the network fetch in `script/generate.ts`) |
| `CODEPLANE_MODELS_URL` | Override the models.dev base URL (default `https://models.dev`) |
| `GH_REPO` | Build-script repo override (default `devinoldenburg/codeplane`) |

---

## Configuration files reference

### Repo root

| File | Purpose |
| :--- | :--- |
| `package.json` | Root workspace, scripts, catalog (legacy), engines |
| `bun.lock` | Bun lockfile |
| `bunfig.toml` | Bun runtime config |
| `turbo.json` | Turbo task graph (typecheck, build dependencies) |
| `tsconfig.json` | Root tsconfig (extended by packages) |
| `.oxlintrc.json` | oxlint rules + ignore patterns |
| `.gitignore` | Includes `*.tgz`, `**/.cache/`, `**/.wrangler/`, `package-lock.json`, stray PNG patterns |
| `.github/TEAM_MEMBERS` | Team list (used by `script/index.ts` `Script.team`) |
| `.github/workflows/npm-release.yml` | npm release workflow |
| `.github/workflows/desktop-release.yml` | Desktop release workflow |

### Codeplane home (per user)

| File | Purpose |
| :--- | :--- |
| `Codeplane/codeplane.jsonc` (or `codeplane.json`, `config.json`) | Global config (npm, mcp, skills, plugin, providers) |
| `Codeplane/instances.json` | Saved-instance registry shared across desktop/TUI/CLI |
| `Codeplane/agents/*.md` | Custom agent definitions |
| `Codeplane/commands/*.md` | Custom slash commands |
| `Codeplane/plugins/*.{ts,js}` | Local plugin scripts |
| `Codeplane/skills/*` | Custom skills |
| `Codeplane/local_server/<id>/config/codeplane.json` | Per-local-instance config |

### Per-package configs

- `packages/codeplane/tsconfig.json` — extends `@tsconfig/bun`, adds
  `jsxImportSource: "@opentui/solid"`, `customConditions: ["browser"]`,
  `paths: { "@/*": "./src/*", "@tui/*": "./src/tui/*", "@test/*": "./test/*" }`.
- `packages/desktop/tsconfig.json` — has `rootDir: "src"` explicitly (added
  in v27.4.7 to satisfy oxlint's tsconfig validator).
- `packages/codeplane/bunfig.toml` — Bun runtime config for the codeplane
  package.

---

## Quick command reference

### Most common day-to-day

```bash
# Install deps (after any package.json change or fresh clone)
bun install

# Typecheck everything
bun turbo typecheck

# Lint
bun lint

# Run tests for one package
bun --cwd packages/codeplane test
bun --cwd packages/codeplane test test/sync/index.test.ts   # single file

# Bump version + sync
bun run version:bump                 # patch bump
bun run version:bump minor           # minor bump
bun run version:bump 28.22.0         # exact version
bun run version:sync                 # resync only, no bump

# Local dev
bun run dev:server         # backend on :4096
bun run dev:web            # vite dev server on :4444 → backend on :4096
bun run dev:storybook      # storybook for UI components
```

### Build & smoke test

```bash
cd packages/codeplane

# Fast iteration: current platform only, no web UI embed, no install
bun script/build.ts --skip-embed-web-ui --skip-install --single

# After a successful build, smoke test (auto-run for current platform):
./dist/codeplane-darwin-arm64/bin/codeplane --version
./dist/codeplane-darwin-arm64/bin/codeplane                  # launch TUI

# Full release-style build (slow — all 12 targets)
bun script/build.ts
```

### Release

```bash
# 1. Bump
bun run version:bump patch                      # or: bun run version:bump 27.4.X+1

# 2. Verify
bun turbo typecheck                              # 8/8 green
bun lint                                         # 0 errors
cd packages/codeplane
bun script/build.ts --skip-embed-web-ui --skip-install --single
./dist/codeplane-darwin-arm64/bin/codeplane --version    # should print the bump
cd ../..

# 3. Commit + push
git add -A
git commit -m "$(cat <<'EOF'
Release v27.4.X+1

Bumps version 27.4.X → 27.4.X+1 across all workspaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main

# 4. Create GitHub release (this triggers both workflows)
gh release create v27.4.X+1 --target main --title "v27.4.X+1" --notes "$(cat <<'EOF'
## Highlights

Codeplane **v27.4.X+1** ships in-flight <area> work and bumps version
metadata across all workspaces.

## Validation

- **Typecheck**: 8/8 packages clean (`bun turbo typecheck`).
- **Lint**: 0 errors (`bun lint`).

## Release artifacts

- npm: `codeplane-ai@27.4.X+1`, `@codeplane-ai/sdk@27.4.X+1`, `@codeplane-ai/plugin@27.4.X+1`
- Desktop installers publish on the paired `v27.4.X+1-desktop` release line.
EOF
)"

# 5. Watch the workflows
gh run list --limit 4 --workflow=npm-release
gh run list --limit 4 --workflow=desktop-release

# 6. Verify after npm-release succeeds
npm install -g codeplane-ai@27.4.X+1
codeplane --version
```

### Inspecting CI

```bash
# Recent workflow runs
gh run list --limit 8

# View a specific run's logs (failed job only)
gh run view <run-id> --log-failed | tail -80

# Watch a run live
gh run watch <run-id>

# Re-run a failed run
gh run rerun <run-id>
gh run rerun <run-id> --failed     # only failed jobs

# Check release state
gh release list --limit 8
gh release view vX.Y.Z --json isDraft,assets

# Manually promote a stuck draft (shouldn't be needed post-v27.4.13)
gh release edit vX.Y.Z-desktop --draft=false --latest
```

### Rebase after upstream landed a release commit

```bash
git fetch origin main
git pull --rebase origin main
# On conflict: keep "theirs" for version files
git checkout --theirs README.md bun.lock packages/*/package.json \
  packages/extensions/zed/extension.toml packages/shared/package.json \
  packages/shared/src/version.ts sdks/vscode/package.json
git add .
git rebase --continue
git push origin main
```

### Working with worktrees

```bash
# Worktrees live under .claude/worktrees/ and .worktrees/ — both gitignored.
# To spawn an isolated agent run, use the Agent tool with isolation: "worktree".
```

---

## Per-release decision tree

When the user asks for a new release, follow this flow:

```
START
  │
  ▼
git status — any uncommitted changes?
  │
  ├── No  ──► simple version bump release. Continue.
  │
  └── Yes ──► Inspect the changes.
      │      Are they ready to ship? (typecheck/lint/tests pass?)
      │
      ├── Yes ──► Include them. Commit message describes both the changes and the bump.
      │
      └── No  ──► Stash them OR ask the user. Don't ship broken work.
  │
  ▼
git fetch origin main — origin ahead of HEAD?
  │
  ├── No  ──► Continue.
  │
  └── Yes ──► git pull --rebase origin main (resolve version conflicts as "theirs").
  │
  ▼
Run `bun run version:bump patch` (or exact `bun run version:bump X.Y.Z`).
  │
  ▼
Verify `version:bump` output — `packageJsons` count matches expectation.
  │
  ▼
bun turbo typecheck — green?
  │
  ├── Yes ──► Continue.
  │
  └── No  ──► Fix the type errors. Commit fixes BEFORE the release commit if substantial.
  │
  ▼
bun lint — 0 errors?
  │
  ├── Yes ──► Continue.
  │
  └── No  ──► Fix. (Warnings are OK.)
  │
  ▼
(optional but smart) Local build smoke test — succeeds + binary --version prints?
  │
  ├── Yes ──► Continue.
  │
  └── No  ──► Diagnose with [Build pipeline deep dive] and [Common pitfalls].
  │
  ▼
git add -A && git commit -m "Release vX.Y.Z" && git push origin main
  │
  ▼
gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes "..."
  │
  ▼
Monitor:
  gh run list --workflow=npm-release --limit 4
  gh run list --workflow=desktop-release --limit 4
  │
  ▼
After both succeed:
  npm install -g codeplane-ai@X.Y.Z
  codeplane --version           # confirm it bumped
  codeplane                     # confirm TUI launches
  │
  ▼
DONE. Report the release URL to the user.
```

If npm-release fails, **don't try to publish under the same version** —
versions on npm are immutable. Bump again and ship the next version.

---

## When to push back

Per the safety guidelines, agents should generally execute requested work
without confirmation. But push back when:

- The user asks to **commit secrets** (`.env`, credentials, API keys). Refuse
  and explain.
- The user asks to **force-push to main** or **amend a public commit**. Warn
  and ask for confirmation.
- The user asks to **delete branches without backup** or **purge git
  history**. Warn.
- A workflow that should be deterministic produces wildly different output —
  diagnose before re-running.
- You discover **unexpected uncommitted state** that looks like the user's
  in-progress work. Ask before sweeping it into a release.

---

## Glossary

- **Codeplane home**: the shared OS-native folder named `Codeplane` that
  holds config, instances, plugins, etc. See `packages/shared/src/home.ts`.
- **Local instance**: a managed Codeplane server spawned by the desktop or
  CLI from a downloaded npm tarball, isolated to its own
  `local_server/<id>/` subdir.
- **Remote instance**: a saved URL pointing to a remote Codeplane server.
- **Saved instance**: an entry in `instances.json` — either a local instance
  spec or a remote URL with optional headers/TLS overrides.
- **Platform package**: an npm package shipping a Bun-compiled binary for
  one platform/arch combo (e.g. `codeplane-darwin-arm64`).
- **Meta package**: `codeplane-ai` — the package users install. Lists every
  platform package as `optionalDependencies`. The JS shim wrapper at
  `bin/codeplane` finds and spawns the right one.
- **Desktop release line**: the paired `vX.Y.Z-desktop` GitHub release that
  hosts Electron installers for one CLI release. Always created alongside
  the CLI release by the workflow.
- **TUI bundle**: `runtime/tui/node-main.js` — the SolidJS TUI entry,
  bundled with `target: "bun"` and the Solid Babel plugin.
- **Embedded web UI**: the Astro-built web app at `packages/app/dist/`,
  embedded into the CLI binary as `with { type: "file" }` blobs at build
  time. Disabled by `--skip-embed-web-ui`.
- **Installation method**: how the user got codeplane onto their machine
  (npm/yarn/pnpm/bun/brew/scoop/choco/curl/selfhosted/desktop/unknown).
  Drives the upgrade behavior.
- **Update channel**: stable (`latest`) vs preview (anything else). Set via
  `CODEPLANE_CHANNEL`. Preview builds get a `-<channel>.<git-sha>` suffix.

---

If you're an agent and you've actually read this whole file: thank you. You
will avoid most of the failure modes I've personally hit if you do.

Last updated: 2026-05-03 (v27.4.21).
