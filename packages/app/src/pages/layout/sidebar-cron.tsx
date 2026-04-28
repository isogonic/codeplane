import { A, useLocation } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, For, Match, Show, Switch as SolidSwitch, type Accessor, type JSX } from "solid-js"
import { base64Encode } from "@codeplane-ai/shared/util/encode"
import { Icon } from "@codeplane-ai/ui/icon"
import { Spinner } from "@codeplane-ai/ui/spinner"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { CronClient, type CronRun, type CronRunStatus, type CronTask } from "@/utils/cron-client"
import { decode64 } from "@/utils/base64"
import { cronSidebarEntries } from "./sidebar-cron-helpers"
import {
  cronProjectDirectories,
  cronProjectForDirectory,
  cronProjectIDForRoute,
  cronTaskInScope,
  type CronProjectScope,
} from "../cron-scope"

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export const CronSidebarPanel = (props: {
  mobile?: boolean
  merged?: boolean
  projectID?: Accessor<string | undefined>
  projectWorktree?: Accessor<string | undefined>
}): JSX.Element => {
  const language = useLanguage()
  const location = useLocation()
  const server = useServer()
  const globalSync = useGlobalSync()
  const httpServer = createMemo(() => server.current?.http)
  const onTasksPage = createMemo(
    () => location.pathname === "/cron" || location.pathname.startsWith("/cron/"),
  )
  const queryProjectID = createMemo(() => new URLSearchParams(location.search).get("projectID") ?? undefined)

  // Resolve only the project explicitly carried by this route/session.
  // Falling back to another project would show the wrong scheduled tasks.
  const resolvedProject = createMemo(() => {
    const fromProp = props.projectID?.()
    const all = (globalSync.data.project ?? []).filter((p) => p.id !== "global")
    if (fromProp) {
      const found = all.find((p) => p.id === fromProp)
      if (found)
        return {
          id: found.id,
          worktree: props.projectWorktree?.() ?? found.worktree,
          sandboxes: found.sandboxes,
        }
      return {
        id: fromProp,
        worktree: props.projectWorktree?.(),
      }
    }
    const worktreeMatch = location.pathname.match(/^\/cron\/worktree\/([^/?#]+)/)
    if (worktreeMatch) {
      const dir = decode64(worktreeMatch[1])
      return cronProjectForDirectory(dir, all, queryProjectID())
    }
    const match = location.pathname.match(/^\/cron\/([^/?#]+)/)
    if (match) {
      const pid = queryProjectID() ?? decodeURIComponent(match[1])
      const found = all.find((p) => p.id === pid)
      if (found) return { id: found.id, worktree: found.worktree, sandboxes: found.sandboxes }
    }
    const sessionMatch = location.pathname.match(/^\/([^/]+)\/session\//)
    if (sessionMatch) {
      const dir = decode64(sessionMatch[1])
      return cronProjectForDirectory(dir, all, queryProjectID())
    }
  }) as () => CronProjectScope | { id?: string; worktree?: string; sandboxes?: string[] } | undefined

  const projectID = createMemo(() => cronProjectIDForRoute(resolvedProject() as CronProjectScope | undefined, queryProjectID()))
  const projectWorktree = createMemo(() => resolvedProject()?.worktree)
  const projectDirectories = createMemo(() => cronProjectDirectories(resolvedProject() as CronProjectScope | undefined))
  const projectSessions = createMemo(() => {
    return projectDirectories().flatMap((dir) => {
      const [store] = globalSync.child(dir, { bootstrap: false })
      return store.session
    })
  })

  createEffect(() => {
    projectDirectories().forEach((dir) => void globalSync.project.loadSessions(dir))
  })

  const tasksQuery = useQuery(() => ({
    queryKey: ["cron", "sidebar-panel-tasks", server.scope.key, projectID(), projectWorktree()],
    queryFn: async () => {
      const conn = httpServer()
      const pid = projectID()
      const dir = projectWorktree()
      if (!conn || (!pid && !dir)) return [] as CronTask[]
      if (pid) return CronClient.list(conn, { projectID: pid })
      return CronClient.list(conn, { directory: dir })
    },
    enabled: !!httpServer() && (!!projectID() || !!projectWorktree()),
    refetchInterval: 5_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  }))
  const tasks = createMemo(() =>
    (tasksQuery.data ?? []).filter((task) =>
      cronTaskInScope(task, {
        projectID: projectID(),
        project: resolvedProject() as CronProjectScope | undefined,
        directory: projectWorktree(),
      }),
    ),
  )

  const runsQuery = useQuery(() => ({
    queryKey: [
      "cron",
      "sidebar-panel-runs",
      server.scope.key,
      projectID(),
      tasks().map((t) => t.id).join(","),
    ],
    queryFn: async () => {
      const conn = httpServer()
      if (!conn)
        return [] as Array<CronRun & { taskName: string; taskDirectory: string }>
      const lists = await Promise.all(
        tasks().map(async (t) => {
          const runs = await CronClient.listRuns(conn, t.id, 100).catch(() => [] as CronRun[])
          return runs.map((r) => ({
            ...r,
            taskName: t.name,
            taskDirectory: t.directory || projectWorktree() || "",
          }))
        }),
      )
      return lists.flat().sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
    },
    enabled: !!httpServer() && (!!projectID() || !!projectWorktree()) && !tasksQuery.isLoading,
    refetchInterval: 3_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  }))

  const runs = createMemo(() =>
    cronSidebarEntries({
      runs: runsQuery.data ?? [],
      sessions: projectSessions(),
      directories: projectDirectories(),
      limit: 200,
    }),
  )

  const tasksHref = createMemo(() => {
    const pid = projectID()
    const dir = projectWorktree()
    if (dir) return `/cron/worktree/${base64Encode(dir)}${pid ? `?projectID=${encodeURIComponent(pid)}` : ""}`
    return pid ? `/cron/${encodeURIComponent(pid)}` : "/cron"
  })

  return (
    <div class="flex flex-col min-h-0 flex-1 py-2">
      <Show when={onTasksPage() && projectWorktree()}>
        {(worktree) => (
          <div class="shrink-0 px-1">
            <A
              href={`/${base64Encode(worktree())}`}
              class="block w-full rounded-md transition-colors hover:bg-surface-raised-base-hover"
            >
              <div class="flex items-center gap-2 px-2 py-2 min-w-0">
                <Icon name="arrow-left" size="small" class="shrink-0 icon-strong-base" />
                <span class="text-14-medium text-text-strong truncate">
                  Back
                </span>
              </div>
            </A>
          </div>
        )}
      </Show>
      <div class="shrink-0 px-1">
        <A
          href={tasksHref()}
          class="block w-full rounded-md transition-colors hover:bg-surface-raised-base-hover"
        >
          <div class="flex items-center gap-2 px-2 py-2 min-w-0">
            <Icon name="bell" size="small" class="shrink-0 icon-strong-base" />
            <span class="text-14-medium text-text-strong truncate">
              {language.t("cron.title")}
            </span>
          </div>
        </A>
      </div>

      <Show when={runs().length > 0}>
        <div class="shrink-0 px-3 pt-4 pb-1 text-11-medium text-text-weak uppercase tracking-wider">
          {language.t("cron.rail.title")}
        </div>

        <nav class="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col px-1">
          <For each={runs()}>
            {(run) => (
              <CronSessionRow
                sessionID={run.sessionID}
                taskName={run.taskName}
                taskDirectory={run.taskDirectory}
                projectID={projectID()}
                status={run.status}
                startedAt={run.startedAt}
                sequence={run.sequence}
              />
            )}
          </For>
        </nav>
      </Show>
    </div>
  )
}

const CronSessionRow = (props: {
  sessionID?: string
  taskName: string
  taskDirectory: string
  projectID?: string
  status: CronRunStatus
  startedAt: number
  sequence: number
}): JSX.Element => {
  const slug = createMemo(() => base64Encode(props.taskDirectory))
  const path = createMemo(() => `/cron/worktree/${slug()}/session/${props.sessionID}`)
  const href = createMemo(() => {
    if (!props.sessionID) return ""
    const search = new URLSearchParams({ sidebar: "cron" })
    if (props.projectID) search.set("projectID", props.projectID)
    return `${path()}?${search.toString()}`
  })
  const location = useLocation()
  const isActive = createMemo(() => !!props.sessionID && location.pathname === path())

  const indicator = (
    <div class="shrink-0 size-6 flex items-center justify-center">
      <SolidSwitch
        fallback={
          <div
            class="size-1.5 rounded-full"
            classList={{
              "bg-text-success-base": props.status === "success",
              "bg-text-critical-base": props.status === "failed" || props.status === "timeout",
              "bg-text-weak-base": props.status === "cancelled",
            }}
          />
        }
      >
        <Match when={props.status === "running"}>
          <Spinner class="size-[15px]" />
        </Match>
        <Match when={props.status === "queued"}>
          <div class="size-1.5 rounded-full bg-text-interactive-base" />
        </Match>
      </SolidSwitch>
    </div>
  )

  const inner = (
    <div class="flex items-center gap-2 min-w-0 w-full text-left focus:outline-none py-1">
      {indicator}
      <span class="min-w-0 flex-1 flex flex-col">
        <span class="text-14-regular text-text-strong truncate">
          <span class="text-text-weak font-mono mr-1">#{props.sequence}</span>
          {props.taskName}
        </span>
        <span class="text-12-regular text-text-weak truncate">
          {formatTimestamp(props.startedAt)}
        </span>
      </span>
    </div>
  )

  return (
    <div
      class="group/session relative w-full min-w-0 rounded-md cursor-default px-2 transition-colors hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover"
      classList={{
        "bg-surface-base-active": isActive(),
      }}
    >
      <Show
        when={props.sessionID}
        fallback={<div class="opacity-60 cursor-default">{inner}</div>}
      >
        <A href={href()} class="block">
          {inner}
        </A>
      </Show>
    </div>
  )
}
