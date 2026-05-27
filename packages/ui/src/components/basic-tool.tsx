import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { animate, type AnimationPlaybackControls } from "motion"
import { describeGenericToolDisplay } from "@codeplane-ai/shared/tool-display"
import { useI18n } from "../context/i18n"
import { createStore } from "solid-js/store"
import { Collapsible } from "./collapsible"
import type { IconProps } from "./icon"
import { Markdown } from "./markdown"
import { TextShimmer } from "./text-shimmer"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return (
    typeof val === "object" && val !== null && "title" in val && (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  status?: string
  startTime?: number
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  animated?: boolean
  /** When true, do NOT auto-open the body while the tool is pending/running.
      The collapsed trigger keeps showing the shimmering title + elapsed label
      so the user knows it's running, and the body only expands on click. */
  collapseWhilePending?: boolean
  onSubtitleClick?: () => void
  onTriggerClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>
  triggerHref?: string
  clickable?: boolean
}

const SPRING = { type: "spring" as const, visualDuration: 0.2, bounce: 0 }

function formatToolElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

export function BasicTool(props: BasicToolProps) {
  const initiallyPending = props.status === "pending" || props.status === "running"
  const collapseWhilePending = !!props.collapseWhilePending
  const initialOpenState = props.defaultOpen ?? (collapseWhilePending ? false : initiallyPending)
  const [state, setState] = createStore({
    open: initialOpenState,
    ready: initialOpenState,
    autoOpened: initiallyPending && !collapseWhilePending,
  })
  const open = () => state.open
  const ready = () => state.ready
  const pending = () => props.status === "pending" || props.status === "running"

  createEffect(() => {
    if (collapseWhilePending) return
    if (pending()) {
      if (!state.open) {
        setState({ open: true, autoOpened: true })
      } else if (!state.autoOpened) {
        setState("autoOpened", true)
      }
      return
    }
    if (state.autoOpened && !props.defaultOpen) {
      setState({ open: false, autoOpened: false })
    }
  })

  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!pending()) return
    if (typeof props.startTime !== "number") return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(id))
  })

  const elapsedSeconds = createMemo(() => {
    if (!pending()) return 0
    if (typeof props.startTime !== "number") return 0
    return Math.max(0, Math.floor((now() - props.startTime) / 1000))
  })

  const elapsedLabel = createMemo(() => {
    const seconds = elapsedSeconds()
    if (seconds < 5) return ""
    return formatToolElapsed(seconds)
  })

  const longRunning = createMemo(() => elapsedSeconds() >= 30)

  let frame: number | undefined

  const cancel = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }

  onCleanup(cancel)

  createEffect(() => {
    if (props.forceOpen) setState("open", true)
  })

  createEffect(
    on(
      open,
      (value) => {
        if (!props.defer) return
        if (!value) {
          cancel()
          setState("ready", false)
          return
        }

        cancel()
        frame = requestAnimationFrame(() => {
          frame = undefined
          if (!open()) return
          setState("ready", true)
        })
      },
      { defer: true },
    ),
  )

  // Animated height for collapsible open/close
  let contentRef: HTMLDivElement | undefined
  let heightAnim: AnimationPlaybackControls | undefined

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.animated || !contentRef) return
        heightAnim?.stop()
        if (isOpen) {
          // Set overflow: visible at the START of the expand animation,
          // not on .finished. The body inside often has its own border /
          // box-shadow that paints from edge to edge — with overflow:
          // hidden during the spring animation (~200 ms), those edges
          // get clipped against the wrapper bounds and the border looks
          // like it "doesn't load" until you click twice. The user
          // reported this as the "border doesn't load on first
          // collapse/expand" bug. The spring animation already keeps
          // the wrapper height ≤ the body height while expanding, so
          // setting overflow visible only causes a single frame of
          // potential layout shift at the bottom, far less noticeable
          // than the missing border.
          contentRef.style.overflow = "visible"
          heightAnim = animate(contentRef, { height: "auto" }, SPRING)
          void heightAnim.finished.then(() => {
            if (!contentRef || !open()) return
            contentRef.style.height = "auto"
          })
        } else {
          // Closing still hides overflow so the body's content doesn't
          // spill out under the collapsing wrapper.
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "0px" }, SPRING)
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    heightAnim?.stop()
  })

  const handleOpenChange = (value: boolean) => {
    if (pending()) return
    if (props.locked && !value) return
    setState("open", value)
  }

  const trigger = () => (
    <div
      data-component="tool-trigger"
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
      data-pending={pending() ? "true" : undefined}
      data-long-running={longRunning() ? "true" : undefined}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
          <Switch>
            <Match when={isTriggerTitle(props.trigger) && props.trigger}>
              {(title) => (
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span
                      data-slot="basic-tool-tool-title"
                      classList={{
                        [title().titleClass ?? ""]: !!title().titleClass,
                      }}
                    >
                      <TextShimmer text={title().title} active={pending()} />
                    </span>
                    <Show when={pending() ? elapsedLabel() : undefined} keyed>
                      {(label) => (
                        <span data-slot="basic-tool-tool-elapsed" aria-live="polite">
                          {label}
                        </span>
                      )}
                    </Show>
                    <Show when={title().subtitle} keyed>
                      {(subtitle) => (
                        <span
                          data-slot="basic-tool-tool-subtitle"
                          classList={{
                            [title().subtitleClass ?? ""]: !!title().subtitleClass,
                            clickable: !!props.onSubtitleClick,
                          }}
                          onClick={(e) => {
                            if (props.onSubtitleClick) {
                              e.stopPropagation()
                              props.onSubtitleClick()
                            }
                          }}
                        >
                          {subtitle}
                        </span>
                      )}
                    </Show>
                    <Show when={title().args} keyed>
                      {(argsList) => (
                        <Show when={argsList.length > 0}>
                          <For each={argsList}>
                            {(arg) => (
                              <span
                                data-slot="basic-tool-tool-arg"
                                classList={{
                                  [title().argsClass ?? ""]: !!title().argsClass,
                                }}
                              >
                                {arg}
                              </span>
                            )}
                          </For>
                        </Show>
                      )}
                    </Show>
                  </div>
                  <Show when={!pending() ? title().action : undefined} keyed>
                    {(action) => <span data-slot="basic-tool-tool-action">{action}</span>}
                  </Show>
                </div>
              )}
            </Match>
            <Match when={true}>{props.trigger as JSX.Element}</Match>
          </Switch>
        </div>
      </div>
      <Show when={props.children && !props.hideDetails && !props.locked && (!pending() || collapseWhilePending)}>
        <Collapsible.Arrow />
      </Show>
    </div>
  )

  return (
    <Collapsible
      open={open()}
      onOpenChange={handleOpenChange}
      class="tool-collapsible"
      data-tool={props.icon}
    >
      <Show
        when={props.triggerHref}
        keyed
        fallback={
          <Collapsible.Trigger
            data-hide-details={props.hideDetails ? "true" : undefined}
            onClick={props.onTriggerClick}
          >
            {trigger()}
          </Collapsible.Trigger>
        }
      >
        {(href) => (
          <Collapsible.Trigger
            as="a"
            href={href}
            data-hide-details={props.hideDetails ? "true" : undefined}
            onClick={props.onTriggerClick}
          >
            {trigger()}
          </Collapsible.Trigger>
        )}
      </Show>
      <Show when={props.animated && props.children && !props.hideDetails}>
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-animated
          // Drive these from the live `open()` accessor so SolidJS tracks
          // them — without the accessor inside the style object, the
          // initial render froze `overflow: hidden` and the border was
          // clipped by the wrapper until the spring `.finished` microtask
          // fired (~200 ms later). On expand we want overflow: visible
          // immediately so the body's border paints with the rest of the
          // content. The createEffect above still owns the height
          // animation via `animate(...)` — these inline styles are only
          // the at-rest values for the open/closed states.
          style={{
            height: open() ? "auto" : "0px",
            overflow: open() ? "visible" : "hidden",
          }}
        >
          {props.children}
        </div>
      </Show>
      <Show when={!props.animated && props.children && !props.hideDetails}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name"]
  return keys.map((key) => input?.[key]).find((value): value is string => typeof value === "string" && value.length > 0)
}

export function GenericTool(props: {
  tool: string
  status?: string
  startTime?: number
  hideDetails?: boolean
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
  defaultOpen?: boolean
}) {
  const i18n = useI18n()
  const display = createMemo(() =>
    describeGenericToolDisplay({
      tool: props.tool,
      args: props.input,
      metadata: props.metadata,
      resolveKnownName: (tool) => {
        const key = `ui.tool.${tool}`
        const translated = i18n.t(key)
        return translated !== key ? translated : undefined
      },
    }),
  )

  return (
    <BasicTool
      icon={display().isMcp ? "server" : "mcp"}
      status={props.status}
      startTime={props.startTime}
      animated
      trigger={{
        title: display().title,
        subtitle: display().subtitle ?? label(props.input),
      }}
      hideDetails={props.hideDetails}
      defaultOpen={props.defaultOpen}
    >
      <Show when={props.output}>
        <div data-component="tool-output" data-scrollable>
          <Markdown text={props.output!} />
        </div>
      </Show>
    </BasicTool>
  )
}
