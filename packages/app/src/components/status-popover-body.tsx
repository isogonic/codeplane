import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { Switch } from "@codeplane-ai/ui/switch"
import { Tabs } from "@codeplane-ai/ui/tabs"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@codeplane-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, For, type JSXElement, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDKOptional } from "@/context/sdk"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { useSyncOptional } from "@/context/sync"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"
import type { LspStatus, McpStatus } from "@codeplane-ai/sdk/v2/client"

const pollMs = 10_000

const highlightConfigRefs = (value: string, refs: string[]): JSXElement => {
  const parts = refs.reduce(
    (acc, ref) =>
      acc.flatMap((part) =>
        refs.includes(part)
          ? [part]
          : part
              .split(ref)
              .flatMap((piece, index, list) => (index === list.length - 1 ? [piece] : [piece, ref])),
      ),
    [value],
  )
  if (parts.length === 1) return value
  return (
    <>
      {parts.map((part) =>
        refs.includes(part) ? (
          <code class="bg-surface-raised-base px-1.5 py-0.5 rounded-sm text-text-base">{part}</code>
        ) : (
          part
        ),
      )}
    </>
  )
}

const pluginLabel = (value: string) => {
  if (!value.startsWith("file://")) return value
  const last = value.split("/").at(-1)
  return last ? decodeURIComponent(last) : value
}

const listServersByHealth = (
  list: ServerConnection.Any[],
  active: ServerConnection.Key | undefined,
  status: Record<ServerConnection.Key, ServerHealth | undefined>,
) => {
  if (!list.length) return list
  const order = new Map(list.map((url, index) => [url, index] as const))
  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0
    if (value?.healthy === false) return 2
    return 1
  }

  return list.slice().sort((a, b) => {
    if (ServerConnection.key(a) === active) return -1
    if (ServerConnection.key(b) === active) return 1
    const diff = rank(status[ServerConnection.key(a)]) - rank(status[ServerConnection.key(b)])
    if (diff !== 0) return diff
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

const useServerHealth = (servers: Accessor<ServerConnection.Any[]>, enabled: Accessor<boolean>) => {
  const checkServerHealth = useCheckServerHealth()
  const [status, setStatus] = createStore({} as Record<ServerConnection.Key, ServerHealth | undefined>)

  createEffect(() => {
    if (!enabled()) {
      setStatus(reconcile({}))
      return
    }
    const list = servers()
    let dead = false

    const refresh = async () => {
      const results: Record<string, ServerHealth> = {}
      await Promise.all(
        list.map(async (conn) => {
          results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
        }),
      )
      if (dead) return
      setStatus(reconcile(results))
    }

    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    onCleanup(() => {
      dead = true
      clearInterval(id)
    })
  })

  return status
}

const useDefaultServerKey = (
  get: (() => string | Promise<string | null | undefined> | null | undefined) | undefined,
) => {
  const [state, setState] = createStore({
    url: undefined as string | undefined,
    tick: 0,
  })

  createEffect(() => {
    state.tick
    let dead = false
    const result = get?.()
    if (!result) {
      setState("url", undefined)
      onCleanup(() => {
        dead = true
      })
      return
    }

    if (result instanceof Promise) {
      void result.then((next) => {
        if (dead) return
        const normalized = next ? normalizeServerUrl(next) : undefined
        setState("url", normalized ?? next ?? undefined)
      })
      onCleanup(() => {
        dead = true
      })
      return
    }

    setState("url", normalizeServerUrl(result) ?? result)
    onCleanup(() => {
      dead = true
    })
  })

  return {
    key: () => {
      const u = state.url
      if (!u) return undefined
      return ServerConnection.key({ type: "http", http: { url: u } })
    },
    refresh: () => setState("tick", (value) => value + 1),
  }
}

const useMcpToggleMutation = () => {
  const projectSync = useSyncOptional()
  const projectSDK = useSDKOptional()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const status = () => projectSync?.data ?? globalSync.data
  const setMcp = (value: Record<string, McpStatus>) =>
    projectSync ? projectSync.set("mcp", value) : globalSync.set("mcp", value)
  const setMcpReady = (value: boolean) =>
    projectSync ? projectSync.set("mcp_ready", value) : globalSync.set("mcp_ready", value)
  const client = () => projectSDK?.client ?? globalSDK.client

  return useMutation(() => ({
    mutationFn: async (name: string) => {
      const current = status().mcp[name]
      await (current?.status === "connected" ? client().mcp.disconnect({ name }) : client().mcp.connect({ name }))
      const result = await client().mcp.status()
      if (result.data) setMcp(result.data)
      setMcpReady(true)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))
}

export function StatusPopoverBody(props: { shown: Accessor<boolean> }) {
  const projectSync = useSyncOptional()
  const globalSync = useGlobalSync()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const projectSDK = useSDKOptional()
  const globalSDK = useGlobalSDK()
  const status = createMemo(() => projectSync?.data ?? globalSync.data)
  const setMcp = (value: Record<string, McpStatus>) =>
    projectSync ? projectSync.set("mcp", value) : globalSync.set("mcp", value)
  const setMcpReady = (value: boolean) =>
    projectSync ? projectSync.set("mcp_ready", value) : globalSync.set("mcp_ready", value)
  const setLsp = (value: LspStatus[]) => (projectSync ? projectSync.set("lsp", value) : globalSync.set("lsp", value))
  const setLspReady = (value: boolean) =>
    projectSync ? projectSync.set("lsp_ready", value) : globalSync.set("lsp_ready", value)
  const client = () => projectSDK?.client ?? globalSDK.client

  const [load, setLoad] = createStore({
    lspDone: false,
    lspLoading: false,
    mcpDone: false,
    mcpLoading: false,
  })

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  createEffect(() => {
    if (!props.shown()) return
    const data = status()

    if (!data.mcp_ready && !load.mcpDone && !load.mcpLoading) {
      setLoad("mcpLoading", true)
      void client().mcp
        .status()
        .then((result) => {
          setMcp(result.data ?? {})
          setMcpReady(true)
        })
        .catch((err) => {
          setLoad("mcpDone", true)
          fail(err)
        })
        .finally(() => {
          setLoad("mcpLoading", false)
        })
    }

    if (!data.lsp_ready && !load.lspDone && !load.lspLoading) {
      setLoad("lspLoading", true)
      void client().lsp
        .status()
        .then((result) => {
          setLsp(result.data ?? [])
          setLspReady(true)
        })
        .catch((err) => {
          setLoad("lspDone", true)
          fail(err)
        })
        .finally(() => {
          setLoad("lspLoading", false)
        })
    }
  })

  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })
  const servers = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (list.every((item) => ServerConnection.key(item) !== ServerConnection.key(current))) return [current, ...list]
    return [current, ...list.filter((item) => ServerConnection.key(item) !== ServerConnection.key(current))]
  })
  const canSwitchServers = createMemo(() => !!platform.desktop)
  const showServerTab = createMemo(() => canSwitchServers() || !projectSync)
  const health = useServerHealth(servers, () => props.shown() && canSwitchServers())
  const sortedServers = createMemo(() => listServersByHealth(servers(), server.key, health))
  const toggleMcp = useMcpToggleMutation()
  const getDefaultServer = () => platform.getDefaultServer?.()
  const defaultServer = useDefaultServerKey(getDefaultServer)
  const desktopInstanceForKey = (key: ServerConnection.Key) =>
    platform.serverManager?.instances.find((instance) => instance.key === key)
  const mcpNames = createMemo(() => Object.keys(status().mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => status().mcp?.[name]?.status
  const lspItems = createMemo(() => status().lsp ?? [])
  const plugins = createMemo(() =>
    (status().config.plugin ?? []).map((item) => (typeof item === "string" ? item : item[0])),
  )
  const pluginEmpty = createMemo(() =>
    highlightConfigRefs(language.t("dialog.plugins.empty"), ["codeplane.jsonc", "config/plugins"]),
  )
  const defaultTab = createMemo(() => {
    if (showServerTab()) return "servers"
    return "mcp"
  })

  return (
    <div class="flex items-center gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
      <Tabs
        aria-label={language.t("status.popover.ariaLabel")}
        class="tabs bg-background-strong rounded-xl overflow-hidden"
        data-component="tabs"
        data-active={defaultTab()}
        defaultValue={defaultTab()}
        variant="alt"
      >
        <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 py-1.5 gap-4">
          <Show when={showServerTab()}>
            <Tabs.Trigger value="servers" data-slot="tab" class="text-12-regular">
              {language.t("status.popover.tab.servers")}
            </Tabs.Trigger>
          </Show>
          <Show when={status()}>
            <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
              {language.t("status.popover.tab.mcp")}
            </Tabs.Trigger>
            <Tabs.Trigger value="lsp" data-slot="tab" class="text-12-regular">
              {language.t("status.popover.tab.lsp")}
            </Tabs.Trigger>
            <Tabs.Trigger value="plugins" data-slot="tab" class="text-12-regular">
              {language.t("status.popover.tab.plugins")}
            </Tabs.Trigger>
          </Show>
        </Tabs.List>

        <Show when={showServerTab()}>
          <Tabs.Content value="servers">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-lg min-h-14">
                <For each={sortedServers()}>
                  {(s) => {
                    const key = ServerConnection.key(s)
                    const blocked = () => health[key]?.healthy === false
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                        classList={{
                          "hover:bg-surface-raised-base-hover": !blocked(),
                          "cursor-not-allowed": blocked(),
                        }}
                        aria-disabled={blocked()}
                        onClick={() => {
                          if (blocked()) return
                          const desktop = desktopInstanceForKey(key)
                          if (desktop) {
                            void platform.serverManager?.open(desktop.id)
                            return
                          }
                          navigate("/")
                          queueMicrotask(() => server.setActive(key))
                        }}
                      >
                        <ServerHealthIndicator health={health[key]} />
                        <ServerRow
                          conn={s}
                          dimmed={blocked()}
                          status={health[key]}
                          class="flex items-center gap-2 w-full min-w-0"
                          nameClass="text-14-regular text-text-base truncate"
                          versionClass="text-12-regular text-text-weak truncate"
                          badge={
                            <Show when={key === defaultServer.key()}>
                              <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-sm">
                                {language.t("common.default")}
                              </span>
                            </Show>
                          }
                        >
                          <div class="flex-1" />
                          <Show when={server.current && key === ServerConnection.key(server.current)}>
                            <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                          </Show>
                        </ServerRow>
                      </button>
                    )
                  }}
                </For>

                <Button
                  variant="secondary"
                  class="mt-3 self-start h-8 px-3 py-1.5"
                  onClick={() => {
                    if (platform.serverManager) {
                      void platform.serverManager.show()
                      return
                    }
                    const run = ++dialogRun
                    void import("./dialog-select-server").then((x) => {
                      if (dialogDead || dialogRun !== run) return
                      dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
                    })
                  }}
                >
                  {language.t("status.popover.action.manageServers")}
                </Button>
              </div>
            </div>
          </Tabs.Content>
        </Show>

        <Show when={status()}>
          <Tabs.Content value="mcp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-lg min-h-14">
                <Show
                  when={mcpNames().length > 0}
                  fallback={
                    <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.mcp.empty")}</div>
                  }
                >
                  <For each={mcpNames()}>
                    {(name) => {
                      const status = () => mcpStatus(name)
                      const enabled = () => status() === "connected"
                      return (
                        <button
                          type="button"
                          class="flex items-center gap-2 w-full h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                          onClick={() => {
                            if (toggleMcp.isPending) return
                            toggleMcp.mutate(name)
                          }}
                          disabled={toggleMcp.isPending && toggleMcp.variables === name}
                        >
                          <div
                            classList={{
                              "size-1.5 rounded-full shrink-0": true,
                              "bg-icon-success-base": status() === "connected",
                              "bg-icon-critical-base": status() === "failed",
                              "bg-border-weak-base": status() === "disabled",
                              "bg-icon-warning-base":
                                status() === "needs_auth" || status() === "needs_client_registration",
                            }}
                          />
                          <span class="text-14-regular text-text-base truncate flex-1">{name}</span>
                          <div onClick={(event) => event.stopPropagation()}>
                            <Switch
                              checked={enabled()}
                              disabled={toggleMcp.isPending && toggleMcp.variables === name}
                              onChange={() => {
                                if (toggleMcp.isPending) return
                                toggleMcp.mutate(name)
                              }}
                            />
                          </div>
                        </button>
                      )
                    }}
                  </For>
                </Show>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="lsp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-lg min-h-14">
                <Show
                  when={lspItems().length > 0}
                  fallback={
                    <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.lsp.empty")}</div>
                  }
                >
                  <For each={lspItems()}>
                    {(item) => (
                      <div class="flex items-center gap-2 w-full px-2 py-1">
                        <div
                          classList={{
                            "size-1.5 rounded-full shrink-0": true,
                            "bg-icon-success-base": item.status === "connected",
                            "bg-icon-critical-base": item.status === "error",
                          }}
                        />
                        <span class="text-14-regular text-text-base truncate">{item.name || item.id}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-lg min-h-14">
                <Show
                  when={plugins().length > 0}
                  fallback={<div class="text-14-regular text-text-base text-center my-auto">{pluginEmpty()}</div>}
                >
                  <For each={plugins()}>
                    {(plugin) => (
                      <div class="flex items-center gap-2 w-full px-2 py-1">
                        <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                        <span class="text-14-regular text-text-base truncate" title={plugin}>
                          {pluginLabel(plugin)}
                        </span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </Tabs.Content>
        </Show>
      </Tabs>
    </div>
  )
}
