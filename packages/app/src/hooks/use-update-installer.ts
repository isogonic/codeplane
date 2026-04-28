import { showToast, toaster } from "@codeplane-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"

let installPromise: Promise<void> | undefined

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function unique(values: string[]) {
  return values.filter((value, index, list) => !!value && list.indexOf(value) === index)
}

export function useUpdateInstaller() {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()

  const directories = () =>
    unique(
      layout.projects
        .list()
        .flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])])
        .concat(globalSync.data.project.flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])]))
        .filter((directory): directory is string => !!directory),
    )

  const activity = async () => {
    const dirs = directories()
    const [sessionStatus, terminals] = await Promise.all([
      Promise.all(dirs.map((directory) => globalSDK.client.session.status({ directory }))),
      Promise.all(dirs.map((directory) => globalSDK.client.pty.list({ directory }))),
    ])

    const sessions = sessionStatus
      .flatMap((result) => Object.values(result.data ?? {}))
      .filter((status) => status.type !== "idle").length
    const ptys = terminals.flatMap((result) => result.data ?? []).filter((pty) => pty.status === "running").length

    return { sessions, ptys, total: sessions + ptys }
  }

  const waitForIdle = async (): Promise<void> => {
    const current = await activity()
    if (current.total === 0) return
    await wait(5000)
    return waitForIdle()
  }

  const installWhenIdle = (input: { version?: string } = {}) => {
    if (installPromise) return installPromise
    const updateAndRestart = platform.updateAndRestart
    if (!updateAndRestart) return Promise.resolve()

    installPromise = (async () => {
      const toastId = showToast({
        persistent: true,
        icon: "download",
        title: language.t("toast.update.waiting.title"),
        description: language.t("toast.update.waiting.description", { version: input.version ?? "" }),
      })

      await waitForIdle().finally(() => toaster.dismiss(toastId))
      showToast({
        persistent: true,
        icon: "download",
        title: language.t("toast.update.installing.title"),
        description: language.t("toast.update.installing.description", { version: input.version ?? "" }),
      })
      await updateAndRestart()
    })().finally(() => {
      installPromise = undefined
    })

    return installPromise
  }

  return {
    installWhenIdle,
  }
}
