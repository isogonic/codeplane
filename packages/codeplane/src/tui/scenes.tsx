import React from "react"
import { Box, Text } from "ink"
import {
  Breadcrumb,
  CommandPalette,
  Composer,
  Conversation,
  type ConversationPart,
  DiffView,
  type DiffLine,
  FileList,
  Header,
  NotificationList,
  Panel,
  ProgressBar,
  RouteTabs,
  SessionList,
  type SessionItem,
  StatusBar,
  TodoList,
  type TodoItem,
  MetricRow,
} from "./view"
import { glyph, theme } from "./theme"

// Sample data fixtures used by the render harness and could later seed
// storybook-style scenes.
const sampleSessions: SessionItem[] = [
  { id: "s1", title: "Add JWT auth to api", status: "busy", busyAttempt: 0 },
  { id: "s2", title: "Refactor session store", status: "idle", shared: true },
  { id: "s3", title: "Investigate flaky test", status: "retry", busyAttempt: 2 },
  { id: "s4", title: "Cleanup old migrations", status: "archived" },
  { id: "s5", title: "Tune cache invalidation", status: "idle", reverted: true },
]

const sampleConversation: ConversationPart[] = [
  {
    kind: "text",
    role: "user",
    time: "12:30",
    lines: ["Add JWT-based auth to the api server. We already have an `auth/` package."],
  },
  {
    kind: "text",
    role: "assistant",
    time: "12:30",
    lines: [
      "Plan looks good. I'll do it in three steps:",
      "  1. Wire `jsonwebtoken` into the existing auth package",
      "  2. Add a verify middleware",
      "  3. Mount it on the protected routes",
      "Starting with discovery.",
    ],
  },
  {
    kind: "reasoning",
    lines: [
      "The repo already mounts session middleware in api/server.ts.",
      "I should reuse the same pattern for JWT.",
    ],
  },
  {
    kind: "tool",
    name: "read",
    status: "completed",
    title: "packages/api/server.ts",
    output: ["import { auth } from \"@codeplane-ai/auth\"", "...", "app.use(auth.session())"],
  },
  {
    kind: "tool",
    name: "edit",
    status: "running",
    title: "packages/auth/jwt.ts",
    output: ["+ export function verifyJwt(token: string) {", "+   return jwt.verify(token, secret)", "+ }"],
  },
  {
    kind: "tool",
    name: "test",
    status: "pending",
    title: "packages/auth tests",
  },
]

const sampleTodos: TodoItem[] = [
  { id: "t1", status: "completed", text: "Read existing auth package" },
  { id: "t2", status: "in_progress", text: "Implement verifyJwt middleware" },
  { id: "t3", status: "pending", text: "Wire middleware into protected routes" },
  { id: "t4", status: "pending", text: "Add tests for invalid tokens" },
  { id: "t5", status: "pending", text: "Update CONTRIBUTING with auth guide" },
]

const sampleDiff: DiffLine[] = [
  { kind: "header", text: "packages/auth/jwt.ts (+12 / -3)" },
  { kind: "added", text: "export function verifyJwt(token: string) {" },
  { kind: "added", text: "  return jwt.verify(token, secret)" },
  { kind: "added", text: "}" },
  { kind: "context", text: "" },
  { kind: "removed", text: "export const session = createSession()" },
  { kind: "added", text: "export const session = createSession({ jwt: true })" },
]

const sampleNotifications = [
  {
    id: "p1",
    title: "Run command: bun test",
    subtitle: "Match patterns: bun test, bun run test:*",
    tone: "permission" as const,
  },
  {
    id: "q1",
    title: "Which package manager should I use?",
    subtitle: "options: bun, pnpm, npm",
    tone: "question" as const,
  },
]

const sampleFiles = [
  { path: "src", type: "directory" as const, rel: "src" },
  { path: "src/server.ts", type: "file" as const, rel: "src/server.ts" },
  { path: "src/auth.ts", type: "file" as const, rel: "src/auth.ts" },
  { path: "src/middleware.ts", type: "file" as const, rel: "src/middleware.ts" },
  { path: "test", type: "directory" as const, rel: "test" },
]

const sampleHints = [
  { keys: "tab", label: "switch pane" },
  { keys: "/", label: "command palette" },
  { keys: "n", label: "new session" },
  { keys: "?", label: "help" },
  { keys: "q", label: "quit" },
]

const sampleRouteTabs = [
  { id: "home", label: "Home", key: "1" },
  { id: "session", label: "Session", key: "2", badge: 3 },
  { id: "notifications", label: "Notifications", key: "3", badge: 2 },
  { id: "settings", label: "Settings", key: "4" },
  { id: "cron", label: "Cron", key: "5" },
]

function Frame(props: { rows: number; children: React.ReactNode }) {
  // No fixed height. Height is set on the outer process when rendering live;
  // for snapshots we let the content flow naturally to avoid Ink's box
  // overflow collapsing rows.
  return (
    <Box flexDirection="column" width="100%">
      {props.children}
    </Box>
  )
}

function SetupScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="setup"
        cwd="~/projects/opencode"
        status={{ variant: "info", text: "Choose an instance to open" }}
      />
      <Box marginTop={1} flexGrow={1} gap={1}>
        <Panel title="Instances" subtitle="5 saved" active grow={2}>
          <Box flexDirection="column">
            <Box>
              <Text color={theme.accent}>{glyph.arrowRight} </Text>
              <Text color={theme.accent} bold>local · workspace dev</Text>
            </Box>
            <Box>
              <Text color={theme.fgDim}>  </Text>
              <Text color={theme.fgMuted}>remote · staging.codeplane.io</Text>
            </Box>
            <Box>
              <Text color={theme.fgDim}>  </Text>
              <Text color={theme.fgMuted}>remote · prod.codeplane.io</Text>
            </Box>
            <Box>
              <Text color={theme.fgDim}>  </Text>
              <Text color={theme.fgMuted}>local · ephemeral test</Text>
            </Box>
            <Box>
              <Text color={theme.fgDim}>  </Text>
              <Text color={theme.fgMuted}>remote · scratch box</Text>
            </Box>
          </Box>
        </Panel>
        <Panel title="Local Workspace" subtitle="codeplane v27.4.7" grow={3}>
          <Box flexDirection="column">
            <MetricRow label="Label" value="workspace dev" />
            <MetricRow label="Binary" value="v27.4.7 (default)" />
            <MetricRow label="URL" value="http://127.0.0.1:auto" tone="muted" />
            <MetricRow label="Headers" value="0 configured" tone="muted" />
            <MetricRow label="Status" value="ready" tone="success" />
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.fgMuted}>Keys</Text>
              <Text color={theme.fgDim}>
                <Text color={theme.accent}>a</Text> add remote ·{" "}
                <Text color={theme.accent}>l</Text> add local ·{" "}
                <Text color={theme.accent}>e</Text> edit ·{" "}
                <Text color={theme.accent}>d</Text> delete ·{" "}
                <Text color={theme.accent}>↵</Text> open
              </Text>
            </Box>
          </Box>
        </Panel>
      </Box>
      <Box marginTop={1}>
        <StatusBar
          hints={[
            { keys: "a", label: "add remote" },
            { keys: "l", label: "add local" },
            { keys: "↵", label: "open" },
            { keys: "q", label: "quit" },
          ]}
        />
      </Box>
    </Frame>
  )
}

function ConversationScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        branch="main"
        cwd="~/projects/opencode"
        busy
        spinnerFrame={glyph.spinnerFrames[2]}
        status={{ variant: "success", text: "connected" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} alignItems="flex-start" gap={1}>
        <Box flexDirection="column" flexGrow={1}>
          <Panel title="Conversation" subtitle="Add JWT auth to api" active>
            <Conversation parts={sampleConversation} spinnerFrame={glyph.spinnerFrames[2]} />
          </Panel>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Composer
          value="Now wire the middleware into the protected routes"
          placeholder="Message Add JWT auth to api"
          active
          hint="↵ send · / commands · s sidebar · esc unfocus"
        />
        <Box marginTop={1}>
          <StatusBar
            hints={[
              { keys: "↵", label: "send" },
              { keys: "/", label: "commands" },
              { keys: "s", label: "sidebar" },
              { keys: "d", label: "directory" },
              { keys: "n", label: "new session" },
              { keys: "q", label: "quit" },
            ]}
          />
        </Box>
      </Box>
    </Frame>
  )
}

function ConversationWithSidebarScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        branch="main"
        cwd="~/projects/opencode"
        busy
        spinnerFrame={glyph.spinnerFrames[2]}
        status={{ variant: "success", text: "connected" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} alignItems="flex-start" gap={1}>
        <Box flexDirection="column" width={30} flexShrink={0} gap={1}>
          <Panel title="Sessions" subtitle="5" active>
            <SessionList
              sessions={sampleSessions}
              selectedID="s1"
              active
              spinnerFrame={glyph.spinnerFrames[2]}
            />
          </Panel>
          <Panel title="Tasks" subtitle="2/5 done">
            <TodoList todos={sampleTodos} limit={6} />
          </Panel>
          <Panel title="Diff" subtitle="2 files · +12/-3">
            <DiffView lines={sampleDiff} limit={6} />
          </Panel>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Panel title="Conversation" subtitle="Add JWT auth to api">
            <Conversation parts={sampleConversation} spinnerFrame={glyph.spinnerFrames[2]} />
          </Panel>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Composer
          value="Now wire the middleware into the protected routes"
          placeholder="Message Add JWT auth to api"
          active
          hint="↵ send · / commands · s hide sidebar · esc unfocus"
        />
        <Box marginTop={1}>
          <StatusBar
            hints={[
              { keys: "↵", label: "send" },
              { keys: "/", label: "commands" },
              { keys: "s", label: "hide sidebar" },
              { keys: "d", label: "directory" },
              { keys: "q", label: "quit" },
            ]}
          />
        </Box>
      </Box>
    </Frame>
  )
}

function DirectoryScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        cwd="~/projects/opencode"
        status={{ variant: "info", text: "Choose a directory" }}
      />
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.fgMuted}>Working directory</Text>
      </Box>
      <Box paddingX={1}>
        <Breadcrumb path="/Users/dev/projects/opencode/packages" home="/Users/dev" />
      </Box>
      <Box marginTop={1}>
        <Panel title="Browse" subtitle="9 dirs · 4 files" active grow={1}>
          <Box flexDirection="column">
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.accent}>{glyph.arrowRight} </Text>
                <Text color={theme.accent}>▸ </Text>
                <Text color={theme.accent} bold>codeplane</Text>
                <Text color={theme.fgDim}>/</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.accent}>▸ </Text>
                <Text color={theme.fg} bold>desktop</Text>
                <Text color={theme.fgDim}>/</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.accent}>▸ </Text>
                <Text color={theme.fg} bold>extensions</Text>
                <Text color={theme.fgDim}>/</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.accent}>▸ </Text>
                <Text color={theme.fg} bold>plugin</Text>
                <Text color={theme.fgDim}>/</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.accent}>▸ </Text>
                <Text color={theme.fg} bold>shared</Text>
                <Text color={theme.fgDim}>/</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.accent}>▸ </Text>
                <Text color={theme.fg} bold>web</Text>
                <Text color={theme.fgDim}>/</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.fgDim}>· </Text>
                <Text color={theme.fgDim}>package.json</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.fgDim}>· </Text>
                <Text color={theme.fgDim}>README.md</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.fgDim}>  </Text>
                <Text color={theme.fgDim}>· </Text>
                <Text color={theme.fgDim}>tsconfig.json</Text>
              </Text>
            </Box>
          </Box>
        </Panel>
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.fgDim}>
          <Text color={theme.accent}>↑↓</Text> navigate ·{" "}
          <Text color={theme.accent}>↵</Text>/<Text color={theme.accent}>→</Text> enter dir ·{" "}
          <Text color={theme.accent}>⌫</Text>/<Text color={theme.accent}>←</Text> up ·{" "}
          <Text color={theme.accent}>h</Text> home ·{" "}
          <Text color={theme.accent}>o</Text> open here ·{" "}
          <Text color={theme.accent}>esc</Text> cancel
        </Text>
      </Box>
    </Frame>
  )
}

function PaletteScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        branch="main"
        cwd="~/projects/opencode"
        status={{ variant: "info", text: "Searching commands" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} flexGrow={1}>
        <Panel title="Conversation" subtitle="Add JWT auth to api" grow={1}>
          <Conversation parts={sampleConversation.slice(0, 3)} />
        </Panel>
      </Box>
      <Box marginTop={1}>
        <CommandPalette
          filter="sess"
          selection="new-session"
          options={[
            { label: "Create Session", value: "new-session", hint: "create a fresh chat" },
            { label: "Archive Session", value: "archive", hint: "soft delete current" },
            { label: "Share Session", value: "share", hint: "publish a share link" },
            { label: "Revert To Latest Assistant Output", value: "revert", hint: "rewind one turn" },
            { label: "Open Notifications", value: "notifications", hint: "permissions & questions" },
          ]}
        />
      </Box>
      <Box marginTop={1}>
        <StatusBar
          hints={[
            { keys: "↑↓", label: "navigate" },
            { keys: "↵", label: "run" },
            { keys: "esc", label: "close" },
          ]}
        />
      </Box>
    </Frame>
  )
}

function NotificationsScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        branch="main"
        cwd="~/projects/opencode"
        status={{ variant: "warning", text: "2 pending requests" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="notifications" />
      </Box>
      <Box marginTop={1} flexGrow={1} gap={1}>
        <Panel title="Inbox" subtitle="2" active grow={2}>
          <NotificationList items={sampleNotifications} selectedID="p1" active />
        </Panel>
        <Panel title="Details" subtitle="permission" grow={3}>
          <Box flexDirection="column">
            <MetricRow label="Type" value="permission" tone="warning" />
            <MetricRow label="Command" value="bun test" />
            <MetricRow label="Patterns" value="bun test, bun run test:*" tone="muted" />
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.fgMuted}>Keys</Text>
              <Text color={theme.fgDim}>
                <Text color={theme.success}>y</Text> approve once ·{" "}
                <Text color={theme.success}>a</Text> always ·{" "}
                <Text color={theme.error}>x</Text> reject
              </Text>
            </Box>
          </Box>
        </Panel>
      </Box>
      <Box marginTop={1}>
        <StatusBar
          hints={[
            { keys: "tab", label: "switch pane" },
            { keys: "y", label: "approve once" },
            { keys: "a", label: "always" },
            { keys: "x", label: "reject" },
          ]}
        />
      </Box>
    </Frame>
  )
}

function SettingsScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        branch="main"
        cwd="~/projects/opencode"
        status={{ variant: "info", text: "Update available" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="settings" />
      </Box>
      <Box marginTop={1} flexGrow={1}>
        <Panel title="Workspace" subtitle="settings" active grow={1}>
          <Box flexDirection="column">
            <MetricRow label="Server" value="http://127.0.0.1:51123" />
            <MetricRow label="Path" value="~/projects/opencode" />
            <MetricRow label="Current" value="v27.4.7" />
            <MetricRow label="Latest" value="v27.4.8" tone="success" />
            <MetricRow label="Install" value="bun-binary" tone="muted" />
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.fgMuted}>Update</Text>
              <ProgressBar value={62} label="downloading runtime" />
            </Box>
            <Box marginTop={1}>
              <Text color={theme.fgMuted}>
                Press <Text color={theme.accent}>u</Text> to upgrade or refresh.
              </Text>
            </Box>
          </Box>
        </Panel>
      </Box>
      <Box marginTop={1}>
        <StatusBar hints={[{ keys: "u", label: "upgrade" }, { keys: "tab", label: "switch pane" }]} />
      </Box>
    </Frame>
  )
}

function TerminalScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        branch="main"
        cwd="~/projects/opencode"
        status={{ variant: "success", text: "Terminal active" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} flexGrow={1} gap={1}>
        <Box flexDirection="column" width={28} flexShrink={0}>
          <Panel title="Sessions" subtitle="5">
            <SessionList sessions={sampleSessions} selectedID="s1" />
          </Panel>
        </Box>
        <Box flexDirection="column" flexGrow={1} gap={1}>
          <Panel title="Conversation">
            <Conversation parts={sampleConversation.slice(0, 2)} />
          </Panel>
          <Panel title="Terminal" subtitle="Terminal 1 · connected" active>
            <Box flexDirection="column">
              <Box>
                <Text color={theme.accent} bold>
                  [Terminal 1]
                </Text>
                <Text color={theme.fgDim}>{"   "}Terminal 2{"   "}+ new</Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.fgMuted}>$ bun test</Text>
                <Text color={theme.success}>✓ packages/auth/jwt.test.ts (12)</Text>
                <Text color={theme.success}>✓ packages/auth/middleware.test.ts (4)</Text>
                <Text color={theme.fgMuted}>$ bun run typecheck</Text>
                <Text color={theme.fgDim}>typescript v5.8.2</Text>
                <Text color={theme.success}>no errors found</Text>
                <Text color={theme.fgMuted}>$</Text>
              </Box>
            </Box>
          </Panel>
        </Box>
      </Box>
      <Box marginTop={1}>
        <StatusBar
          hints={[
            { keys: "←→", label: "switch tab" },
            { keys: "n", label: "new" },
            { keys: "x", label: "close" },
            { keys: "t", label: "hide dock" },
          ]}
        />
      </Box>
    </Frame>
  )
}

export type SceneName =
  | "setup"
  | "directory"
  | "conversation"
  | "conversation-sidebar"
  | "palette"
  | "notifications"
  | "settings"
  | "terminal"

export function Scene(props: { name: SceneName; rows: number }) {
  switch (props.name) {
    case "setup":
      return <SetupScene rows={props.rows} />
    case "directory":
      return <DirectoryScene rows={props.rows} />
    case "conversation":
      return <ConversationScene rows={props.rows} />
    case "conversation-sidebar":
      return <ConversationWithSidebarScene rows={props.rows} />
    case "palette":
      return <PaletteScene rows={props.rows} />
    case "notifications":
      return <NotificationsScene rows={props.rows} />
    case "settings":
      return <SettingsScene rows={props.rows} />
    case "terminal":
      return <TerminalScene rows={props.rows} />
  }
}
