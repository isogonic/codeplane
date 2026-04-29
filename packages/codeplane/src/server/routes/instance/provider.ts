import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { ModelsDev } from "@/provider"
import { ProviderAuth } from "@/provider"
import { ProviderID } from "@/provider/schema"
import { mapValues } from "remeda"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { makeRuntime } from "@/effect/run-service"

const configRuntime = makeRuntime(Config.Service, Config.defaultLayer)
const providerRuntime = makeRuntime(Provider.Service, Provider.defaultLayer)
const providerAuthRuntime = makeRuntime(ProviderAuth.Service, ProviderAuth.defaultLayer)

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ListResult.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        const [config, all, connected] = await Promise.all([
          configRuntime.runPromise((svc) => svc.get()),
          ModelsDev.get(),
          providerRuntime.runPromise((svc) => svc.list()),
        ])
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
        const catalog = mapValues(
          Object.fromEntries(
            Object.entries(all).filter(([key]) => (enabled ? enabled.has(key) : true) && !disabled.has(key)),
          ),
          (x) => Provider.catalogProvider(Provider.fromModelsDevProvider(x)),
        )
        const providers = Object.assign({}, catalog, connected)
        return c.json({
          all: Object.values(providers),
          catalog: Object.values(catalog),
          default: Provider.defaultModelIDs(providers),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Methods.zod),
              },
            },
          },
        },
      }),
      async (c) => c.json(await providerAuthRuntime.runPromise((svc) => svc.methods())),
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.zod.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.AuthorizeInput.zod),
      async (c) =>
        c.json(
          await providerAuthRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              const providerID = c.req.valid("param").providerID
              const { method, inputs } = c.req.valid("json")
              return yield* svc.authorize({
                providerID,
                method,
                inputs,
              })
            }),
          ),
        ),
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.CallbackInput.zod),
      async (c) =>
        c.json(
          await providerAuthRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              const providerID = c.req.valid("param").providerID
              const { method, code } = c.req.valid("json")
              yield* svc.callback({
                providerID,
                method,
                code,
              })
              return true
            }),
          ),
        ),
    ),
)
