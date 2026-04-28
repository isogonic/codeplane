import { Schema } from "effect"
import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const CronTaskID = Schema.String.annotate({ [ZodOverride]: Identifier.schema("cron") }).pipe(
  Schema.brand("CronTaskID"),
  withStatics((s) => ({
    descending: (id?: string) => s.make(Identifier.descending("cron", id)),
    zod: zod(s),
  })),
)
export type CronTaskID = Schema.Schema.Type<typeof CronTaskID>

export const CronRunID = Schema.String.annotate({ [ZodOverride]: Identifier.schema("crun") }).pipe(
  Schema.brand("CronRunID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("crun", id)),
    zod: zod(s),
  })),
)
export type CronRunID = Schema.Schema.Type<typeof CronRunID>
