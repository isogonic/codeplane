import { type ComponentProps, createMemo, Show, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import stripAnsi from "strip-ansi"
import { Collapsible } from "./collapsible"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"
import { useI18n } from "../context/i18n"
import { showToast } from "./toast"
import { writeClipboardText } from "./clipboard"

export interface ToolErrorCardProps extends Omit<ComponentProps<"div">, "children"> {
  tool: string
  error: string
  defaultOpen?: boolean
  subtitle?: string
  href?: string
}

export function ToolErrorCard(props: ToolErrorCardProps) {
  const i18n = useI18n()
  const [state, setState] = createStore({
    open: props.defaultOpen ?? false,
    copied: false,
  })
  const open = () => state.open
  const copied = () => state.copied
  const [split, rest] = splitProps(props, ["tool", "error", "defaultOpen", "subtitle", "href"])
  const name = createMemo(() => {
    const map: Record<string, string> = {
      read: "ui.tool.read",
      list: "ui.tool.list",
      glob: "ui.tool.glob",
      grep: "ui.tool.grep",
      task: "ui.tool.task",
      webfetch: "ui.tool.webfetch",
      websearch: "ui.tool.websearch",
      codesearch: "ui.tool.codesearch",
      bash: "ui.tool.shell",
      ssh: "ui.tool.ssh",
      git: "ui.tool.git",
      apply_patch: "ui.tool.patch",
      question: "ui.tool.questions",
    }
    const key = map[split.tool]
    if (!key) return split.tool
    if (!key.includes(".")) return key
    return i18n.t(key)
  })
  const cleaned = createMemo(() => stripAnsi(split.error).replace(/^Error:\s*/, "").trim())
  const tail = createMemo(() => {
    const value = cleaned()
    const prefix = `${split.tool} `
    if (value.startsWith(prefix)) return value.slice(prefix.length)
    return value
  })

  const subtitle = createMemo(() => {
    if (split.subtitle) return split.subtitle
    const parts = tail().split(": ")
    if (parts.length <= 1) return i18n.t("ui.toolErrorCard.failed")
    const head = (parts[0] ?? "").trim()
    if (!head) return i18n.t("ui.toolErrorCard.failed")
    return head[0] ? head[0].toUpperCase() + head.slice(1) : i18n.t("ui.toolErrorCard.failed")
  })

  const body = createMemo(() => {
    const parts = tail().split(": ")
    if (parts.length <= 1) return cleaned()
    return parts.slice(1).join(": ").trim() || cleaned()
  })
  const summary = createMemo(() => body().split("\n").find((line) => line.trim())?.trim() ?? body())

  const copy = async () => {
    const text = cleaned()
    if (!text) return
    if (!(await writeClipboardText(text))) return
    showToast({
      variant: "success",
      icon: "circle-check",
      title: i18n.t("ui.message.copied"),
      description: i18n.t("ui.message.copiedText"),
    })
    setState("copied", true)
    setTimeout(() => setState("copied", false), 2000)
  }

  return (
    <div {...rest} data-component="tool-error-inline" data-open={open() ? "true" : "false"}>
      <Collapsible
        class="tool-collapsible"
        data-open={open() ? "true" : "false"}
        variant="ghost"
        open={open()}
        onOpenChange={(value) => setState("open", value)}
      >
        <Collapsible.Trigger>
          <div data-slot="tool-error-trigger">
            <span data-slot="tool-error-icon">
              <Icon name="warning" size="small" style={{ "stroke-width": 1.5 }} />
            </span>
            <span data-slot="tool-error-tool">{name()}</span>
            <Show when={subtitle()} keyed>
              {(value) => (
                <Show
                  when={split.href && split.subtitle}
                  fallback={<span data-slot="tool-error-kind">{value}</span>}
                >
                  <a
                    data-slot="tool-error-kind"
                    class="clickable subagent-link"
                    href={split.href!}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {value}
                  </a>
                </Show>
              )}
            </Show>
            <Show when={summary()} keyed>
              {(value) => (
                <span data-slot="tool-error-summary" title={value}>
                  {value}
                </span>
              )}
            </Show>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-slot="tool-error-content">
            <Show when={open()}>
              <div data-slot="tool-error-copy">
                <Tooltip
                  value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.toolErrorCard.copyError")}
                  placement="top"
                  gutter={4}
                >
                  <IconButton
                    icon={copied() ? "check" : "copy"}
                    size="normal"
                    variant="ghost"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void copy()
                    }}
                    aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.toolErrorCard.copyError")}
                  />
                </Tooltip>
              </div>
            </Show>
            <Show when={body()} keyed>{(value) => <div data-slot="tool-error-description">{value}</div>}</Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
