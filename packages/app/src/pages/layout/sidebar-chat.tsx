/**
 * ChatSidebarPanel — sessions sidebar that lives inside the layout's
 * sidebar-panel slot, so it inherits the native collapse/expand animation
 * (driven by `layout.sidebar.opened()` and the global toggle in the
 * titlebar) and the same border / panel chrome as the project sidebar.
 *
 * Reads chat data from `ChatProvider` so the chat page can mutate sessions
 * (create on first send, update title, etc.) and this panel re-renders.
 */
import { For, Show, createMemo, type Accessor } from "solid-js"
import { useNavigate, useLocation, useParams } from "@solidjs/router"
import { Button } from "@codeplane-ai/ui/button"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Tooltip } from "@codeplane-ai/ui/tooltip"
import { useChat, type ChatSession } from "@/context/chat"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"

export function ChatSidebarPanel(props: {
  mobile?: boolean
  width?: Accessor<number>
}) {
  const language = useLanguage()
  const layout = useLayout()
  const chat = useChat()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()

  const merged = createMemo(() => props.mobile || layout.sidebar.opened())
  const hover = createMemo(() => !props.mobile && !layout.sidebar.opened())

  const activeID = createMemo(() => params.id)
  const sessions = createMemo(() => chat.sortedSessions())

  const goNew = () => {
    navigate("/chat")
    layout.mobileSidebar.hide()
  }

  const goSession = (id: string) => {
    navigate(`/chat/${id}`)
    layout.mobileSidebar.hide()
  }

  const renameSession = (session: ChatSession) => {
    const value = window.prompt(language.t("chat.session.renamePrompt"), session.title)
    if (value === null) return
    chat.updateSession(session.id, (s) => {
      s.title = value.trim() || language.t("chat.session.untitled")
    })
  }

  const deleteSession = (id: string) => {
    if (!window.confirm(language.t("chat.session.deleteConfirm"))) return
    chat.deleteSession(id)
    if (activeID() === id) {
      const remaining = chat.sortedSessions()
      const next = remaining.find((s) => s.id !== id)
      navigate(next ? `/chat/${next.id}` : "/chat", { replace: true })
    }
  }

  return (
    <div
      data-component="chat-sidebar-panel"
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
        "border border-b-0 border-border-weak-base": !merged(),
        "border-l border-t border-border-weaker-base": merged(),
        "bg-background-base": merged() || hover(),
        "bg-background-stronger": !merged() && !hover(),
        "flex-1 min-w-0": props.mobile,
        "max-w-full overflow-hidden": props.mobile,
      }}
      style={{
        width: props.mobile ? undefined : props.width ? `${props.width()}px` : undefined,
      }}
    >
      {/* Header — matches the project sidebar's title row. */}
      <div class="shrink-0 h-12 flex items-center justify-between gap-2 -mx-1">
        <span class="text-12-medium text-text-base uppercase tracking-wider px-2">
          {language.t("chat.sessions.title")}
        </span>
        <Tooltip placement="bottom" value={language.t("chat.session.new")}>
          <Button
            variant="ghost"
            class="titlebar-icon w-8 h-6 p-0 box-border"
            onClick={goNew}
            aria-label={language.t("chat.session.new")}
            aria-current={location.pathname === "/chat" && !activeID() ? "page" : undefined}
          >
            <Icon size="small" name="new-session" class="text-icon-weak" />
          </Button>
        </Tooltip>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        <Show
          when={sessions().length > 0}
          fallback={
            <div class="px-3 py-8 flex flex-col items-center text-center gap-2">
              <Icon name="speech-bubble" size="small" class="text-icon-weak" />
              <p class="text-12-regular text-text-weak max-w-[200px] leading-relaxed">
                {language.t("chat.sessions.empty")}
              </p>
            </div>
          }
        >
          <ul class="flex flex-col gap-0.5">
            <For each={sessions()}>
              {(session) => {
                const selected = () => activeID() === session.id
                return (
                  <li>
                    <div
                      class="group/session w-full min-w-0 rounded-md cursor-default transition-colors flex items-center"
                      classList={{
                        // Selected: a clearly grey background that survives
                        // hovering off (so the user always knows which chat
                        // they're in).
                        "bg-surface-raised-base shadow-[inset_0_0_0_1px_var(--border-weak-base)]":
                          selected(),
                        "hover:bg-surface-raised-base-hover": !selected(),
                      }}
                    >
                      <button
                        type="button"
                        class="flex items-center gap-2 min-w-0 flex-1 px-2 py-1.5 text-left focus:outline-none"
                        onClick={() => goSession(session.id)}
                      >
                        <div
                          class="shrink-0 size-5 flex items-center justify-center"
                          aria-hidden="true"
                        >
                          <Show
                            when={
                              !!session.backendID || (session.messages?.length ?? 0) > 0
                            }
                            fallback={<div class="size-1.5" />}
                          >
                            <div
                              class="size-1.5 rounded-full"
                              classList={{
                                "bg-text-interactive-base": selected(),
                                "bg-icon-weak": !selected(),
                              }}
                            />
                          </Show>
                        </div>
                        <div class="min-w-0 flex-1">
                          <div
                            class="text-13-medium truncate"
                            classList={{
                              "text-text-strong": selected(),
                              "text-text-base": !selected(),
                            }}
                          >
                            {session.title}
                          </div>
                        </div>
                      </button>
                      {/* Actions — flex items, not absolute, so they don't
                          overlap the title. Smoothly grow on hover. */}
                      <div class="shrink-0 overflow-hidden flex items-center gap-0.5 transition-[width] duration-100 w-0 group-hover/session:w-[52px] group-focus-within/session:w-[52px] pr-1">
                        <Tooltip placement="top" value={language.t("chat.session.rename")}>
                          <IconButton
                            icon="pencil-line"
                            variant="ghost"
                            class="size-6 rounded-md"
                            aria-label={language.t("chat.session.rename")}
                            onClick={(event) => {
                              event.stopPropagation()
                              renameSession(session)
                            }}
                          />
                        </Tooltip>
                        <Tooltip placement="top" value={language.t("chat.session.delete")}>
                          <IconButton
                            icon="archive"
                            variant="ghost"
                            class="size-6 rounded-md"
                            aria-label={language.t("chat.session.delete")}
                            onClick={(event) => {
                              event.stopPropagation()
                              deleteSession(session.id)
                            }}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}
