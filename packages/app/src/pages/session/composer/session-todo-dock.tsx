import type { Todo } from "@codeplane-ai/sdk/v2"
import { AnimatedNumber } from "@codeplane-ai/ui/animated-number"
import { Checkbox } from "@codeplane-ai/ui/checkbox"
import { DockTray } from "@codeplane-ai/ui/dock-surface"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { useSpring } from "@codeplane-ai/ui/motion-spring"
import { TextReveal } from "@codeplane-ai/ui/text-reveal"
import { TextStrikethrough } from "@codeplane-ai/ui/text-strikethrough"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Index, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { isCancelled, isCompleted, isHighPriority, isInProgress, todoProgress, todoStatus } from "./todo-progress"

const doneToken = "\u0000done\u0000"
const totalToken = "\u0000total\u0000"

function dot(status: Todo["status"]) {
  if (status !== "in_progress") return undefined
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      class="block"
    >
      <circle
        cx="6"
        cy="6"
        r="3"
        style={{
          animation: "var(--animate-pulse-scale)",
          "transform-origin": "center",
          "transform-box": "fill-box",
        }}
      />
    </svg>
  )
}

export function SessionTodoDock(props: {
  sessionID?: string
  todos: Todo[]
  collapseLabel: string
  expandLabel: string
  dockProgress: number
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: false,
    height: 320,
  })

  const toggle = () => setStore("collapsed", (value) => !value)

  const counts = createMemo(() => todoProgress(props.todos))
  const total = createMemo(() => counts().total)
  const done = createMemo(() => counts().done)
  const label = createMemo(() => language.t("session.todo.progress", { done: done(), total: total() }))
  const progress = createMemo(() =>
    language
      .t("session.todo.progress", { done: doneToken, total: totalToken })
      .split(/(\u0000done\u0000|\u0000total\u0000)/),
  )

  const active = createMemo(
    () =>
      props.todos.find((todo) => isInProgress(todo)) ??
      props.todos.find((todo) => todoStatus(todo) === "pending") ??
      props.todos.filter((todo) => isCompleted(todo)).at(-1) ??
      props.todos[0],
  )

  const preview = createMemo(() => active()?.content ?? "")
  const collapse = useSpring(() => (store.collapsed ? 1 : 0), { visualDuration: 0.18, bounce: 0 })
  const dock = createMemo(() => Math.max(0, Math.min(1, props.dockProgress)))
  const shut = createMemo(() => 1 - dock())
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const hide = createMemo(() => Math.max(value(), shut()))
  const off = createMemo(() => hide() > 0.98)
  const turn = createMemo(() => Math.max(0, Math.min(1, value())))
  const full = createMemo(() => Math.max(78, store.height))
  let contentRef: HTMLDivElement | undefined
  let contentFrame: number | undefined

  createEffect(() => {
    const el = contentRef
    if (!el) return
    setStore("height", el.getBoundingClientRect().height)
  })

  onCleanup(() => {
    if (contentFrame === undefined) return
    cancelAnimationFrame(contentFrame)
  })

  createResizeObserver(
    () => contentRef,
    () => {
      const el = contentRef
      if (!el) return
      if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
      contentFrame = requestAnimationFrame(() => {
        contentFrame = undefined
        if (contentRef !== el) return
        setStore("height", el.getBoundingClientRect().height)
      })
    },
  )

  return (
    <DockTray
      data-component="session-todo-dock"
      style={{
        "overflow-x": "visible",
        "overflow-y": "hidden",
        "max-height": `${Math.max(78, full() - value() * (full() - 78))}px`,
      }}
    >
      <div ref={contentRef}>
        <div
          data-action="session-todo-toggle"
          class="pl-3 pr-2 py-2 flex items-center gap-2 overflow-visible"
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            toggle()
          }}
        >
          <span
            class="text-14-regular text-text-strong cursor-default inline-flex items-baseline shrink-0 overflow-visible"
            aria-label={label()}
            style={{
              "--tool-motion-odometer-ms": "220ms",
              "--tool-motion-mask": "18%",
              "--tool-motion-mask-height": "0px",
              "--tool-motion-spring-ms": "560ms",
              "white-space": "pre",
              opacity: `${Math.max(0, Math.min(1, 1 - shut()))}`,
            }}
          >
            <Index each={progress()}>
              {(item) =>
                item() === doneToken ? (
                  <AnimatedNumber value={done()} />
                ) : item() === totalToken ? (
                  <AnimatedNumber value={total()} />
                ) : (
                  <span>{item()}</span>
                )
              }
            </Index>
          </span>
          <div
            data-slot="session-todo-preview"
            class="ml-1 min-w-0 overflow-hidden"
            style={{
              flex: "1 1 auto",
              "max-width": "100%",
            }}
          >
            <TextReveal
              class="text-14-regular text-text-base cursor-default"
              text={store.collapsed ? preview() : undefined}
              duration={600}
              travel={25}
              edge={17}
              spring="cubic-bezier(0.34, 1, 0.64, 1)"
              springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
              growOnly
              truncate
            />
          </div>
          <div class="ml-auto">
            <IconButton
              data-action="session-todo-toggle-button"
              data-collapsed={store.collapsed ? "true" : "false"}
              icon="chevron-down"
              size="normal"
              variant="ghost"
              style={{ transform: `rotate(${turn() * 180}deg)` }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                toggle()
              }}
              aria-label={store.collapsed ? props.expandLabel : props.collapseLabel}
            />
          </div>
        </div>

        <div
          data-slot="session-todo-list"
          aria-hidden={store.collapsed || off()}
          classList={{
            "pointer-events-none": hide() > 0.1,
          }}
          style={{
            visibility: off() ? "hidden" : "visible",
            opacity: `${Math.max(0, Math.min(1, 1 - hide()))}`,
          }}
        >
          <TodoList todos={props.todos} />
        </div>
      </div>
    </DockTray>
  )
}

function TodoList(props: { todos: Todo[] }) {
  const [store, setStore] = createStore({
    stuck: false,
  })

  return (
    <div class="relative">
      <div
        role="list"
        class="px-3 pb-11 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar"
        style={{ "overflow-anchor": "none" }}
        onScroll={(e) => {
          setStore("stuck", e.currentTarget.scrollTop > 0)
        }}
      >
        <Index each={props.todos}>
          {(todo) => {
            const status = createMemo(() => todoStatus(todo()))
            const struck = createMemo(() => status() === "completed" || status() === "cancelled")
            const flagged = createMemo(() => isHighPriority(todo()) && status() !== "completed" && status() !== "cancelled")
            return (
              <Checkbox
                role="listitem"
                readOnly
                checked={status() === "completed"}
                indeterminate={status() === "in_progress"}
                data-in-progress={status() === "in_progress" ? "" : undefined}
                data-state={status()}
                data-priority={todo().priority}
                icon={dot(status())}
                style={{
                  "--checkbox-align": "flex-start",
                  "--checkbox-offset": "1px",
                  transition: "opacity 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                  opacity: status() === "pending" ? "0.94" : "1",
                }}
              >
                <span class="flex items-baseline gap-1.5 min-w-0">
                  <TextStrikethrough
                    active={struck()}
                    text={todo().content}
                    class="text-14-regular min-w-0 break-words"
                    style={{
                      flex: "1 1 auto",
                      "line-height": "var(--line-height-normal)",
                      transition:
                        "color 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)), opacity 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                      color: struck() ? "var(--text-weak)" : "var(--text-strong)",
                      opacity: status() === "pending" ? "0.92" : "1",
                    }}
                  />
                  <Show when={flagged()}>
                    <span
                      aria-hidden="true"
                      class="shrink-0 self-center rounded-full"
                      title="High priority"
                      style={{
                        width: "5px",
                        height: "5px",
                        "margin-top": "1px",
                        background: "var(--accent)",
                      }}
                    />
                  </Show>
                </span>
              </Checkbox>
            )
          }}
        </Index>
      </div>
      <div
        class="pointer-events-none absolute top-0 left-0 right-0 h-4 transition-opacity duration-150"
        style={{
          background: "linear-gradient(to bottom, var(--background-base), transparent)",
          opacity: store.stuck ? 1 : 0,
        }}
      />
    </div>
  )
}
