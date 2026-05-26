import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { makeRuntime } from "@/effect/run-service"
import { Effect } from "effect"

const configRuntime = makeRuntime(Config.Service, Config.defaultLayer)
const providerRuntime = makeRuntime(Provider.Service, Provider.defaultLayer)

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current Codeplane configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => c.json(await configRuntime.runPromise((svc) => svc.getRaw())),
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update Codeplane configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info.zod),
      async (c) =>
        c.json(
          await configRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              const config = c.req.valid("json")
              yield* svc.update(config)
              return yield* svc.getRaw()
            }),
          ),
        ),
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ConfigProvidersResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        c.json(
          await providerRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              const providers = yield* svc.list()
              return {
                providers: Object.values(providers),
                default: Provider.defaultModelIDs(providers),
              }
            }),
          ),
        ),
    ),
)
