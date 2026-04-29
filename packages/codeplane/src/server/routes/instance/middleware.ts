import type { MiddlewareHandler } from "hono"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { BootstrapRuntime } from "@/effect/bootstrap-runtime"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { WorkspaceID } from "@/control-plane/schema"

export function InstanceMiddleware(workspaceID?: WorkspaceID): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname
    const instancePath = [
      "/experimental/workspace",
      "/project",
      "/pty",
      "/config",
      "/experimental",
      "/session",
      "/permission",
      "/question",
      "/provider",
      "/sync",
      "/find",
      "/file",
      "/event",
      "/mcp",
      "/tui",
      "/instance",
      "/path",
    ].some((prefix) => path === prefix || path.startsWith(prefix + "/"))
    if (!workspaceID && !instancePath) return next()

    const raw = c.req.query("directory") || c.req.header("x-codeplane-directory") || process.cwd()
    const directory = AppFileSystem.resolve(
      (() => {
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })(),
    )

    return WorkspaceContext.provide({
      workspaceID,
      async fn() {
        return Instance.provide({
          directory,
          init: () => BootstrapRuntime.runPromise(InstanceBootstrap),
          async fn() {
            return next()
          },
        })
      },
    })
  }
}
