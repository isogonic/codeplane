import { For, Show, createMemo, type JSX } from "solid-js"
import { useTheme } from "@/tui/context/theme"
import type { SyntaxStyle } from "@opentui/core"

export type RichBlockSegment = { kind: "markdown"; text: string }

type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "emph"; children: InlineNode[] }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }

type BlockNode =
  | { kind: "blank" }
  | { kind: "paragraph"; content: InlineNode[] }
  | { kind: "heading"; level: number; content: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: InlineNode[][] }
  | { kind: "blockquote"; lines: InlineNode[][] }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "rule" }

export function splitMarkdownBlocks(text: string): RichBlockSegment[] {
  if (!text.trim()) return []
  return [{ kind: "markdown", text }]
}

interface RichBlockProps {
  text: string
  syntax: SyntaxStyle
  conceal?: boolean
  streaming?: boolean
  experimental?: boolean
}

function parseInline(text: string): InlineNode[] {
  const result: InlineNode[] = []
  let index = 0

  const pushText = (next: string) => {
    if (!next) return
    const previous = result.at(-1)
    if (previous?.kind === "text") {
      previous.text += next
      return
    }
    result.push({ kind: "text", text: next })
  }

  while (index < text.length) {
    const link = text.slice(index).match(/^\[([^\]]+)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/)
    if (link) {
      result.push({ kind: "link", text: link[1], href: link[2] })
      index += link[0].length
      continue
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2)
      if (end !== -1) {
        result.push({ kind: "strong", children: parseInline(text.slice(index + 2, end)) })
        index = end + 2
        continue
      }
    }

    if (text[index] === "*") {
      const end = text.indexOf("*", index + 1)
      if (end !== -1) {
        result.push({ kind: "emph", children: parseInline(text.slice(index + 1, end)) })
        index = end + 1
        continue
      }
    }

    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1)
      if (end !== -1) {
        result.push({ kind: "code", text: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }

    const nextSpecial = text.slice(index + 1).search(/(\[|\*\*|\*|`)/)
    if (nextSpecial === -1) {
      pushText(text.slice(index))
      break
    }

    pushText(text.slice(index, index + nextSpecial + 1))
    index += nextSpecial + 1
  }

  return result
}

function isBlank(line: string) {
  return line.trim().length === 0
}

function isRule(line: string) {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
}

function parseFence(line: string): { fence: string; lang?: string } | undefined {
  const match = line.match(/^\s*(`{3,}|~{3,})([^\s`]*)\s*$/)
  return match ? { fence: match[1], lang: match[2] || undefined } : undefined
}

function closingFence(line: string, fence: string) {
  const escaped = fence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^\\s*${escaped}\\s*$`).test(line)
}

function parseBlocks(text: string): BlockNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const result: BlockNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ""

    if (isBlank(line)) {
      result.push({ kind: "blank" })
      index += 1
      continue
    }

    const fence = parseFence(line)
    if (fence) {
      const content: string[] = []
      index += 1
      while (index < lines.length && !closingFence(lines[index] ?? "", fence.fence)) {
        content.push(lines[index] ?? "")
        index += 1
      }
      if (index < lines.length) index += 1
      result.push({ kind: "code", lang: fence.lang, text: content.join("\n") })
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      const hashes = heading[1] ?? ""
      const title = heading[2] ?? ""
      result.push({
        kind: "heading",
        level: hashes.length,
        content: parseInline(title),
      })
      index += 1
      continue
    }

    if (isRule(line)) {
      result.push({ kind: "rule" })
      index += 1
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: InlineNode[][] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
        quoteLines.push(parseInline((lines[index] ?? "").replace(/^\s*>\s?/, "")))
        index += 1
      }
      result.push({ kind: "blockquote", lines: quoteLines })
      continue
    }

    const listItem = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/)
    if (listItem) {
      const ordered = !!listItem[2]
      const items: InlineNode[][] = []
      while (index < lines.length) {
        const current = (lines[index] ?? "").match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/)
        if (!current || (!!current[2]) !== ordered) break
        items.push(parseInline(current[3] ?? ""))
        index += 1
      }
      result.push({ kind: "list", ordered, items })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ""
      if (
        isBlank(current) ||
        parseFence(current) ||
        /^\s{0,3}(#{1,6})\s+/.test(current) ||
        isRule(current) ||
        /^\s*>\s?/.test(current) ||
        /^\s*(?:[-+*]|\d+\.)\s+/.test(current)
      ) {
        break
      }
      paragraph.push(current.trim())
      index += 1
    }
    result.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) })
  }

  while (result[0]?.kind === "blank") result.shift()
  while (result.at(-1)?.kind === "blank") result.pop()
  return result
}

export function RichBlockText(props: RichBlockProps): JSX.Element {
  const { theme } = useTheme()
  const content = () => props.text.trim()
  const markdown = () => props.experimental !== false
  const blocks = createMemo(() => parseBlocks(content()))

  const renderInline = (nodes: InlineNode[]): JSX.Element[] => {
    return nodes.map((node) => {
      if (node.kind === "text") return node.text
      if (node.kind === "code") {
        return <span style={{ fg: theme.markdownCode }}>{node.text}</span>
      }
      if (node.kind === "emph") {
        return (
          <span style={{ fg: theme.markdownEmph, italic: true }}>{renderInline(node.children)}</span>
        )
      }
      if (node.kind === "strong") {
        return (
          <span style={{ fg: theme.markdownStrong, bold: true }}>{renderInline(node.children)}</span>
        )
      }
      return (
        <>
          <span style={{ fg: theme.markdownLinkText, underline: true }}>{node.text}</span>
          <span style={{ fg: theme.markdownLink }}>{` (${node.href})`}</span>
        </>
      )
    })
  }

  const renderBlock = (block: BlockNode, blockIndex: number, total: number): JSX.Element => {
    const spacer = <Show when={blockIndex < total - 1}><box height={1} /></Show>
    switch (block.kind) {
      case "blank":
        return spacer
      case "paragraph":
        return (
          <>
            <text wrapMode="word" fg={theme.markdownText}>
              {renderInline(block.content)}
            </text>
            {spacer}
          </>
        )
      case "heading":
        return (
          <>
            <text wrapMode="word" fg={theme.markdownHeading}>
              <span style={{ bold: true }}>{renderInline(block.content)}</span>
            </text>
            {spacer}
          </>
        )
      case "list":
        return (
          <>
            <box flexDirection="column">
              <For each={block.items}>
                {(item, itemIndex) => (
                  <text wrapMode="word" fg={theme.markdownText}>
                    <span
                      style={{
                        fg: block.ordered ? theme.markdownListEnumeration : theme.markdownListItem,
                      }}
                    >
                      {block.ordered ? `${itemIndex() + 1}. ` : "• "}
                    </span>
                    {renderInline(item)}
                  </text>
                )}
              </For>
            </box>
            {spacer}
          </>
        )
      case "blockquote":
        return (
          <>
            <box flexDirection="column" border={["left"]} borderColor={theme.markdownBlockQuote} paddingLeft={1}>
              <For each={block.lines}>
                {(line) => (
                  <text wrapMode="word" fg={theme.markdownBlockQuote}>
                    {renderInline(line)}
                  </text>
                )}
              </For>
            </box>
            {spacer}
          </>
        )
      case "code":
        return (
          <>
            <code
              filetype={block.lang || "text"}
              drawUnstyledText={false}
              streaming={props.streaming ?? true}
              syntaxStyle={props.syntax}
              content={block.text}
              conceal={props.conceal ?? true}
              fg={theme.markdownCodeBlock}
            />
            {spacer}
          </>
        )
      case "rule":
        return (
          <>
            <text fg={theme.markdownHorizontalRule}>────────────────────────────────────────</text>
            {spacer}
          </>
        )
      default:
        return spacer
    }
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
          <For each={blocks()}>
            {(block, blockIndex) => renderBlock(block, blockIndex(), blocks().length)}
          </For>
        </Show>
      </box>
    </Show>
  )
}
