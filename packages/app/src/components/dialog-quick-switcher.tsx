import type { Session } from "@codeplane-ai/sdk/v2/client"
import { base64Encode } from "@codeplane-ai/shared/util/encode"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Icon, type IconProps } from "@codeplane-ai/ui/icon"
import { TextField } from "@codeplane-ai/ui/text-field"
import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { displayName, sortedRootSessions } from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"

type SessionEntry = {
  kind: "session"
  id: string
  directory: string
  title: string
  subtitle: string
  updated: number
}

type ProjectEntry = {
  kind: "project"
  worktree: string
  title: string
  subtitle: string
  current: boolean
}

type ActionEntry = {
  kind: "action"
  id: "project.browse" | "server.switch"
  icon: IconProps["name"]
  title: string
  subtitle: string
}

type Entry = SessionEntry | ProjectEntry | ActionEntry

interface Props {
  currentDirectory?: string
  onChooseProject(): void
  onSwitchServer(): void
}

export function DialogQuickSwitcher(props: Props) {
  const dialog = useDialog()
  const navigate = useNavigate()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const platform = usePlatform()
  const server = useServer()

  const [search, setSearch] = createSignal("")
  const [activeIndex, setActiveIndex] = createSignal(0)

  const currentDir = createMemo(() => props.currentDirectory ?? "")

  const sessionEntries = createMemo<SessionEntry[]>(() => {
    const dir = currentDir()
    if (!dir) return []
    const [child] = globalSync.child(dir, { bootstrap: true })
    const list = sortedRootSessions(child, Date.now(), dir)
    return list
      .filter((session: Session) => !session.time?.archived)
      .slice(0, 30)
      .map<SessionEntry>((session: Session) => ({
        kind: "session",
        id: session.id,
        directory: dir,
        title: sessionTitle(session.title) ?? language.t("command.session.new"),
        subtitle: session.id,
        updated: session.time?.updated ?? session.time?.created ?? 0,
      }))
  })

  const projectEntries = createMemo<ProjectEntry[]>(() => {
    const dir = currentDir()
    return layout.projects
      .list()
      .filter((project) => project.id !== "global")
      .map<ProjectEntry>((project) => ({
        kind: "project",
        worktree: project.worktree,
        title: displayName(project),
        subtitle: project.worktree,
        current: project.worktree === dir,
      }))
  })

  const actionEntries = createMemo<ActionEntry[]>(() => {
    const items: ActionEntry[] = [
      {
        kind: "action",
        id: "project.browse",
        icon: "folder-add-left",
        title: language.t("command.project.open"),
        subtitle: language.t("quickSwitcher.action.browseProject"),
      },
    ]
    if (platform.desktop) {
      items.push({
        kind: "action",
        id: "server.switch",
        icon: "server",
        title: language.t("command.server.switch"),
        subtitle: server.name ?? language.t("quickSwitcher.action.switchServer"),
      })
    }
    return items
  })

  const filter = (entries: Entry[]) => {
    const query = search().trim().toLowerCase()
    if (!query) return entries
    return entries.filter((entry) => {
      const haystack = `${entry.title} ${entry.subtitle}`.toLowerCase()
      return haystack.includes(query)
    })
  }

  const sections = createMemo(() => {
    const result: { id: string; title: string; entries: Entry[] }[] = []
    const sessions = filter(sessionEntries())
    if (sessions.length > 0) {
      result.push({
        id: "sessions",
        title: language.t("quickSwitcher.section.sessions"),
        entries: sessions,
      })
    }
    const projects = filter(projectEntries())
    if (projects.length > 0) {
      result.push({
        id: "projects",
        title: language.t("quickSwitcher.section.projects"),
        entries: projects,
      })
    }
    const actions = filter(actionEntries())
    if (actions.length > 0) {
      result.push({
        id: "actions",
        title: language.t("quickSwitcher.section.actions"),
        entries: actions,
      })
    }
    return result
  })

  const flat = createMemo<Entry[]>(() => sections().flatMap((section) => section.entries))

  const select = (entry: Entry) => {
    if (entry.kind === "session") {
      navigate(`/${base64Encode(entry.directory)}/session/${entry.id}`)
      dialog.close()
      return
    }
    if (entry.kind === "project") {
      navigate(`/${base64Encode(entry.worktree)}/session`)
      dialog.close()
      return
    }
    if (entry.id === "project.browse") {
      dialog.close()
      props.onChooseProject()
      return
    }
    if (entry.id === "server.switch") {
      dialog.close()
      props.onSwitchServer()
      return
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const items = flat()
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (items.length === 0) return
      setActiveIndex((index) => (index + 1) % items.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (items.length === 0) return
      setActiveIndex((index) => (index - 1 + items.length) % items.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const entry = items[activeIndex()] ?? items[0]
      if (entry) select(entry)
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      dialog.close()
    }
  }

  const indexOf = (entry: Entry) => flat().indexOf(entry)

  onMount(() => {
    const items = flat()
    const dir = currentDir()
    const initial = items.findIndex(
      (entry) => entry.kind === "project" && entry.current,
    )
    if (initial >= 0) setActiveIndex(initial)
    else if (items.length > 0 && dir && items[0]?.kind === "session") setActiveIndex(0)
  })

  const iconFor = (entry: Entry): IconProps["name"] => {
    if (entry.kind === "session") return "comment"
    if (entry.kind === "project") return "folder"
    return entry.icon
  }

  return (
    <Dialog title={language.t("quickSwitcher.title")} size="normal">
      <div class="flex h-full min-h-0 flex-col gap-3 px-4 pb-4" onKeyDown={onKeyDown}>
        <div class="shrink-0 [&_[data-slot=input-wrapper]:focus-within]:!border-border-weak-base [&_[data-slot=input-wrapper]:focus-within]:!shadow-none">
          <TextField
            value={search()}
            onChange={(value) => {
              setSearch(value)
              setActiveIndex(0)
            }}
            placeholder={language.t("quickSwitcher.search.placeholder")}
            label={language.t("quickSwitcher.search.label")}
            hideLabel
            autofocus
          />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          <Switch>
            <Match when={flat().length === 0}>
              <div class="flex h-full items-center justify-center px-8 text-center text-14-regular text-text-weak">
                {language.t("quickSwitcher.empty")}
              </div>
            </Match>
            <Match when={true}>
              <div class="flex flex-col gap-4">
                <For each={sections()}>
                  {(section) => (
                    <div class="flex flex-col gap-1">
                      <div class="px-2 text-11-medium uppercase tracking-wider text-text-weak">{section.title}</div>
                      <For each={section.entries}>
                        {(entry) => {
                          const isActive = createMemo(() => indexOf(entry) === activeIndex())
                          return (
                            <button
                              type="button"
                              class="group flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left focus:outline-none"
                              classList={{
                                "bg-surface-raised-base-hover": isActive(),
                                "hover:bg-surface-raised-base-hover": !isActive(),
                              }}
                              onMouseEnter={() => setActiveIndex(indexOf(entry))}
                              onClick={() => select(entry)}
                            >
                              <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-base text-icon-weak">
                                <Icon name={iconFor(entry)} size="small" />
                              </div>
                              <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2">
                                  <span class="truncate text-14-medium text-text-strong">{entry.title}</span>
                                  <Show when={entry.kind === "project" && entry.current}>
                                    <span class="shrink-0 rounded-sm bg-surface-base px-1 py-0.5 text-10-medium text-text-weak">
                                      {language.t("quickSwitcher.label.current")}
                                    </span>
                                  </Show>
                                </div>
                                <div class="truncate text-12-regular text-text-weak">{entry.subtitle}</div>
                              </div>
                              <Show when={isActive()}>
                                <div class="shrink-0 text-12-medium text-text-weak">
                                  {language.t("quickSwitcher.hint.enter")}
                                </div>
                              </Show>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  )
}
