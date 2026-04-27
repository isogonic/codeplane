import type { Session } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, For, Match, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { sessionTitle } from "@/utils/session-title"
import { getRelativeTime } from "@/utils/time"
import { errorMessage } from "@/pages/layout/helpers"

type ArchiveWorkspace = {
  directory: string
  label: string
  kind: "local" | "sandbox"
}

type ArchiveScope = "all" | "local" | "sandbox"
type ArchiveAge = "all" | "recent" | "older"
type ArchivedSession = {
  session: Session
  workspace: ArchiveWorkspace
}

const RECENT_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000

const key = (item: ArchivedSession) => `${item.workspace.directory}:${item.session.id}`

const sessionSearchText = (item: ArchivedSession) =>
  [item.session.title, item.session.id, item.workspace.label, item.workspace.directory].join(" ").toLowerCase()

const archivedAt = (session: Session) => session.time.archived ?? 0

const byArchivedAt = (a: ArchivedSession, b: ArchivedSession) => {
  const diff = archivedAt(b.session) - archivedAt(a.session)
  if (diff !== 0) return diff
  return b.session.id.localeCompare(a.session.id)
}

export function DialogArchivedSessions(props: { workspaces: ArchiveWorkspace[] }) {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const request = { token: 0 }
  const [state, setState] = createStore({
    search: "",
    scope: "all" as ArchiveScope,
    age: "all" as ArchiveAge,
    loading: true,
    error: false,
    sessions: [] as ArchivedSession[],
    restoring: {} as Record<string, boolean>,
  })

  const scopeOptions = createMemo(() =>
    [
      { value: "all" as const, label: language.t("archiveSessions.filter.scope.all") },
      props.workspaces.some((workspace) => workspace.kind === "local")
        ? { value: "local" as const, label: language.t("workspace.type.local") }
        : undefined,
      props.workspaces.some((workspace) => workspace.kind === "sandbox")
        ? { value: "sandbox" as const, label: language.t("workspace.type.sandbox") }
        : undefined,
    ].filter((option): option is { value: ArchiveScope; label: string } => !!option),
  )
  const ageOptions = createMemo(() => [
    { value: "all" as const, label: language.t("archiveSessions.filter.age.all") },
    { value: "recent" as const, label: language.t("archiveSessions.filter.age.recent") },
    { value: "older" as const, label: language.t("archiveSessions.filter.age.older") },
  ])

  const refresh = () => {
    request.token += 1
    const token = request.token
    setState({ loading: true, error: false })

    void Promise.all(
      props.workspaces.map((workspace) =>
        globalSDK.client.session
          .list({ directory: workspace.directory, roots: true, archived: true, limit: 500 })
          .then((result) => ({
            failed: false,
            items: (result.data ?? [])
              .filter((session): session is Session => !!session?.id && !!session.time?.archived)
              .map((session) => ({ session, workspace })),
          }))
          .catch(() => ({ failed: true, items: [] as ArchivedSession[] })),
      ),
    ).then((results) => {
      if (request.token !== token) return
      setState({
        loading: false,
        error: results.some((result) => result.failed),
        sessions: results.flatMap((result) => result.items).sort(byArchivedAt),
      })
    })
  }

  const visible = createMemo(() => {
    const query = state.search.trim().toLowerCase()
    const cutoff = Date.now() - RECENT_ARCHIVE_MS
    return state.sessions
      .filter((item) => state.scope === "all" || item.workspace.kind === state.scope)
      .filter((item) => {
        if (state.age === "all") return true
        if (state.age === "recent") return archivedAt(item.session) >= cutoff
        return archivedAt(item.session) < cutoff
      })
      .filter((item) => !query || sessionSearchText(item).includes(query))
  })

  const insertRestoredSession = (session: Session) => {
    const [store, setStore] = globalSync.child(session.directory, { bootstrap: false })
    const exists = store.session.some((item) => item.id === session.id)
    if (exists) return
    setStore("session", (sessions) => [...sessions, session].sort((a, b) => a.id.localeCompare(b.id)))
    if (!session.parentID) setStore("sessionTotal", (value) => value + 1)
  }

  const restore = (item: ArchivedSession) => {
    const itemKey = key(item)
    setState("restoring", itemKey, true)
    void globalSDK.client.session
      .update({
        directory: item.workspace.directory,
        sessionID: item.session.id,
        time: { archived: null },
      })
      .then((result) => {
        if (result.data) insertRestoredSession(result.data)
        setState("sessions", (sessions) => sessions.filter((session) => key(session) !== itemKey))
        showToast({
          title: language.t("archiveSessions.restore.success.title"),
          description: language.t("archiveSessions.restore.success.description"),
        })
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("archiveSessions.restore.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
      .finally(() => setState("restoring", itemKey, false))
  }

  onMount(refresh)

  return (
    <Dialog title={language.t("archiveSessions.title")} size="large">
      <div class="flex h-full min-h-0 flex-col gap-3 px-4 pb-4">
        <div class="flex shrink-0 flex-col gap-2">
          <div class="flex items-center gap-2">
            <TextField
              value={state.search}
              onChange={(value) => setState("search", value)}
              placeholder={language.t("archiveSessions.search.placeholder")}
              label={language.t("archiveSessions.search.label")}
              hideLabel
              autofocus
            />
            <Tooltip value={language.t("common.refresh")} placement="top">
              <IconButton
                icon="reset"
                variant="ghost"
                class="size-8 rounded-md shrink-0"
                aria-label={language.t("common.refresh")}
                disabled={state.loading}
                onClick={refresh}
              />
            </Tooltip>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={scopeOptions().length > 1}>
              <RadioGroup
                size="small"
                options={scopeOptions()}
                current={scopeOptions().find((option) => option.value === state.scope)}
                value={(option) => option.value}
                label={(option) => option.label}
                onSelect={(option) => {
                  if (option) setState("scope", option.value)
                }}
              />
            </Show>
            <RadioGroup
              size="small"
              options={ageOptions()}
              current={ageOptions().find((option) => option.value === state.age)}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => {
                if (option) setState("age", option.value)
              }}
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          <Switch>
            <Match when={state.loading}>
              <div class="flex h-full items-center justify-center text-text-weak">
                <Spinner class="size-4" />
              </div>
            </Match>
            <Match when={visible().length === 0}>
              <div class="flex h-full items-center justify-center px-8 text-center text-14-regular text-text-weak">
                {state.error ? language.t("archiveSessions.error") : language.t("archiveSessions.empty")}
              </div>
            </Match>
            <Match when={true}>
              <div class="flex flex-col gap-1">
                <For each={visible()}>
                  {(item) => {
                    const itemKey = createMemo(() => key(item))
                    const title = createMemo(() => sessionTitle(item.session.title))
                    return (
                      <div class="group flex min-w-0 items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-raised-base-hover">
                        <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-base text-icon-weak">
                          <Icon name="archive" size="small" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-14-medium text-text-strong">{title()}</div>
                          <div class="flex min-w-0 items-center gap-2 text-12-regular text-text-weak">
                            <span class="truncate">{item.workspace.label}</span>
                            <span class="shrink-0">-</span>
                            <span class="shrink-0">
                              {language.t("archiveSessions.archivedAt", {
                                time: getRelativeTime(new Date(archivedAt(item.session)).toISOString(), language.t),
                              })}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="small"
                          icon={state.restoring[itemKey()] ? undefined : "arrow-undo-down"}
                          disabled={state.restoring[itemKey()]}
                          onClick={() => restore(item)}
                        >
                          <Show when={state.restoring[itemKey()]} fallback={language.t("common.restore")}>
                            <Spinner class="size-3" />
                          </Show>
                        </Button>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  )
}
