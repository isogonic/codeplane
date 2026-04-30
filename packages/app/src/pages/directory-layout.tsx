import { DataProvider } from "@codeplane-ai/ui/context"
import { showToast } from "@codeplane-ai/ui/toast"
import { base64Encode } from "@codeplane-ai/shared/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { useGlobalSDK } from "@/context/global-sdk"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const globalSDK = useGlobalSDK()
  const slug = createMemo(() => base64Encode(props.directory))
  const sessionBase = createMemo(() =>
    location.pathname.startsWith(`/cron/worktree/${slug()}`) ? `/cron/worktree/${slug()}` : `/${slug()}`,
  )
  const sessionSearch = createMemo(() => {
    const current = new URLSearchParams(location.search)
    const next = new URLSearchParams()
    if (current.get("sidebar") === "cron") next.set("sidebar", "cron")
    const projectID = current.get("projectID")
    if (projectID) next.set("projectID", projectID)
    const value = next.toString()
    return value ? `?${value}` : ""
  })

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const cronPrefix = `/cron/worktree/${slug()}`
    if (location.pathname.startsWith(cronPrefix)) {
      navigate(
        `/cron/worktree/${base64Encode(next)}${location.pathname.slice(cronPrefix.length)}${location.search}${location.hash}`,
        { replace: true },
      )
      return
    }
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  createResource(
    () => params.id,
    (id) => sync.session.sync(id),
  )

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`${sessionBase()}/session/${sessionID}${sessionSearch()}`)}
      onSessionHref={(sessionID: string) => `${sessionBase()}/session/${sessionID}${sessionSearch()}`}
      bashInteractive={{
        kill: (input) => globalSDK.client.global.bashInteractive.kill({ callID: input.callID }).then(() => {}),
      }}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
