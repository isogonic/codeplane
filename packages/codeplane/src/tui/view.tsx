import React from "react"
import { Box, Text } from "ink"
import { glyph, theme, variantColor, variantLabel, type Variant } from "./theme"

// Visual language:
// - chrome is borderless except for the composer (the only true "input" surface)
// - sections are separated by a single dim rule, not a rounded box
// - role/state is shown by a 1-col color bar in the gutter, not a heading box
// - content gets the color; chrome stays out of the way

export type RouteTab = { id: string; label: string; key?: string; badge?: number }

export type SessionItem = {
  id: string
  title: string
  status?: "idle" | "busy" | "retry" | "archived"
  busyAttempt?: number
  shared?: boolean
  reverted?: boolean
}

export type ConversationPart =
  | { kind: "text"; role: "user" | "assistant"; lines: string[]; time?: string }
  | { kind: "reasoning"; lines: string[] }
  | { kind: "tool"; name: string; status: "pending" | "running" | "completed" | "error"; title?: string; output?: string[] }
  | { kind: "agent"; name: string }
  | { kind: "subtask"; agent: string; description: string }
  | { kind: "patch"; files: string[] }
  | { kind: "snapshot"; id: string }
  | { kind: "step"; phase: "start" | "finish"; reason?: string }
  | { kind: "retry"; attempt: number; message: string }
  | { kind: "compaction"; auto: boolean; overflow: boolean }
  | { kind: "file"; name: string }

export type TodoItem = {
  id: string
  status: "pending" | "in_progress" | "completed"
  priority?: "low" | "medium" | "high"
  text: string
}

export type DiffLine = { kind: "added" | "removed" | "context" | "header"; text: string }

export type KeyHint = { keys: string; label: string }

// Full-width horizontal rule, dim. Stand-in for a border without drawing one.
export function Rule(props: { width?: number; color?: string }) {
  const text = props.width ? glyph.divider.repeat(props.width) : glyph.divider.repeat(120)
  return (
    <Box>
      <Text color={props.color ?? theme.divider} dimColor>
        {text}
      </Text>
    </Box>
  )
}

// One-line section header — uppercase tracked label + optional inline meta.
export function SectionHeader(props: {
  label: string
  active?: boolean
  meta?: string
}) {
  return (
    <Box paddingX={1}>
      <Text wrap="truncate-end">
        {props.active ? (
          <Text color={theme.accent} bold>
            {`${glyph.caret} ${props.label.toUpperCase()}`}
          </Text>
        ) : (
          <Text color={theme.fgMuted}>{`  ${props.label.toUpperCase()}`}</Text>
        )}
        {props.meta ? <Text color={theme.fgDim}>{`   ${props.meta}`}</Text> : null}
      </Text>
    </Box>
  )
}

export function Header(props: {
  instance?: string
  branch?: string
  cwd?: string
  status?: { variant: Variant; text: string }
  spinnerFrame?: string
  busy?: boolean
}) {
  const left: Array<{ text: string; color?: string; bold?: boolean }> = [
    { text: "codeplane", color: theme.accent, bold: true },
  ]
  if (props.instance) left.push({ text: props.instance, color: theme.fg })
  if (props.cwd) left.push({ text: props.cwd, color: theme.fgMuted })
  if (props.branch) left.push({ text: props.branch, color: theme.fgDim })

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box>
          <Text wrap="truncate-end">
            {left.map((segment, index) => (
              <React.Fragment key={index}>
                {index > 0 ? <Text color={theme.fgDim}>{`  ${glyph.bullet}  `}</Text> : null}
                <Text bold={segment.bold} color={segment.color}>
                  {segment.text}
                </Text>
              </React.Fragment>
            ))}
          </Text>
        </Box>
        <Box>
          <Text>
            {props.busy && props.spinnerFrame ? (
              <Text color={theme.accent}>{`${props.spinnerFrame} `}</Text>
            ) : null}
            {props.status ? (
              <Text color={variantColor[props.status.variant]}>
                {props.status.text}
              </Text>
            ) : null}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

export function RouteTabs(props: { tabs: RouteTab[]; active: string }) {
  return (
    <Box paddingX={1}>
      <Text wrap="truncate-end">
        {props.tabs.map((tab, index) => {
          const active = tab.id === props.active
          return (
            <React.Fragment key={tab.id}>
              {index > 0 ? <Text color={theme.fgDim}>{"   "}</Text> : null}
              {active ? (
                <Text color={theme.accent} bold>
                  {`${tab.key ?? ""}${tab.key ? " " : ""}${tab.label}`}
                </Text>
              ) : (
                <Text color={theme.fgMuted}>
                  <Text color={theme.fgDim}>{tab.key ? `${tab.key} ` : ""}</Text>
                  {tab.label}
                </Text>
              )}
              {tab.badge ? (
                <Text color={active ? theme.warning : theme.fgDim}>{` ·${tab.badge}`}</Text>
              ) : null}
            </React.Fragment>
          )
        })}
      </Text>
    </Box>
  )
}

// Borderless "Panel" — title row + content stack, separated by a thin rule.
// Replaces the previous rounded-box treatment that made everything feel boxed.
export function Panel(props: {
  title: string
  subtitle?: string
  active?: boolean
  width?: number | string
  grow?: number
  height?: number | string
  bordered?: boolean
  children: React.ReactNode
}) {
  if (props.bordered) {
    return (
      <Box
        borderStyle="round"
        borderColor={props.active ? theme.accent : theme.divider}
        borderDimColor={!props.active}
        flexDirection="column"
        width={props.width}
        height={props.height}
        flexGrow={props.grow}
        flexShrink={1}
        minWidth={10}
      >
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            <Text bold color={props.active ? theme.accent : theme.fg}>
              {props.title}
            </Text>
            {props.subtitle ? <Text color={theme.fgDim}>{`   ${props.subtitle}`}</Text> : null}
          </Text>
        </Box>
        <Box paddingX={1} flexDirection="column" flexGrow={1}>
          {props.children}
        </Box>
      </Box>
    )
  }
  return (
    <Box
      flexDirection="column"
      width={props.width}
      height={props.height}
      flexGrow={props.grow}
      flexShrink={1}
      minWidth={10}
    >
      <SectionHeader label={props.title} active={props.active} meta={props.subtitle} />
      <Box paddingX={1} flexDirection="column" flexGrow={1}>
        {props.children}
      </Box>
    </Box>
  )
}

export function SessionList(props: {
  sessions: SessionItem[]
  selectedID?: string
  active?: boolean
  spinnerFrame?: string
}) {
  if (props.sessions.length === 0) {
    return (
      <Text color={theme.fgDim}>
        no sessions yet — press <Text color={theme.accent}>n</Text> to start one
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      {props.sessions.map((session) => {
        const selected = session.id === props.selectedID
        const indicator =
          session.status === "busy"
            ? props.spinnerFrame ?? glyph.filledDot
            : session.status === "retry"
              ? "↺"
              : session.status === "archived"
                ? glyph.hollowDot
                : " "
        const indicatorColor =
          session.status === "busy"
            ? theme.warning
            : session.status === "retry"
              ? theme.error
              : session.status === "archived"
                ? theme.fgDim
                : theme.fgDim
        const titleColor = selected ? (props.active ? theme.accent : theme.fg) : theme.fgMuted
        const trailing = session.shared ? " ⇗" : session.reverted ? " ↺" : ""
        const trailingColor = session.shared ? theme.fgDim : theme.warning
        // Selection bar in the gutter — Codex pattern. The status indicator is
        // a separate column so columns line up regardless of selection.
        const gutter = selected && props.active ? "▍" : " "
        return (
          <Box key={session.id}>
            <Text wrap="truncate-end">
              <Text color={selected && props.active ? theme.accent : theme.divider}>{gutter}</Text>
              <Text color={indicatorColor}>{` ${indicator} `}</Text>
              <Text color={titleColor} bold={selected}>
                {session.title}
              </Text>
              {trailing ? <Text color={trailingColor}>{trailing}</Text> : null}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export function TodoList(props: { todos: TodoItem[]; limit?: number }) {
  if (props.todos.length === 0) {
    return <Text color={theme.fgDim}>no tasks tracked</Text>
  }
  const visible = props.limit ? props.todos.slice(0, props.limit) : props.todos
  return (
    <Box flexDirection="column">
      {visible.map((todo) => {
        const symbol =
          todo.status === "completed"
            ? glyph.todoDone
            : todo.status === "in_progress"
              ? glyph.todoActive
              : glyph.todoPending
        const color =
          todo.status === "completed"
            ? theme.success
            : todo.status === "in_progress"
              ? theme.warning
              : theme.fgMuted
        const textColor = todo.status === "completed" ? theme.fgDim : theme.fg
        return (
          <Box key={todo.id}>
            <Text wrap="truncate-end">
              <Text color={color}>{symbol} </Text>
              <Text color={textColor} strikethrough={todo.status === "completed"}>
                {todo.text}
              </Text>
            </Text>
          </Box>
        )
      })}
      {props.limit && props.todos.length > props.limit ? (
        <Text color={theme.fgDim}>+{props.todos.length - props.limit} more…</Text>
      ) : null}
    </Box>
  )
}

export function DiffView(props: { lines: DiffLine[]; limit?: number }) {
  if (props.lines.length === 0) {
    return <Text color={theme.fgDim}>no diff in snapshot</Text>
  }
  const visible = props.limit ? props.lines.slice(0, props.limit) : props.lines
  return (
    <Box flexDirection="column">
      {visible.map((line, index) => {
        const color =
          line.kind === "added"
            ? theme.success
            : line.kind === "removed"
              ? theme.error
              : line.kind === "header"
                ? theme.accent
                : theme.fgMuted
        const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : line.kind === "header" ? "@" : " "
        return (
          <Text key={index} color={color} wrap="truncate-end">
            {prefix} {line.text}
          </Text>
        )
      })}
    </Box>
  )
}

function ToolStatusGlyph(props: { status: "pending" | "running" | "completed" | "error"; spinnerFrame?: string }) {
  if (props.status === "running") {
    return <Text color={theme.warning}>{props.spinnerFrame ?? glyph.toolRunning}</Text>
  }
  if (props.status === "completed") return <Text color={theme.success}>{glyph.toolDone}</Text>
  if (props.status === "error") return <Text color={theme.error}>{glyph.toolError}</Text>
  return <Text color={theme.fgDim}>{glyph.toolPending}</Text>
}

// Each role gets a colored vertical bar in the gutter, content in the body.
// Same shape Claude Code uses: speaker label one line, body indented two cols.
// Claude Code pattern: a colored label line plus 2-col indented content.
// No vertical gutter bar — Ink can't repeat a single char down dynamically
// without per-line plumbing, and the indent alone reads cleanly.
function MessageBlock(props: {
  role: "user" | "assistant"
  time?: string
  isFirst?: boolean
  children: React.ReactNode
}) {
  const color = props.role === "user" ? theme.user : theme.assistant
  const label = props.role === "user" ? "you" : "codeplane"
  return (
    <Box flexDirection="column" marginTop={props.isFirst ? 0 : 1}>
      <Box>
        <Text>
          <Text color={color} bold>
            {`${glyph.caret} ${label}`}
          </Text>
          {props.time ? <Text color={theme.fgDim}>{`   ${props.time}`}</Text> : null}
        </Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {props.children}
      </Box>
    </Box>
  )
}

function PartLines(props: { lines: string[]; color?: string; italic?: boolean }) {
  return (
    <Box flexDirection="column">
      {props.lines.map((line, index) => (
        <Text key={index} color={props.color} italic={props.italic} wrap="wrap">
          {line || " "}
        </Text>
      ))}
    </Box>
  )
}

function ReasoningBlock(props: { lines: string[] }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.reasoning} italic dimColor>
        thinking
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <PartLines lines={props.lines} color={theme.fgDim} italic />
      </Box>
    </Box>
  )
}

function ToolBlock(props: {
  name: string
  status: "pending" | "running" | "completed" | "error"
  title?: string
  output?: string[]
  spinnerFrame?: string
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text wrap="truncate-end">
          <ToolStatusGlyph status={props.status} spinnerFrame={props.spinnerFrame} />
          <Text color={theme.tool} bold>{` ${props.name}`}</Text>
          {props.title ? <Text color={theme.fgMuted}>{` ${props.title}`}</Text> : null}
        </Text>
      </Box>
      {props.output && props.output.length > 0 ? (
        // Code-like output gets a left vertical rule so it visually
        // separates from the surrounding prose, like Codex's tool blocks.
        <Box flexDirection="column">
          {props.output.slice(0, 6).map((line, index) => (
            <Box key={index}>
              <Text wrap="truncate-end">
                <Text color={theme.divider} dimColor>{`  ${glyph.vbar}  `}</Text>
                <Text color={theme.fgMuted}>{line || " "}</Text>
              </Text>
            </Box>
          ))}
          {props.output.length > 6 ? (
            <Box>
              <Text>
                <Text color={theme.divider} dimColor>{`  ${glyph.vbar}  `}</Text>
                <Text color={theme.fgDim}>+{props.output.length - 6} more lines…</Text>
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

function MetaPart(props: { children: React.ReactNode; color?: string }) {
  return (
    <Box marginTop={1}>
      <Text color={props.color ?? theme.fgDim}>{props.children}</Text>
    </Box>
  )
}

export function Conversation(props: {
  parts: ConversationPart[]
  empty?: string
  spinnerFrame?: string
}) {
  if (props.parts.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={theme.fgDim}>{props.empty ?? "Start typing below to begin a conversation."}</Text>
      </Box>
    )
  }
  const blocks: Array<{ role: "user" | "assistant"; time?: string; parts: ConversationPart[] }> = []
  let pending: { role: "user" | "assistant"; time?: string; parts: ConversationPart[] } | undefined
  const open = (role: "user" | "assistant", time?: string) => {
    pending = { role, time, parts: [] }
    blocks.push(pending)
  }
  for (const part of props.parts) {
    if (part.kind === "text") {
      open(part.role, part.time)
      pending!.parts.push(part)
      continue
    }
    if (!pending) open("assistant")
    pending!.parts.push(part)
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, blockIndex) => (
        <MessageBlock
          key={blockIndex}
          role={block.role}
          time={block.time}
          isFirst={blockIndex === 0}
        >
          {block.parts.map((part, partIndex) => {
            const key = `${blockIndex}:${partIndex}`
            switch (part.kind) {
              case "text":
                return <PartLines key={key} lines={part.lines} />
              case "reasoning":
                return <ReasoningBlock key={key} lines={part.lines} />
              case "tool":
                return (
                  <ToolBlock
                    key={key}
                    name={part.name}
                    status={part.status}
                    title={part.title}
                    output={part.output}
                    spinnerFrame={props.spinnerFrame}
                  />
                )
              case "agent":
                return (
                  <MetaPart key={key} color={theme.tool}>
                    {glyph.bullet} agent · {part.name}
                  </MetaPart>
                )
              case "subtask":
                return (
                  <MetaPart key={key} color={theme.tool}>
                    {glyph.bullet} subtask {part.agent} — {part.description}
                  </MetaPart>
                )
              case "patch":
                return (
                  <MetaPart key={key} color={theme.success}>
                    {glyph.check} patch · {part.files.join(", ")}
                  </MetaPart>
                )
              case "snapshot":
                return (
                  <MetaPart key={key}>
                    {glyph.bullet} snapshot {part.id}
                  </MetaPart>
                )
              case "step":
                return (
                  <MetaPart key={key}>
                    {part.phase === "start" ? "↳ step" : `step done${part.reason ? ` · ${part.reason}` : ""}`}
                  </MetaPart>
                )
              case "retry":
                return (
                  <MetaPart key={key} color={theme.warning}>
                    ↺ retry {part.attempt} · {part.message}
                  </MetaPart>
                )
              case "compaction":
                return (
                  <MetaPart key={key}>
                    ⌬ compaction {part.auto ? "auto" : "manual"}
                    {part.overflow ? " · overflow" : ""}
                  </MetaPart>
                )
              case "file":
                return (
                  <MetaPart key={key}>
                    {glyph.bullet} file {part.name}
                  </MetaPart>
                )
              default:
                return null
            }
          })}
        </MessageBlock>
      ))}
    </Box>
  )
}

// Composer — the only true "input box" in the UI gets the only border.
// Borderless when not focused so the conversation feels uninterrupted.
export function Composer(props: {
  value: string
  placeholder: string
  active?: boolean
  hint?: string
  status?: "idle" | "busy"
  spinnerFrame?: string
}) {
  const showCursor = props.active
  const valueColor = props.value ? theme.fg : theme.fgDim
  const promptColor = props.active ? theme.accent : theme.fgDim
  return (
    <Box
      borderStyle="round"
      borderColor={props.active ? theme.accent : theme.divider}
      borderDimColor={!props.active}
      flexDirection="column"
      paddingX={1}
    >
      <Box>
        <Text wrap="truncate-end">
          <Text color={promptColor} bold>{`${glyph.prompt} `}</Text>
          <Text color={valueColor}>{props.value || props.placeholder}</Text>
          {showCursor ? <Text color={theme.accent}>{glyph.cursor}</Text> : null}
        </Text>
      </Box>
      {props.hint || props.status === "busy" ? (
        <Box>
          <Text>
            {props.status === "busy" && props.spinnerFrame ? (
              <Text color={theme.warning}>{`${props.spinnerFrame} sending…  `}</Text>
            ) : null}
            {props.hint ? <Text color={theme.fgDim}>{props.hint}</Text> : null}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

// Path input — the directory picker's killer feature.
// One unified surface: a "directory" glyph + path + cursor. Always full width.
export function PathInput(props: {
  value: string
  active: boolean
  hint?: string
  spinnerFrame?: string
  loading?: boolean
}) {
  return (
    <Box
      borderStyle="round"
      borderColor={props.active ? theme.accent : theme.divider}
      borderDimColor={!props.active}
      flexDirection="column"
      paddingX={1}
    >
      <Box>
        <Text wrap="truncate-start">
          <Text color={props.active ? theme.accent : theme.fgDim} bold>
            {props.loading && props.spinnerFrame
              ? `${props.spinnerFrame}  `
              : `cd  `}
          </Text>
          <Text color={theme.fg}>{props.value}</Text>
          {props.active ? <Text color={theme.accent}>{glyph.cursor}</Text> : null}
        </Text>
      </Box>
      {props.hint ? (
        <Text color={theme.fgDim}>{props.hint}</Text>
      ) : null}
    </Box>
  )
}

// A row of recent directories shown above the file tree.
export function RecentDirectories(props: {
  recents: Array<{ path: string; label: string }>
  selectedPath?: string
  active?: boolean
  home?: string
}) {
  if (props.recents.length === 0) return null
  return (
    <Box flexDirection="column">
      {props.recents.map((item) => {
        const selected = item.path === props.selectedPath
        const display =
          props.home && item.path.startsWith(props.home)
            ? `~${item.path.slice(props.home.length)}`
            : item.path
        return (
          <Box key={item.path}>
            <Text wrap="truncate-start">
              <Text color={selected && props.active ? theme.accent : theme.divider}>
                {selected && props.active ? "▍" : " "}
              </Text>
              <Text color={selected && props.active ? theme.accent : theme.fgDim}>
                {`  ↻  `}
              </Text>
              <Text
                color={
                  selected && props.active
                    ? theme.accent
                    : theme.fgMuted
                }
                bold={selected && props.active}
              >
                {item.label}
              </Text>
              <Text color={theme.fgDim}>{`   ${display}`}</Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export function CommandPalette(props: {
  filter: string
  selection?: string
  options: Array<{ label: string; value: string; hint?: string }>
}) {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.accent}
      flexDirection="column"
      paddingX={1}
    >
      <Box>
        <Text wrap="truncate-end">
          <Text color={theme.accent} bold>{`${glyph.prompt} `}</Text>
          <Text>{props.filter}</Text>
          <Text color={theme.accent}>{glyph.cursor}</Text>
          <Text color={theme.fgDim}>{`   ${props.options.length} commands`}</Text>
        </Text>
      </Box>
      {props.options.length === 0 ? (
        <Text color={theme.fgDim}>no matching commands</Text>
      ) : (
        <Box flexDirection="column">
          {props.options.slice(0, 10).map((option) => {
            const selected = option.value === props.selection
            return (
              <Box key={option.value}>
                <Text wrap="truncate-end">
                  <Text color={selected ? theme.accent : theme.divider}>
                    {selected ? "▍" : " "}
                  </Text>
                  <Text color={selected ? theme.accent : theme.fgMuted} bold={selected}>
                    {` ${option.label}`}
                  </Text>
                  {option.hint ? (
                    <Text color={theme.fgDim}>{`   ${option.hint}`}</Text>
                  ) : null}
                </Text>
              </Box>
            )
          })}
        </Box>
      )}
      <Text color={theme.fgDim}>{`↑↓ navigate   ↵ run   esc close`}</Text>
    </Box>
  )
}

export function StatusBar(props: { hints: KeyHint[] }) {
  return (
    <Box paddingX={1}>
      <Text wrap="truncate-end">
        {props.hints.map((hint, index) => (
          <React.Fragment key={index}>
            {index > 0 ? <Text color={theme.fgDim}>{`   `}</Text> : null}
            <Text color={theme.accent} bold>
              {hint.keys}
            </Text>
            <Text color={theme.fgDim}>{` ${hint.label}`}</Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  )
}

export function ProgressBar(props: { value: number; width?: number; label?: string }) {
  const width = props.width ?? 28
  const clamped = Math.max(0, Math.min(100, Math.round(props.value)))
  const filled = Math.round((clamped / 100) * width)
  return (
    <Box>
      <Text color={theme.accent}>
        {"━".repeat(filled)}
        <Text color={theme.fgDim}>{"╌".repeat(Math.max(0, width - filled))}</Text>
      </Text>
      <Text color={theme.fg}>{`  ${clamped}%`}</Text>
      {props.label ? <Text color={theme.fgDim}>{`  ${props.label}`}</Text> : null}
    </Box>
  )
}

export function NotificationList(props: {
  items: Array<{ id: string; title: string; subtitle?: string; tone: "permission" | "question" }>
  selectedID?: string
  active?: boolean
}) {
  if (props.items.length === 0) {
    return <Text color={theme.fgDim}>no pending notifications</Text>
  }
  return (
    <Box flexDirection="column">
      {props.items.map((item) => {
        const selected = item.id === props.selectedID
        const color = item.tone === "permission" ? theme.warning : theme.info
        return (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text wrap="truncate-end">
                <Text color={selected && props.active ? theme.accent : theme.divider}>
                  {selected && props.active ? "▍" : " "}
                </Text>
                <Text color={color} bold>{` ${item.tone}`}</Text>
                <Text color={theme.fgDim}>{`   `}</Text>
                <Text bold={selected} color={selected ? theme.fg : theme.fgMuted}>
                  {item.title}
                </Text>
              </Text>
            </Box>
            {item.subtitle ? (
              <Box paddingLeft={4}>
                <Text color={theme.fgDim} wrap="truncate-end">
                  {item.subtitle}
                </Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

export function FileList(props: {
  files: Array<{ path: string; type: "file" | "directory"; rel?: string }>
  selected?: string
  active?: boolean
}) {
  if (props.files.length === 0) {
    return <Text color={theme.fgDim}>(empty)</Text>
  }
  return (
    <Box flexDirection="column">
      {props.files.map((file) => {
        const selected = file.path === props.selected
        const isDir = file.type === "directory"
        const labelColor = selected
          ? props.active
            ? theme.accent
            : theme.fg
          : isDir
            ? theme.fg
            : theme.fgMuted
        return (
          <Box key={file.path}>
            <Text wrap="truncate-end">
              <Text color={selected && props.active ? theme.accent : theme.divider}>
                {selected && props.active ? "▍" : " "}
              </Text>
              <Text color={isDir ? theme.accent : theme.fgDim}>
                {isDir ? ` ${glyph.folder} ` : ` ${glyph.file} `}
              </Text>
              <Text color={labelColor} bold={selected || isDir}>
                {file.rel ?? file.path}
              </Text>
              {isDir ? <Text color={theme.fgDim}>/</Text> : null}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

// Breadcrumb segments separated by /, last segment in accent.
export function Breadcrumb(props: { path: string; home?: string }) {
  const display =
    props.home && props.path.startsWith(props.home)
      ? `~${props.path.slice(props.home.length)}`
      : props.path
  const parts = display.split("/").filter(Boolean)
  if (parts.length === 0) {
    return <Text color={theme.fgDim}>/</Text>
  }
  const isAbsolute = display.startsWith("/")
  return (
    <Text wrap="truncate-start">
      {isAbsolute ? <Text color={theme.fgDim}>/</Text> : null}
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        const color = isLast ? theme.accent : part === "~" ? theme.accent : theme.fgMuted
        return (
          <React.Fragment key={index}>
            {index > 0 ? <Text color={theme.fgDim}>{glyph.separator}</Text> : null}
            <Text color={color} bold={isLast}>
              {part}
            </Text>
          </React.Fragment>
        )
      })}
    </Text>
  )
}

export function MetricRow(props: { label: string; value: string; tone?: Variant | "muted" | "accent" }) {
  const color =
    props.tone === "muted"
      ? theme.fgDim
      : props.tone === "accent"
        ? theme.accent
        : props.tone
          ? variantColor[props.tone]
          : theme.fg
  return (
    <Box>
      <Box width={18}>
        <Text color={theme.fgMuted}>{props.label}</Text>
      </Box>
      <Text color={color} wrap="truncate-end">
        {props.value}
      </Text>
    </Box>
  )
}
