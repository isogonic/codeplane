import type { FileContent } from "@codeplane-ai/sdk/v2"
import { createEffect, createMemo, createResource, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js"
import { useI18n } from "../context/i18n"
import {
  dataUrlFromMediaValue,
  hasMediaValue,
  isBinaryContent,
  type MediaKind,
  mediaKindFromPath,
  normalizeMimeType,
  svgTextFromValue,
  textFromValue,
} from "../pierre/media"
import { detectDelimiter, parseDelimited } from "../pierre/table"
import { Markdown } from "./markdown"

export type FileMediaOptions = {
  mode?: "auto" | "off"
  path?: string
  current?: unknown
  before?: unknown
  after?: unknown
  deleted?: boolean
  readFile?: (path: string) => Promise<FileContent | undefined>
  onLoad?: () => void
  onError?: (ctx: { kind: MediaKind }) => void
}

const BINARY_MEDIA: ReadonlySet<MediaKind> = new Set(["image", "audio", "video", "pdf"])

function mediaValue(cfg: FileMediaOptions) {
  if (cfg.current !== undefined) return cfg.current
  return cfg.after ?? cfg.before
}

export function FileMedia(props: { media?: FileMediaOptions; fallback: () => JSX.Element }) {
  const i18n = useI18n()
  const cfg = () => props.media
  const kind = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return
    return mediaKindFromPath(media.path)
  })

  const isBinary = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return false
    if (kind()) return false
    return isBinaryContent(media.current as any)
  })

  const onLoad = () => props.media?.onLoad?.()

  const deleted = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || !k) return false
    if (media.deleted) return true
    if (k === "svg") return false
    if (media.current !== undefined) return false
    return !hasMediaValue(media.after as any) && hasMediaValue(media.before as any)
  })

  const direct = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || !BINARY_MEDIA.has(k as MediaKind)) return
    return dataUrlFromMediaValue(mediaValue(media), k as MediaKind)
  })

  const request = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || !BINARY_MEDIA.has(k as MediaKind)) return
    if (media.current !== undefined) return
    if (deleted()) return
    if (direct()) return
    if (!media.path || !media.readFile) return

    return {
      key: `${k}:${media.path}`,
      kind: k as MediaKind,
      path: media.path,
      readFile: media.readFile,
      onError: media.onError,
    }
  })

  const [loaded] = createResource(request, async (input) => {
    return input.readFile(input.path).then(
      (result) => {
        const src = dataUrlFromMediaValue(result as any, input.kind)
        if (!src) {
          input.onError?.({ kind: input.kind })
          return { key: input.key, error: true as const }
        }

        return {
          key: input.key,
          src,
          mime: input.kind === "audio" || input.kind === "video" ? normalizeMimeType(result?.mimeType) : undefined,
        }
      },
      () => {
        input.onError?.({ kind: input.kind })
        return { key: input.key, error: true as const }
      },
    )
  })

  const remote = createMemo(() => {
    const input = request()
    const value = loaded()
    if (!input || !value || value.key !== input.key) return
    return value
  })

  const src = createMemo(() => {
    const value = remote()
    return direct() ?? (value && "src" in value ? value.src : undefined)
  })
  const status = createMemo(() => {
    if (direct()) return "ready" as const
    if (!request()) return "idle" as const
    if (loaded.loading) return "loading" as const
    if (remote()?.error) return "error" as const
    if (src()) return "ready" as const
    return "idle" as const
  })
  const audioMime = createMemo(() => {
    const value = remote()
    return value && "mime" in value ? value.mime : undefined
  })

  const svgSource = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    return svgTextFromValue(media.current as any)
  })
  const svgSrc = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    return dataUrlFromMediaValue(media.current as any, "svg")
  })
  const svgInvalid = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    if (svgSource() !== undefined) return
    if (!hasMediaValue(media.current as any)) return
    return [media.path, media.current] as const
  })

  createEffect(
    on(
      svgInvalid,
      (value) => {
        if (!value) return
        cfg()?.onError?.({ kind: "svg" })
      },
      { defer: true },
    ),
  )

  const textContent = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media) return
    if (k !== "table" && k !== "html" && k !== "markdown" && k !== "json") return
    return textFromValue(mediaValue(media))
  })

  const kindLabel = (value: MediaKind) => {
    const key = `ui.fileMedia.kind.${value}`
    return i18n.t(key)
  }

  const messageBox = (value: string) => (
    <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">{value}</div>
  )

  return (
    <Switch>
      <Match when={kind() === "image" || kind() === "audio" || kind() === "video" || kind() === "pdf"}>
        <Show
          when={src()}
          keyed
          fallback={(() => {
            const media = cfg()
            const k = kind()
            if (!media || !k || !BINARY_MEDIA.has(k)) return props.fallback()
            const label = kindLabel(k)

            if (deleted()) return messageBox(i18n.t("ui.fileMedia.state.removed", { kind: label }))
            if (status() === "loading") return messageBox(i18n.t("ui.fileMedia.state.loading", { kind: label }))
            if (status() === "error") return messageBox(i18n.t("ui.fileMedia.state.error", { kind: label }))
            return messageBox(i18n.t("ui.fileMedia.state.unavailable", { kind: label }))
          })()}
        >
          {(value) => {
            const k = kind()
            if (k === "image") {
              return (
                <div class="flex justify-center bg-background-stronger px-6 py-4">
                  <img
                    src={value}
                    alt={cfg()?.path}
                    class="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
                    onLoad={onLoad}
                  />
                </div>
              )
            }

            if (k === "audio") {
              return (
                <div class="flex justify-center bg-background-stronger px-6 py-4">
                  <audio class="w-full max-w-xl" controls preload="metadata" onLoadedMetadata={onLoad}>
                    <source src={value} type={audioMime()} />
                  </audio>
                </div>
              )
            }

            if (k === "video") {
              return (
                <div class="flex justify-center bg-background-stronger px-6 py-4">
                  <video
                    class="max-h-[70vh] max-w-full rounded border border-border-weak-base bg-background-base"
                    controls
                    preload="metadata"
                    onLoadedMetadata={onLoad}
                  >
                    <source src={value} type={audioMime()} />
                  </video>
                </div>
              )
            }

            if (k === "pdf") {
              return (
                <div class="bg-background-stronger px-6 py-4">
                  <iframe
                    src={value}
                    title={cfg()?.path ?? "pdf"}
                    class="block h-[80vh] w-full rounded border border-border-weak-base bg-background-base"
                    onLoad={onLoad}
                  />
                </div>
              )
            }

            return props.fallback()
          }}
        </Show>
      </Match>

      <Match when={kind() === "svg"}>
        {(() => {
          if (svgSource() === undefined && svgSrc() == null) return props.fallback()

          return (
            <div class="flex flex-col gap-4 px-6 py-4">
              <Show when={svgSource() !== undefined}>{props.fallback()}</Show>
              <Show when={svgSrc()} keyed>
                {(value) => (
                  <div class="flex justify-center">
                    <img
                      src={value}
                      alt={cfg()?.path}
                      class="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
                      onLoad={onLoad}
                    />
                  </div>
                )}
              </Show>
            </div>
          )
        })()}
      </Match>

      <Match when={kind() === "table"}>
        <Show when={textContent()} keyed fallback={props.fallback()}>
          {(text) => <TableView path={cfg()?.path} text={text} fallback={props.fallback} onReady={onLoad} />}
        </Show>
      </Match>

      <Match when={kind() === "markdown"}>
        <Show when={textContent()} keyed fallback={props.fallback()}>
          {(text) => <MarkdownView path={cfg()?.path} text={text} fallback={props.fallback} onReady={onLoad} />}
        </Show>
      </Match>

      <Match when={kind() === "html"}>
        <Show when={textContent()} keyed fallback={props.fallback()}>
          {(text) => <HtmlView text={text} fallback={props.fallback} onReady={onLoad} />}
        </Show>
      </Match>

      <Match when={kind() === "json"}>
        <Show when={textContent()} keyed fallback={props.fallback()}>
          {(text) => <JsonView text={text} fallback={props.fallback} onReady={onLoad} />}
        </Show>
      </Match>

      <Match when={isBinary()}>
        <div class="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <div class="text-14-semibold text-text-strong">
            {cfg()?.path?.split("/").pop() ?? i18n.t("ui.fileMedia.binary.title")}
          </div>
          <div class="text-14-regular text-text-weak">
            {(() => {
              const path = cfg()?.path
              if (!path) return i18n.t("ui.fileMedia.binary.description.default")
              return i18n.t("ui.fileMedia.binary.description.path", { path })
            })()}
          </div>
        </div>
      </Match>

      <Match when={true}>{props.fallback()}</Match>
    </Switch>
  )
}

function ToggleHeader(props: {
  label: string
  active: "preview" | "source"
  onChange: (value: "preview" | "source") => void
  previewLabel: string
  sourceLabel: string
}) {
  const buttonClass = (value: "preview" | "source") => {
    const base = "px-2 py-1 text-12-medium rounded transition-colors"
    if (props.active === value) return `${base} bg-background-base text-text-strong border border-border-weak-base`
    return `${base} text-text-weak hover:text-text-strong`
  }
  return (
    <div class="flex items-center justify-between gap-3 border-b border-border-weak-base px-6 py-2">
      <div class="text-12-regular text-text-weak truncate">{props.label}</div>
      <div class="flex items-center gap-1">
        <button type="button" class={buttonClass("preview")} onClick={() => props.onChange("preview")}>
          {props.previewLabel}
        </button>
        <button type="button" class={buttonClass("source")} onClick={() => props.onChange("source")}>
          {props.sourceLabel}
        </button>
      </div>
    </div>
  )
}

function TableView(props: {
  path: string | undefined
  text: string
  fallback: () => JSX.Element
  onReady: () => void
}) {
  const i18n = useI18n()
  const [view, setView] = createSignal<"preview" | "source">("preview")

  const parsed = createMemo(() => {
    const delimiter = detectDelimiter(props.path, props.text)
    return parseDelimited(props.text, delimiter)
  })

  const empty = createMemo(() => parsed().headers.length === 0 && parsed().rows.length === 0)

  createEffect(() => {
    parsed()
    requestAnimationFrame(props.onReady)
  })

  return (
    <div class="flex flex-col">
      <ToggleHeader
        label={i18n.t("ui.fileMedia.table.summary", {
          rows: parsed().rows.length,
          cols: parsed().headers.length,
        })}
        active={view()}
        onChange={setView}
        previewLabel={i18n.t("ui.fileMedia.toggle.preview")}
        sourceLabel={i18n.t("ui.fileMedia.toggle.source")}
      />
      <Show
        when={view() === "preview"}
        fallback={props.fallback()}
      >
        <Show when={!empty()} fallback={<div class="px-6 py-6 text-text-weak">{i18n.t("ui.fileMedia.table.empty")}</div>}>
          <div class="overflow-auto px-6 py-4 max-h-[70vh]">
            <table class="text-13-regular border-collapse w-full">
              <thead class="sticky top-0 bg-background-base z-10">
                <tr>
                  <For each={parsed().headers}>
                    {(header, index) => (
                      <th class="border border-border-weak-base px-3 py-2 text-left text-12-semibold text-text-strong whitespace-nowrap">
                        {header || `#${index() + 1}`}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={parsed().rows}>
                  {(row) => (
                    <tr class="even:bg-background-stronger">
                      <For each={parsed().headers}>
                        {(_, idx) => (
                          <td class="border border-border-weak-base px-3 py-1.5 align-top whitespace-pre-wrap">
                            {row[idx()] ?? ""}
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={parsed().truncated}>
              <div class="mt-3 text-12-regular text-text-weak">{i18n.t("ui.fileMedia.table.truncated")}</div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function MarkdownView(props: {
  path: string | undefined
  text: string
  fallback: () => JSX.Element
  onReady: () => void
}) {
  const i18n = useI18n()
  const [view, setView] = createSignal<"preview" | "source">("preview")

  createEffect(() => {
    props.text
    requestAnimationFrame(props.onReady)
  })

  return (
    <div class="flex flex-col">
      <ToggleHeader
        label={props.path ?? "markdown"}
        active={view()}
        onChange={setView}
        previewLabel={i18n.t("ui.fileMedia.toggle.preview")}
        sourceLabel={i18n.t("ui.fileMedia.toggle.source")}
      />
      <Show when={view() === "preview"} fallback={props.fallback()}>
        <div class="px-6 py-4 max-w-3xl mx-auto">
          <Markdown text={props.text} />
        </div>
      </Show>
    </div>
  )
}

function HtmlView(props: { text: string; fallback: () => JSX.Element; onReady: () => void }) {
  const i18n = useI18n()
  const [view, setView] = createSignal<"preview" | "source">("preview")

  return (
    <div class="flex flex-col">
      <ToggleHeader
        label={i18n.t("ui.fileMedia.html.label")}
        active={view()}
        onChange={setView}
        previewLabel={i18n.t("ui.fileMedia.toggle.preview")}
        sourceLabel={i18n.t("ui.fileMedia.toggle.source")}
      />
      <Show when={view() === "preview"} fallback={props.fallback()}>
        <div class="bg-background-stronger px-6 py-4">
          <iframe
            sandbox=""
            srcdoc={props.text}
            title="html preview"
            class="block h-[70vh] w-full rounded border border-border-weak-base bg-white"
            onLoad={props.onReady}
          />
        </div>
      </Show>
    </div>
  )
}

function JsonView(props: { text: string; fallback: () => JSX.Element; onReady: () => void }) {
  const i18n = useI18n()
  const [view, setView] = createSignal<"preview" | "source">("preview")

  const formatted = createMemo(() => {
    try {
      const parsed = JSON.parse(stripJsonc(props.text))
      return { ok: true as const, value: parsed }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
    }
  })

  createEffect(() => {
    formatted()
    requestAnimationFrame(props.onReady)
  })

  return (
    <div class="flex flex-col">
      <ToggleHeader
        label={i18n.t("ui.fileMedia.json.label")}
        active={view()}
        onChange={setView}
        previewLabel={i18n.t("ui.fileMedia.toggle.preview")}
        sourceLabel={i18n.t("ui.fileMedia.toggle.source")}
      />
      <Show when={view() === "preview"} fallback={props.fallback()}>
        <div class="overflow-auto px-6 py-4 max-h-[70vh]">
          <Show
            when={formatted().ok}
            fallback={
              <div class="text-13-regular text-text-weak">
                {i18n.t("ui.fileMedia.json.invalid", {
                  message: formatted().ok ? "" : (formatted() as { message: string }).message,
                })}
              </div>
            }
          >
            <JsonNode value={(formatted() as { value: unknown }).value} depth={0} />
          </Show>
        </div>
      </Show>
    </div>
  )
}

function stripJsonc(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([\]}])/g, "$1")
}

function JsonNode(props: { value: unknown; depth: number; name?: string }): JSX.Element {
  const indent = () => "  ".repeat(props.depth)
  const label = () =>
    props.name !== undefined ? <span class="text-syntax-property">"{props.name}"</span> : null

  if (props.value === null) {
    return (
      <div>
        {indent()}
        {label()}
        {props.name !== undefined ? ": " : ""}
        <span class="text-syntax-keyword">null</span>
      </div>
    )
  }

  if (typeof props.value === "string") {
    return (
      <div>
        {indent()}
        {label()}
        {props.name !== undefined ? ": " : ""}
        <span class="text-syntax-string">"{props.value}"</span>
      </div>
    )
  }

  if (typeof props.value === "number" || typeof props.value === "boolean") {
    return (
      <div>
        {indent()}
        {label()}
        {props.name !== undefined ? ": " : ""}
        <span class="text-syntax-keyword">{String(props.value)}</span>
      </div>
    )
  }

  if (Array.isArray(props.value)) {
    return (
      <details open={props.depth < 2} class="cursor-pointer">
        <summary>
          {indent()}
          {label()}
          {props.name !== undefined ? ": " : ""}
          <span class="text-text-weak">[ {props.value.length} ]</span>
        </summary>
        <For each={props.value}>{(item) => <JsonNode value={item} depth={props.depth + 1} />}</For>
      </details>
    )
  }

  if (typeof props.value === "object") {
    const entries = Object.entries(props.value as Record<string, unknown>)
    return (
      <details open={props.depth < 2} class="cursor-pointer">
        <summary>
          {indent()}
          {label()}
          {props.name !== undefined ? ": " : ""}
          <span class="text-text-weak">{`{ ${entries.length} }`}</span>
        </summary>
        <For each={entries}>
          {([key, value]) => <JsonNode name={key} value={value} depth={props.depth + 1} />}
        </For>
      </details>
    )
  }

  return (
    <div>
      {indent()}
      <span class="text-text-weak">{String(props.value)}</span>
    </div>
  )
}
