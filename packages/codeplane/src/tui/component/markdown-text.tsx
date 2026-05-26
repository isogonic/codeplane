import { For, Show, createMemo, type JSX } from "solid-js"
import { useTheme } from "@/tui/context/theme"
import type { SyntaxStyle } from "@opentui/core"
import { marked, type Token, type Tokens } from "marked"

export type MarkdownSegment = { kind: "markdown"; text: string }

export function splitMarkdownSegments(text: string): MarkdownSegment[] {
  if (!text.trim()) return []
  return [{ kind: "markdown", text }]
}

interface MarkdownTextProps {
  text: string
  syntax: SyntaxStyle
  conceal?: boolean
  streaming?: boolean
  experimental?: boolean
}

export function MarkdownText(props: MarkdownTextProps): JSX.Element {
  const { theme } = useTheme()
  const content = () => props.text.trim()
  const markdown = () => props.experimental !== false
  const blocks = createMemo(() => marked.lexer(content(), { gfm: true }).filter((token) => token.type !== "space"))

  const tokenChildren = (token: Token): Token[] =>
    "tokens" in token && Array.isArray(token.tokens) ? token.tokens : []

  const isListToken = (token: Token): token is Tokens.List =>
    token.type === "list" && "items" in token && Array.isArray(token.items)

  const isTableToken = (token: Token): token is Tokens.Table =>
    token.type === "table" &&
    "header" in token &&
    Array.isArray(token.header) &&
    "rows" in token &&
    Array.isArray(token.rows)

  const plainInline = (tokens: Token[]): string => {
    return tokens
      .map((token) => {
        if (token.type === "checkbox") return ""
        if (tokenChildren(token).length > 0) return plainInline(tokenChildren(token))
        if ("text" in token && typeof token.text === "string") return token.text
        return "raw" in token && typeof token.raw === "string" ? token.raw : ""
      })
      .join("")
  }

  const renderInline = (tokens: Token[]): JSX.Element[] => {
    return tokens.flatMap((token): JSX.Element[] => {
      if (token.type === "checkbox") {
        return [token.checked ? "[x] " : "[ ] "]
      }
      if (token.type === "br") return ["\n"]
      if (token.type === "codespan") {
        return [<span style={{ fg: theme.markdownCode }}>{token.text}</span>]
      }
      if (token.type === "em") {
        return [<span style={{ fg: theme.markdownEmph, italic: true }}>{renderInline(tokenChildren(token))}</span>]
      }
      if (token.type === "strong") {
        return [<span style={{ fg: theme.markdownStrong, bold: true }}>{renderInline(tokenChildren(token))}</span>]
      }
      if (token.type === "del") {
        return [<span style={{ fg: theme.textMuted, strikethrough: true }}>{renderInline(tokenChildren(token))}</span>]
      }
      if (token.type === "link") {
        const href = "href" in token && typeof token.href === "string" ? token.href : ""
        return [
          <>
            <span style={{ fg: theme.markdownLinkText, underline: true }}>{renderInline(tokenChildren(token))}</span>
            <span style={{ fg: theme.markdownLink }}>{` (${href})`}</span>
          </>,
        ]
      }
      if (token.type === "image") {
        return [<span style={{ fg: theme.markdownImageText }}>{token.text || token.href}</span>]
      }
      if (tokenChildren(token).length > 0) return renderInline(tokenChildren(token))
      if ("text" in token && typeof token.text === "string") return [token.text]
      return "raw" in token && typeof token.raw === "string" ? [token.raw] : []
    })
  }

  const itemContentTokens = (item: Tokens.ListItem) => (item.tokens ?? []).filter((token) => token.type !== "checkbox")

  const firstItemText = (item: Tokens.ListItem) => {
    const first = itemContentTokens(item)[0]
    if (!first) return []
    if (first.type !== "paragraph" && first.type !== "text") return []
    const tokens = tokenChildren(first).length > 0 ? tokenChildren(first) : [first]
    return item.task ? tokens.filter((token) => token.type !== "checkbox") : tokens
  }

  const restItemBlocks = (item: Tokens.ListItem) => {
    const tokens = itemContentTokens(item)
    const first = tokens[0]
    if (first?.type !== "paragraph" && first?.type !== "text") return tokens
    return tokens.slice(1)
  }

  const tableText = (cell?: Tokens.TableCell) => (cell ? plainInline(cell.tokens ?? []) : "")
  const tableTokens = (cell?: Tokens.TableCell) => cell?.tokens ?? []

  const renderTable = (table: Tokens.Table) => {
    const headers = table.header.map((cell, index) => tableText(cell) || `Column ${index + 1}`)
    return (
      <box flexDirection="column">
        <Show
          when={table.rows.length > 0}
          fallback={
            <text wrapMode="word" fg={theme.markdownText}>
              <For each={headers}>
                {(header, columnIndex) => (
                  <>
                    <span style={{ bold: true, fg: theme.markdownHeading }}>{header}</span>
                    <Show when={columnIndex() < headers.length - 1}>
                      <span style={{ fg: theme.textMuted }}> / </span>
                    </Show>
                  </>
                )}
              </For>
            </text>
          }
        >
          <For each={table.rows}>
            {(row, rowIndex) => (
              <box
                flexDirection="column"
                border={["left"]}
                borderColor={theme.textMuted}
                paddingLeft={1}
                paddingBottom={rowIndex() < table.rows.length - 1 ? 1 : 0}
              >
                <For each={headers}>
                  {(header, columnIndex) => {
                    const value = tableTokens(row[columnIndex()])
                    return (
                      <text wrapMode="word" fg={theme.markdownText}>
                        <span style={{ bold: true, fg: theme.markdownHeading }}>{header}: </span>
                        {renderInline(value)}
                      </text>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </box>
    )
  }

  const renderList = (list: Tokens.List): JSX.Element => {
    const start = typeof list.start === "number" ? list.start : 1
    return (
      <box flexDirection="column">
        <For each={list.items}>
          {(item, itemIndex) => {
            const marker = list.ordered
              ? `${start + itemIndex()}. `
              : item.task
                ? item.checked
                  ? "[x] "
                  : "[ ] "
                : "• "
            const rest = restItemBlocks(item)
            return (
              <box flexDirection="column">
                <text wrapMode="word" fg={theme.markdownText}>
                  <span style={{ fg: list.ordered ? theme.markdownListEnumeration : theme.markdownListItem }}>
                    {marker}
                  </span>
                  {renderInline(firstItemText(item))}
                </text>
                <Show when={rest.length > 0}>
                  <box flexDirection="column" paddingLeft={marker.length}>
                    {renderBlocks(rest)}
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
      </box>
    )
  }

  const renderBlock = (block: Token): JSX.Element => {
    switch (block.type) {
      case "heading":
        return (
          <text wrapMode="word" fg={theme.markdownHeading}>
            <span style={{ bold: true }}>{renderInline(tokenChildren(block))}</span>
          </text>
        )
      case "paragraph":
        return (
          <text wrapMode="word" fg={theme.markdownText}>
            {renderInline(tokenChildren(block))}
          </text>
        )
      case "text":
        return (
          <text wrapMode="word" fg={theme.markdownText}>
            {renderInline(tokenChildren(block).length > 0 ? tokenChildren(block) : [block])}
          </text>
        )
      case "blockquote":
        return (
          <box flexDirection="column" border={["left"]} borderColor={theme.markdownBlockQuote} paddingLeft={1}>
            {renderBlocks(tokenChildren(block))}
          </box>
        )
      case "code":
        return (
          <code
            filetype={block.lang || "text"}
            drawUnstyledText={false}
            streaming={props.streaming ?? true}
            syntaxStyle={props.syntax}
            content={block.text}
            conceal={props.conceal ?? true}
            fg={theme.markdownCodeBlock}
          />
        )
      case "list":
        return isListToken(block) ? renderList(block) : <></>
      case "table":
        return isTableToken(block) ? renderTable(block) : <></>
      case "hr":
        return <text fg={theme.markdownHorizontalRule}>────────────────────────────────────────</text>
      case "def":
        return <></>
      default:
        if (tokenChildren(block).length > 0) return <>{renderBlocks(tokenChildren(block))}</>
        if ("text" in block && typeof block.text === "string") return <text fg={theme.markdownText}>{block.text}</text>
        return <text fg={theme.markdownText}>{"raw" in block && typeof block.raw === "string" ? block.raw : ""}</text>
    }
  }

  const renderBlocks = (tokens: Token[]): JSX.Element => {
    const visible = tokens.filter((token) => token.type !== "space")
    return (
      <For each={visible}>
        {(block, blockIndex) => (
          <>
            {renderBlock(block)}
            <Show when={blockIndex() < visible.length - 1}>
              <box height={1} />
            </Show>
          </>
        )}
      </For>
    )
  }

  return (
    <Show when={content()}>
      <box flexDirection="column" flexShrink={0} flexGrow={1} width="100%">
        <Show
          when={markdown()}
          fallback={
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={props.streaming ?? true}
              syntaxStyle={props.syntax}
              content={content()}
              conceal={props.conceal ?? true}
              fg={theme.text}
            />
          }
        >
          {renderBlocks(blocks())}
        </Show>
      </box>
    </Show>
  )
}
