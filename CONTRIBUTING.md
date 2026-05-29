# Contributing to Codeplane

We want to make it easy for you to contribute to Codeplane. Here are the most common type of changes that get merged:

- Bug fixes
- Additional LSPs / Formatters
- Improvements to LLM performance
- Support for new providers
- Fixes for environment-specific quirks
- Missing standard behavior
- Documentation improvements

However, any UI or core product feature must go through a design review with the core team before implementation.

If you are unsure if a PR would be accepted, feel free to ask a maintainer or look for issues with any of the following labels:

- [`help wanted`](https://github.com/devinoldenburg/codeplane/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://github.com/devinoldenburg/codeplane/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://github.com/devinoldenburg/codeplane/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://github.com/devinoldenburg/codeplane/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

> [!NOTE]
> PRs that ignore these guardrails will likely be closed.

Want to take on an issue? Leave a comment and a maintainer may assign it to you unless it is something we are already working on.

## Adding New Providers

New providers shouldn't require many if ANY code changes, but if you want to add support for a new provider first make a PR to:
https://github.com/anomalyco/models.dev

## Developing Codeplane

- Requirements: Bun 1.3+
- Install dependencies and start the server-backed web app from the repo root:

  ```bash
  bun install
  bun dev:server
  ```

### Running against a different directory

By default, `bun dev:server` runs Codeplane in the current repository. To run it against a different directory or repository:

```bash
bun dev:server -- <directory>
```

To run Codeplane in the root of the codeplane repo itself:

```bash
bun dev:server -- .
```

### Building a "localcode"

To compile a standalone executable:

```bash
./packages/codeplane/script/build.ts --single
```

Then run it with:

```bash
./packages/codeplane/dist/codeplane-<platform>/bin/codeplane
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`).

- Core pieces:
  - `packages/codeplane`: CLI, server, TUI host, session runtime, tools, providers.
  - `packages/app`: SolidJS web app served by the server and wrapped by desktop/mobile.
  - `packages/desktop`: Electron desktop shell and updater integration.
  - `packages/mobile`: Native mobile shell packaging.
  - `packages/shared`: home paths, saved instances, shared local runtime helpers.
  - `packages/sdk/js`: generated TypeScript SDK.
  - `packages/plugin`: source for `@codeplane-ai/plugin`.
  - `packages/ui`: shared UI components and theme system.
  - `site`: Next.js static website and documentation source.
  - `docs`: static Pages output plus schema/install compatibility files.

### Understanding development commands

The root scripts separate the web app frontend from the local Codeplane server:

```bash
# Development (from project root)
bun dev:server           # Start server + open web interface
bun dev:web              # Start the Vite web app
bun --cwd packages/codeplane dev serve --instance dev --port 4096

# Production
codeplane --help          # Show all available commands
codeplane serve --instance dev --port 4096
codeplane web --instance dev --port 4096
codeplane <directory>     # Start server + open web interface for a directory
```

### Running the API Server

To start the Codeplane headless API server:

```bash
bun --cwd packages/codeplane dev serve --instance dev
```

The CLI default port is `0`, which lets the OS choose a free port. Pass an explicit port when you need a stable URL:

```bash
bun --cwd packages/codeplane dev serve --instance dev --port 8080
```

### Running the Web App

To test UI changes during development:

1. **First, start the Codeplane server** (see [Running the API Server](#running-the-api-server) section above)
2. **Then run the web app:**

```bash
bun dev:web
```

This starts a local dev server at http://localhost:5173 (or similar port shown in output). Most UI changes can be tested here, but the server must be running for full functionality.

> [!NOTE]
> If you make changes to the API or SDK (e.g. `packages/codeplane/src/server/server.ts`), run `./packages/sdk/js/script/build.ts` to regenerate the JavaScript SDK and related files.

Please try to follow the [style guide](./AGENTS.md)

### Setting up a Debugger

Bun debugging is currently rough around the edges. We hope this guide helps you get set up and avoid some pain points.

The most reliable way to debug Codeplane is to run it manually in a terminal via `bun run --inspect=<url> dev ...` and attach
your debugger via that URL. Other methods can result in breakpoints being mapped incorrectly, at least in VSCode (YMMV).

Caveats:

- If breakpoints do not attach through the root scripts, debug the server directly:
  - `bun run --inspect=ws://localhost:6499/ --cwd packages/codeplane ./src/index.ts serve --instance dev --port 4096`
  - Then run `bun run dev:web` and connect the web app to that server.

Other tips and tricks:

- You might want to use `--inspect-wait` or `--inspect-brk` instead of `--inspect`, depending on your workflow
- Specifying `--inspect=ws://localhost:6499/` on every invocation can be tiresome, you may want to `export BUN_OPTIONS=--inspect=ws://localhost:6499/` instead

#### VSCode Setup

If you use VSCode, you can use our example configurations [.vscode/settings.example.json](.vscode/settings.example.json) and [.vscode/launch.example.json](.vscode/launch.example.json).

Some debug methods that can be problematic:

- Debug configurations with `"request": "launch"` can have breakpoints incorrectly mapped and thus unusable
- The same problem arises when running Codeplane in the VSCode `JavaScript Debug Terminal`

With that said, you may want to try these methods, as they might work for you.

## Pull Request Expectations

### Issue First Policy

**All PRs must reference an existing issue.** Before opening a PR, open an issue describing the bug or feature. This helps maintainers triage and prevents duplicate work. PRs without a linked issue may be closed without review.

- Use `Fixes #123` or `Closes #123` in your PR description to link the issue
- For small fixes, a brief issue is fine - just enough context for maintainers to understand the problem

### General Requirements

- Keep pull requests small and focused
- Explain the issue and why your change fixes it
- Before adding new functionality, ensure it doesn't already exist elsewhere in the codebase

### UI Changes

If your PR includes UI changes, please include screenshots or videos showing the before and after. This helps maintainers review faster and gives you quicker feedback.

### Logic Changes

For non-UI changes (bug fixes, new features, refactors), explain **how you verified it works**:

- What did you test?
- How can a reviewer reproduce/confirm the fix?

### No AI-Generated Walls of Text

Long, AI-generated PR descriptions and issues are not acceptable and may be ignored. Respect the maintainers' time:

- Write short, focused descriptions
- Explain what changed and why in your own words
- If you can't explain it briefly, your PR might be too large

### PR Titles

PR titles should follow conventional commit standards:

- `feat:` new feature or functionality
- `fix:` bug fix
- `docs:` documentation or README changes
- `chore:` maintenance tasks, dependency updates, etc.
- `refactor:` code refactoring without changing behavior
- `test:` adding or updating tests

You can optionally include a scope to indicate which package is affected:

- `feat(app):` feature in the app package
- `chore(codeplane):` maintenance in the codeplane package

Examples:

- `docs: update contributing guidelines`
- `fix: resolve crash on startup`
- `feat: add dark mode support`
- `feat(app): add dark mode support`
- `chore: bump dependency versions`

### Style Preferences

These are not strictly enforced, they are just general guidelines:

- **Functions:** Keep logic within a single function unless breaking it out adds clear reuse or composition benefits.
- **Destructuring:** Do not do unnecessary destructuring of variables.
- **Control flow:** Avoid `else` statements.
- **Error handling:** Prefer `.catch(...)` instead of `try`/`catch` when possible.
- **Types:** Reach for precise types and avoid `any`.
- **Variables:** Stick to immutable patterns and avoid `let`.
- **Naming:** Choose concise single-word identifiers when they remain descriptive.
- **Runtime APIs:** Use Bun helpers such as `Bun.file()` when they fit the use case.

## Feature Requests

For net-new functionality, start with a design conversation. Open an issue describing the problem, your proposed approach (optional), and why it belongs in Codeplane. The core team will help decide whether it should move forward; please wait for that approval instead of opening a feature PR directly.

## Trust & Vouch System

This project uses [vouch](https://github.com/mitchellh/vouch) to manage contributor trust. The vouch list is maintained in [`.github/VOUCHED.td`](.github/VOUCHED.td).

### How it works

- **Vouched users** are explicitly trusted contributors.
- **Denounced users** are explicitly blocked. Issues and pull requests from denounced users are automatically closed. If you have been denounced, you can request to be unvouched by reaching out to a maintainer on [Discord](https://github.com/devinoldenburg/codeplane/issues)
- **Everyone else** can participate normally — you don't need to be vouched to open issues or PRs.

### For maintainers

Collaborators with write access can manage the vouch list by commenting on any issue:

- `vouch` — vouch for the issue author
- `vouch @username` — vouch for a specific user
- `denounce` — denounce the issue author
- `denounce @username` — denounce a specific user
- `denounce @username <reason>` — denounce with a reason
- `unvouch` / `unvouch @username` — remove someone from the list

Changes are committed automatically to `.github/VOUCHED.td`.

### Denouncement policy

Denouncement is reserved for users who repeatedly submit low-quality AI-generated contributions, spam, or otherwise act in bad faith. It is not used for disagreements or honest mistakes.

## Issue Requirements

All issues **must** use one of our issue templates:

- **Bug report** — for reporting bugs (requires a description)
- **Feature request** — for suggesting enhancements (requires verification checkbox and description)
- **Question** — for asking questions (requires the question)

Blank issues are not allowed. When a new issue is opened, an automated check verifies that it follows a template and meets our contributing guidelines. If an issue doesn't meet the requirements, you'll receive a comment explaining what needs to be fixed and have **2 hours** to edit the issue. After that, it will be automatically closed.

Issues may be flagged for:

- Not using a template
- Required fields left empty or filled with placeholder text
- AI-generated walls of text
- Missing meaningful content

If you believe your issue was incorrectly flagged, let a maintainer know.
