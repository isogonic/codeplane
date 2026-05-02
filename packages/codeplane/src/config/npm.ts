export * as ConfigNpm from "./npm"

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Client = Schema.Literals(["auto", "npm", "pnpm", "bun", "yarn"]).pipe(
  withStatics((s) => ({ zod: zod(s) })),
)
export type Client = Schema.Schema.Type<typeof Client>
export type PackageManager = Exclude<Client, "auto">

export const Registry = Schema.Struct({
  registry: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
  always_auth: Schema.optional(Schema.Boolean),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Registry = Schema.Schema.Type<typeof Registry>

export const Info = Schema.Struct({
  client: Schema.optional(Client),
  registry: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
  always_auth: Schema.optional(Schema.Boolean),
  scopes: Schema.optional(Schema.Record(Schema.String, Registry)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
