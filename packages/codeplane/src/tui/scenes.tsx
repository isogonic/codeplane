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
  Header,
  NotificationList,
  Panel,
  PathInput,
  ProgressBar,
  RouteTabs,
  Rule,
  SectionHeader,
  SessionList,
  type SessionItem,
  StatusBar,
  TodoList,
  type TodoItem,
  MetricRow,
} from "./view"
import { glyph, theme } from "./theme"

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
    output: ['import { auth } from "@codeplane-ai/auth"', "...", "app.use(auth.session())"],
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
    subtitle: "patterns: bun test, bun run test:*",
    tone: "permission" as const,
  },
  {
    id: "q1",
    title: "Which package manager should I use?",
    subtitle: "options: bun, pnpm, npm",
    tone: "question" as const,
  },
]

const sampleRouteTabs = [
  { id: "home", label: "Home", key: "1" },
  { id: "session", label: "Session", key: "2", badge: 3 },
  { id: "notifications", label: "Inbox", key: "3", badge: 2 },
  { id: "cron", label: "Cron", key: "4" },
  { id: "settings", label: "Settings", key: "5" },
]

function Frame(props: { rows: number; children: React.ReactNode }) {
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
        status={{ variant: "info", text: "ready" }}
      />
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.fgDim}>SELECT A SERVER</Text>
      </Box>
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Box flexDirection="column" width={36} flexShrink={0}>
          <Box flexDirection="column">
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.accent}>▍ </Text>
                <Text color={theme.success}>local </Text>
                <Text color={theme.accent} bold>
                  workspace dev
                </Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.divider}>{"  "}</Text>
                <Text color={theme.info}>remote </Text>
                <Text color={theme.fgMuted}>staging.codeplane.io</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.divider}>{"  "}</Text>
                <Text color={theme.info}>remote </Text>
                <Text color={theme.fgMuted}>prod.codeplane.io</Text>
              </Text>
            </Box>
            <Box>
              <Text wrap="truncate-end">
                <Text color={theme.divider}>{"  "}</Text>
                <Text color={theme.success}>local </Text>
                <Text color={theme.fgMuted}>ephemeral test</Text>
              </Text>
            </Box>
          </Box>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box>
            <Text bold color={theme.accent}>
              workspace dev
            </Text>
            <Text color={theme.fgDim}>{"   "}local · ready</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <MetricRow label="binary" value="v27.4.7 (default)" />
            <MetricRow label="url" value="http://127.0.0.1:auto" tone="muted" />
            <MetricRow label="headers" value="0 configured" tone="muted" />
            <MetricRow label="tls verify" value="enabled" tone="muted" />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.fgDim}>
              <Text color={theme.accent}>↵</Text> open ·{" "}
              <Text color={theme.accent}>e</Text> edit ·{" "}
              <Text color={theme.accent}>d</Text> delete
            </Text>
          </Box>
        </Box>
      </Box>
      <Box marginTop={2}>
        <StatusBar
          hints={[
            { keys: "↵", label: "open" },
            { keys: "a", label: "add remote" },
            { keys: "l", label: "add local" },
            { keys: "e", label: "edit" },
            { keys: "d", label: "delete" },
            { keys: "q", label: "quit" },
          ]}
        />
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
        status={{ variant: "success", text: "connected" }}
      />
      <Box marginTop={1} paddingX={1} flexDirection="column">
        <Text color={theme.fgDim}>WHERE TO WORK</Text>
        <Box marginTop={1}>
          <Text>
            Pick a working directory for{" "}
            <Text bold color={theme.accent}>
              workspace dev
            </Text>
            .
          </Text>
        </Box>
        <Box marginTop={1}>
          <PathInput
            value="~/projects/opencode/packages"
            active={false}
            hint="tab to type · i to type · / for commands"
          />
        </Box>
        <Box marginTop={1} flexDirection="row">
          <Text color={theme.fgDim}>here:</Text>
          <Box marginLeft={1}>
            <Breadcrumb
              path="/Users/dev/projects/opencode/packages"
              home="/Users/dev"
            />
          </Box>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.accent}>▍</Text>
              <Text color={theme.accent}>{`  ${glyph.folder}  `}</Text>
              <Text color={theme.accent} bold>
                codeplane
              </Text>
              <Text color={theme.fgDim}>/</Text>
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.divider}>{" "}</Text>
              <Text color={theme.accent}>{`  ${glyph.folder}  `}</Text>
              <Text color={theme.fg} bold>
                desktop
              </Text>
              <Text color={theme.fgDim}>/</Text>
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.divider}>{" "}</Text>
              <Text color={theme.accent}>{`  ${glyph.folder}  `}</Text>
              <Text color={theme.fg} bold>
                extensions
              </Text>
              <Text color={theme.fgDim}>/</Text>
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.divider}>{" "}</Text>
              <Text color={theme.accent}>{`  ${glyph.folder}  `}</Text>
              <Text color={theme.fg} bold>
                shared
              </Text>
              <Text color={theme.fgDim}>/</Text>
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.divider}>{" "}</Text>
              <Text color={theme.accent}>{`  ${glyph.folder}  `}</Text>
              <Text color={theme.fg} bold>
                web
              </Text>
              <Text color={theme.fgDim}>/</Text>
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.divider}>{" "}</Text>
              <Text color={theme.fgDim}>{`  ${glyph.file}  `}</Text>
              <Text color={theme.fgDim}>package.json</Text>
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.divider}>{" "}</Text>
              <Text color={theme.fgDim}>{`  ${glyph.file}  `}</Text>
              <Text color={theme.fgDim}>README.md</Text>
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              <Text color={theme.divider}>{" "}</Text>
              <Text color={theme.fgDim}>{`  ${glyph.file}  `}</Text>
              <Text color={theme.fgDim}>tsconfig.json</Text>
            </Text>
          </Box>
        </Box>
        <Box marginTop={2}>
          <StatusBar
            hints={[
              { keys: "↑↓", label: "navigate" },
              { keys: "↵/→", label: "enter dir" },
              { keys: "←/⌫", label: "up" },
              { keys: "i", label: "type path" },
              { keys: "h", label: "home" },
              { keys: "w", label: "worktree" },
              { keys: "space/o", label: "open here" },
              { keys: "esc", label: "back" },
            ]}
          />
        </Box>
      </Box>
    </Frame>
  )
}

function DirectoryInputScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        cwd="~/projects/opencode"
        status={{ variant: "success", text: "connected" }}
      />
      <Box marginTop={1} paddingX={1} flexDirection="column">
        <Text color={theme.fgDim}>WHERE TO WORK</Text>
        <Box marginTop={1}>
          <Text>
            Pick a working directory for{" "}
            <Text bold color={theme.accent}>
              workspace dev
            </Text>
            .
          </Text>
        </Box>
        <Box marginTop={1}>
          <PathInput
            value="~/projects/opencode/packages/codeplane/src"
            active
            hint="↵ resolve · tab back to browse · esc cancel"
          />
        </Box>
        <Box marginTop={1} flexDirection="row">
          <Text color={theme.fgDim}>here:</Text>
          <Box marginLeft={1}>
            <Breadcrumb
              path="/Users/dev/projects/opencode/packages"
              home="/Users/dev"
            />
          </Box>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={theme.divider}>{" "}</Text>
            <Text color={theme.fgDim}>{`  ${glyph.folder}  `}</Text>
            <Text color={theme.fgMuted}>codeplane/</Text>
          </Box>
          <Box>
            <Text color={theme.divider}>{" "}</Text>
            <Text color={theme.fgDim}>{`  ${glyph.folder}  `}</Text>
            <Text color={theme.fgMuted}>desktop/</Text>
          </Box>
          <Box>
            <Text color={theme.divider}>{" "}</Text>
            <Text color={theme.fgDim}>{`  ${glyph.folder}  `}</Text>
            <Text color={theme.fgMuted}>shared/</Text>
          </Box>
        </Box>
        <Box marginTop={2}>
          <StatusBar
            hints={[
              { keys: "↵", label: "resolve" },
              { keys: "tab", label: "browse" },
              { keys: "esc", label: "cancel" },
            ]}
          />
        </Box>
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
        cwd="~/projects/opencode/packages/codeplane"
        busy
        spinnerFrame={glyph.spinnerFrames[2]}
        status={{ variant: "success", text: "ready" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.fgDim}>{"Add JWT auth to api"}</Text>
        <Text color={theme.fgDim}>{"   ·   "}</Text>
        <Text color={theme.fgMuted}>{"5 messages · 3 tools"}</Text>
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Conversation parts={sampleConversation} spinnerFrame={glyph.spinnerFrames[2]} />
      </Box>
      <Box marginTop={1} paddingX={1} flexDirection="column">
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
              { keys: "n", label: "new" },
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
        cwd="~/projects/opencode/packages/codeplane"
        busy
        spinnerFrame={glyph.spinnerFrames[2]}
        status={{ variant: "success", text: "ready" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} alignItems="flex-start" gap={2}>
        <Box flexDirection="column" width={32} flexShrink={0}>
          <SectionHeader label="sessions" meta="5" />
          <Box paddingX={1}>
            <SessionList
              sessions={sampleSessions}
              selectedID="s1"
              active
              spinnerFrame={glyph.spinnerFrames[2]}
            />
          </Box>
          <Box marginTop={1}>
            <SectionHeader label="tasks" meta="2/5 done" />
          </Box>
          <Box paddingX={1}>
            <TodoList todos={sampleTodos} limit={5} />
          </Box>
          <Box marginTop={1}>
            <SectionHeader label="diff" meta="2 files · +12/-3" />
          </Box>
          <Box paddingX={1}>
            <DiffView lines={sampleDiff} limit={5} />
          </Box>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box paddingX={1}>
            <Text color={theme.fgDim}>{"Add JWT auth to api"}</Text>
            <Text color={theme.fgDim}>{"   ·   "}</Text>
            <Text color={theme.fgMuted}>{"5 messages · 3 tools"}</Text>
          </Box>
          <Box marginTop={1} paddingX={1}>
            <Conversation parts={sampleConversation} spinnerFrame={glyph.spinnerFrames[2]} />
          </Box>
        </Box>
      </Box>
      <Box marginTop={1} paddingX={1} flexDirection="column">
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

function PaletteScene(props: { rows: number }) {
  return (
    <Frame rows={props.rows}>
      <Header
        instance="workspace dev"
        branch="main"
        cwd="~/projects/opencode"
        status={{ variant: "info", text: "searching" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Conversation parts={sampleConversation.slice(0, 3)} />
      </Box>
      <Box marginTop={1} paddingX={1}>
        <CommandPalette
          filter="sess"
          selection="new-session"
          options={[
            { label: "Create Session", value: "new-session", hint: "fresh chat" },
            { label: "Archive Session", value: "archive", hint: "soft delete" },
            { label: "Share Session", value: "share", hint: "publish link" },
            { label: "Revert To Latest Assistant Output", value: "revert", hint: "rewind one" },
            { label: "Open Notifications", value: "notifications", hint: "permissions" },
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
        cwd="~/projects/opencode"
        status={{ variant: "warning", text: "2 pending" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="notifications" />
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.fgDim}>INBOX</Text>
      </Box>
      <Box marginTop={1} alignItems="flex-start" gap={2}>
        <Box flexDirection="column" width={48} flexShrink={0} paddingX={1}>
          <NotificationList items={sampleNotifications} selectedID="p1" active />
        </Box>
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <Text color={theme.warning} bold>
            permission · bun test
          </Text>
          <Box marginTop={1} flexDirection="column">
            <MetricRow label="patterns" value="bun test, bun run test:*" tone="muted" />
            <MetricRow label="requested" value="2 minutes ago" tone="muted" />
          </Box>
          <Box marginTop={2}>
            <Text color={theme.fgDim}>
              <Text color={theme.success}>y</Text> approve once ·{" "}
              <Text color={theme.success}>a</Text> always ·{" "}
              <Text color={theme.error}>x</Text> reject
            </Text>
          </Box>
        </Box>
      </Box>
      <Box marginTop={2}>
        <StatusBar
          hints={[
            { keys: "↑↓", label: "navigate" },
            { keys: "y", label: "approve once" },
            { keys: "a", label: "always" },
            { keys: "x", label: "reject" },
            { keys: "tab", label: "switch pane" },
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
        cwd="~/projects/opencode"
        status={{ variant: "info", text: "update available" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="settings" />
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.fgDim}>WORKSPACE</Text>
      </Box>
      <Box marginTop={1} paddingX={1} flexDirection="column">
        <MetricRow label="server" value="http://127.0.0.1:51123" tone="muted" />
        <MetricRow label="path" value="~/projects/opencode" />
        <MetricRow label="current" value="v27.4.7" />
        <MetricRow label="latest" value="v27.4.8" tone="success" />
        <MetricRow label="install" value="bun-binary" tone="muted" />
      </Box>
      <Box marginTop={2} paddingX={1} flexDirection="column">
        <Text color={theme.fgDim}>UPDATE</Text>
        <Box marginTop={1}>
          <ProgressBar value={62} label="downloading runtime" />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.fgDim}>
            press <Text color={theme.accent}>u</Text> to upgrade
          </Text>
        </Box>
      </Box>
      <Box marginTop={2}>
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
        status={{ variant: "success", text: "terminal" }}
      />
      <Box marginTop={1}>
        <RouteTabs tabs={sampleRouteTabs} active="session" />
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.fgDim}>TERMINAL · </Text>
        <Text color={theme.accent} bold>
          1
        </Text>
        <Text color={theme.fgDim}>{"   "}</Text>
        <Text color={theme.fgDim}>2</Text>
        <Text color={theme.fgDim}>{"   "}</Text>
        <Text color={theme.fgDim}>+ new</Text>
      </Box>
      <Box marginTop={1} paddingX={1} flexDirection="column">
        <Text color={theme.fgMuted}>$ bun test</Text>
        <Text color={theme.success}>✓ packages/auth/jwt.test.ts (12)</Text>
        <Text color={theme.success}>✓ packages/auth/middleware.test.ts (4)</Text>
        <Text color={theme.fgMuted}>$ bun run typecheck</Text>
        <Text color={theme.fgDim}>typescript v5.8.2</Text>
        <Text color={theme.success}>no errors found</Text>
        <Text color={theme.fgMuted}>$</Text>
      </Box>
      <Box marginTop={2}>
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
  | "directory-input"
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
    case "directory-input":
      return <DirectoryInputScene rows={props.rows} />
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
