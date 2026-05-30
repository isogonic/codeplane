import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Schema, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Global } from "../global"
import { Log } from "../util"

const skillConcurrency = 4
const fileConcurrency = 8

class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
  name: Schema.String,
  files: Schema.Array(Schema.String),
}) {}

class Index extends Schema.Class<Index>("Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  readonly pull: (url: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/SkillDiscovery") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Path.Path | HttpClient.HttpClient> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const log = Log.create({ service: "skill-discovery" })
      const fs = yield* AppFileSystem.Service
      const path = yield* Path.Path
      const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
      const cache = path.join(Global.Path.cache, "skills")

      const download = Effect.fn("Discovery.download")(function* (url: string, dest: string) {
        if (yield* fs.exists(dest).pipe(Effect.orDie)) return true

        return yield* HttpClientRequest.get(url).pipe(
          http.execute,
          Effect.flatMap((res) => res.arrayBuffer),
          Effect.flatMap((body) => fs.writeWithDirs(dest, new Uint8Array(body))),
          Effect.as(true),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to download", { url, err })
              return false
            }),
          ),
        )
      })

      const pull = Effect.fn("Discovery.pull")(function* (url: string) {
        const base = url.endsWith("/") ? url : `${url}/`
        const index = new URL("index.json", base).href
        const host = base.slice(0, -1)

        log.info("fetching index", { url: index })

        const data = yield* HttpClientRequest.get(index).pipe(
          HttpClientRequest.acceptJson,
          http.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Index)),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to fetch index", { url: index, err })
              return null
            }),
          ),
        )

        if (!data) return []

        const list = data.skills.filter((skill) => {
          if (!skill.files.includes("SKILL.md")) {
            log.warn("skill entry missing SKILL.md", { url: index, skill: skill.name })
            return false
          }
          return true
        })

        // skill.name and file come from the remote index.json (untrusted host).
        // path.join(cache, "../../etc/...") would escape the cache dir and let a
        // malicious registry write arbitrary files. Only accept destinations
        // contained within the cache root.
        const cacheRoot = path.resolve(cache)
        const within = (target: string) => {
          const resolved = path.resolve(target)
          return resolved === cacheRoot || resolved.startsWith(cacheRoot + path.sep)
        }

        const dirs = yield* Effect.forEach(
          list,
          (skill) =>
            Effect.gen(function* () {
              const root = path.join(cache, skill.name)
              if (!within(root)) {
                log.warn("skipping skill with unsafe name", { url: index, skill: skill.name })
                return null
              }

              yield* Effect.forEach(
                skill.files,
                (file) => {
                  const dest = path.join(root, file)
                  if (!within(dest)) {
                    log.warn("skipping skill file with unsafe path", { url: index, skill: skill.name, file })
                    return Effect.void
                  }
                  return download(new URL(file, `${host}/${skill.name}/`).href, dest)
                },
                {
                  concurrency: fileConcurrency,
                },
              )

              const md = path.join(root, "SKILL.md")
              return (yield* fs.exists(md).pipe(Effect.orDie)) ? root : null
            }),
          { concurrency: skillConcurrency },
        )

        return dirs.filter((dir): dir is string => dir !== null)
      })

      return Service.of({ pull })
    }),
  )

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export * as Discovery from "./discovery"
