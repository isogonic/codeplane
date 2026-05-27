import { Auth } from "@/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { Log } from "@/util"
import { Effect } from "effect"
import { ProviderID } from "@/provider/schema"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"
import { Hono } from "hono"
import { describeRoute, resolver, validator, openAPIRouteHandler } from "hono-openapi"
import z from "zod"
import { errors } from "../../error"

export function ControlPlaneRoutes(): Hono {
  const app = new Hono()
  return app
    .put(
      "/auth/:providerID",
      describeRoute({
        summary: "Set auth credentials",
        description: "Set authentication credentials",
        operationId: "auth.set",
        responses: {
          200: {
            description: "Successfully set authentication credentials",
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
          providerID: ProviderID.zod,
        }),
      ),
      validator("json", Auth.Info.zod),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const info = c.req.valid("json")
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const auth = yield* Auth.Service
            yield* auth.set(providerID, info)
          }),
        )
        return c.json(true)
      },
    )
    .delete(
      "/auth/:providerID",
      describeRoute({
        summary: "Remove auth credentials",
        description: "Remove authentication credentials",
        operationId: "auth.remove",
        responses: {
          200: {
            description: "Successfully removed authentication credentials",
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
          providerID: ProviderID.zod,
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const auth = yield* Auth.Service
            yield* auth.remove(providerID)
          }),
        )
        return c.json(true)
      },
    )
    .get(
      "/doc",
      openAPIRouteHandler(app, {
        documentation: {
          info: {
            title: "codeplane",
            version: CodeplaneVersion,
            description: "codeplane api",
          },
          openapi: "3.1.1",
        },
      }),
    )
    .use(
      validator(
        "query",
        z.object({
          directory: z.string().optional(),
          workspace: z.string().optional(),
        }),
      ),
    )
    .post(
      "/log",
      describeRoute({
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
        operationId: "app.log",
        responses: {
          200: {
            description: "Log entry written successfully",
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
        "json",
        z.object({
          // Service names are namespaced into the log; restrict to a
          // boring identifier shape to keep an authenticated attacker
          // from forging entries under `server`, `server.security`,
          // `server.audit` etc. Length cap defends against log-volume
          // attacks that try to fill disk via this endpoint.
          service: z
            .string()
            .min(1)
            .max(64)
            .regex(/^[a-z0-9][a-z0-9._-]*$/i, "service must be a simple identifier")
            .refine((v) => !v.toLowerCase().startsWith("server"), "service prefix 'server' is reserved")
            .meta({ description: "Service name for the log entry" }),
          level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
          // Cap message + extra so /log can't be used to dump arbitrary
          // volumes into the server log. 8 KB / 16 KB are generous for
          // legitimate UI / SDK logging while still bounded.
          message: z.string().max(8 * 1024).meta({ description: "Log message" }),
          extra: z
            .record(z.string(), z.any())
            .optional()
            .refine(
              (v) => v === undefined || JSON.stringify(v).length <= 16 * 1024,
              "extra is too large (16 KB serialized max)",
            )
            .meta({ description: "Additional metadata for the log entry" }),
        }),
      ),
      async (c) => {
        const { service, level, message, extra } = c.req.valid("json")
        // Mark client-submitted entries so they're distinguishable from
        // internal log lines at audit time. An attacker can spoof
        // `service` within the regex above, but cannot remove this
        // marker because it's added server-side.
        const logger = Log.create({ service: `client.${service}` })

        switch (level) {
          case "debug":
            logger.debug(message, extra)
            break
          case "info":
            logger.info(message, extra)
            break
          case "error":
            logger.error(message, extra)
            break
          case "warn":
            logger.warn(message, extra)
            break
        }

        return c.json(true)
      },
    )
}
