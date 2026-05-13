import "@/index.css"
import { I18nProvider } from "@codeplane-ai/ui/context"
import { DialogProvider } from "@codeplane-ai/ui/context/dialog"
import { FileComponentProvider } from "@codeplane-ai/ui/context/file"
import { MarkedProvider } from "@codeplane-ai/ui/context/marked"
import { File } from "@codeplane-ai/ui/file"
import { Font } from "@codeplane-ai/ui/font"
import { Splash } from "@codeplane-ai/ui/logo"
import { ThemeProvider } from "@codeplane-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  lazy,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { ChatProvider } from "@/context/chat"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { LiveActivityProvider } from "@/context/live-activity"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import { UpdatesProvider } from "@/context/updates"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"
import { useCheckServerHealth } from "./utils/server-health"

const loadHome = () => import("@/pages/home")
const loadNotifications = () => import("@/pages/notifications")
const loadSettings = () => import("@/pages/settings")
const loadCron = () => import("@/pages/cron")
const loadSession = () => import("@/pages/session")
const loadChat = () => import("@/pages/chat")
const HomeRoute = lazy(loadHome)
const NotificationsRoute = lazy(loadNotifications)
const SettingsRoute = lazy(loadSettings)
const CronRoute = lazy(loadCron)
const Session = lazy(loadSession)
const ChatRoute = lazy(loadChat)
const ModesRedirect = () => <Navigate href="/settings/modes" />
const ModelsRedirect = () => <Navigate href="/settings/models" />
const McpRedirect = () => <Navigate href="/settings/mcp" />
const PluginsRedirect = () => <Navigate href="/settings/plugins" />
const SkillsRedirect = () => <Navigate href="/settings/skills" />

if (typeof location === "object") {
  const pathname = location.pathname
  if (/\/session(?:\/|$)/.test(pathname)) void loadSession()
  if (pathname.startsWith("/settings")) void loadSettings()
  if (pathname === "/notifications") void loadNotifications()
  if (pathname.startsWith("/cron")) void loadCron()
  if (pathname === "/chat" || pathname.startsWith("/chat/")) void loadChat()
}

if (typeof window === "object" && typeof requestIdleCallback === "function") {
  const preloadOthers = () => {
    void loadHome()
    void loadSettings()
    void loadNotifications()
    void loadCron()
    void loadSession()
    void loadChat()
  }
  requestIdleCallback(preloadOthers, { timeout: 3000 })
} else if (typeof window === "object") {
  window.setTimeout(() => {
    void loadHome()
    void loadSettings()
    void loadNotifications()
    void loadCron()
    void loadSession()
    void loadChat()
  }, 1500)
}

const SessionRoute = () => (
  <SessionProviders>
    <Session />
  </SessionProviders>
)

const SessionIndexRoute = () => <Navigate href="session" />
const CronSessionRoute = () => (
  <DirectoryLayout>
    <SessionRoute />
  </DirectoryLayout>
)

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __CODEPLANE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <UpdatesProvider>
              <ModelsProvider>
                <CommandProvider>
                  <HighlightsProvider>
                    <ChatProvider>
                      <LiveActivityProvider>
                        <Layout>{props.children}</Layout>
                      </LiveActivityProvider>
                    </ChatProvider>
                  </HighlightsProvider>
                </CommandProvider>
              </ModelsProvider>
            </UpdatesProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {/*<Suspense fallback={<Loading />}>*/}
      {props.appChildren}
      {props.children}
      {/*</Suspense>*/}
    </AppShellProviders>
  )
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProvider>
                  <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                </MarkedProvider>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )

  return (
    <Suspense
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      {/*<Show
        when={checkMode() === "blocking" ? !startupHealthCheck.loading : startupHealthCheck.state !== "pending"}
        fallback={
          <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
            <Splash class="w-16 h-20 opacity-50 animate-pulse" />
          </div>
        }
      >*/}
      {checkMode() === "blocking" ? startupHealthCheck() : startupHealthCheck.latest}
      <Show
        when={startupHealthCheck()}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              void healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
      {/*</Show>*/}
    </Suspense>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        <Splash class="w-12 h-15 mb-4" />
        <p class="text-14-regular text-text-base">
          {unreachable()[0]}
          <span class="text-text-strong font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-text-weak">{language.t("app.server.retrying")}</p>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-text-base text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface-base rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    onClick={() => {
                      const desktop = platform.serverManager?.instances.find((instance) => instance.key === key)
                      if (desktop) {
                        void platform.serverManager?.open(desktop.id)
                        return
                      }
                      props.onServerSelected?.(key)
                    }}
                  >
                    <span class="text-14-regular text-text-strong truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  const key = createMemo(() => `${server.key}\n${server.scope.key}`)
  return (
    <Show when={key()} keyed>
      {(_) => props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}) {
  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      disableHealthCheck={props.disableHealthCheck}
      servers={props.servers}
    >
      <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
        <ServerKey>
          <QueryProvider>
            <GlobalSDKProvider>
              <GlobalSyncProvider>
                <Dynamic
                  component={props.router ?? Router}
                  root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
                >
                  <Route path="/" component={HomeRoute} />
                  <Route path="/chat/:id?" component={ChatRoute} />
                  <Route path="/notifications" component={NotificationsRoute} />
                  <Route path="/modes" component={ModesRedirect} />
                  <Route path="/models" component={ModelsRedirect} />
                  <Route path="/mcp" component={McpRedirect} />
                  <Route path="/plugins" component={PluginsRedirect} />
                  <Route path="/skills" component={SkillsRedirect} />
                  <Route path="/settings/:tab?" component={SettingsRoute} />
                  <Route path="/cron" component={CronRoute} />
                  <Route path="/cron/worktree/:dir/session/:id" component={CronSessionRoute} />
                  <Route path="/cron/worktree/:dir" component={CronRoute} />
                  <Route path="/cron/:projectID" component={CronRoute} />
                  <Route path="/:dir" component={DirectoryLayout}>
                    <Route path="/" component={SessionIndexRoute} />
                    <Route path="/session/:id?" component={SessionRoute} />
                  </Route>
                </Dynamic>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </QueryProvider>
        </ServerKey>
      </ConnectionGate>
    </ServerProvider>
  )
}
