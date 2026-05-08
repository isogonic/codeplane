import { Schema } from "effect"
import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

/**
 * Branded ID for {@link PromptJobTable} rows. Ascending so `ORDER BY id` gives
 * FIFO per-session ordering — the worker relies on this for serialization.
 */
export const PromptJobID = Schema.String.annotate({ [ZodOverride]: Identifier.schema("pjob") }).pipe(
  Schema.brand("PromptJobID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("pjob", id)),
    zod: zod(s),
  })),
)
export type PromptJobID = Schema.Schema.Type<typeof PromptJobID>

/**
 * Persisted job lifecycle. Sourced from this set so changes (renaming, adding
 * a state) only require updating one place — the SQL column stays `text`.
 */
export const PromptJobStatus = Schema.Literals(["pending", "running", "completed", "failed", "cancelled"]).pipe(
  withStatics((s) => ({ zod: zod(s) })),
)
export type PromptJobStatus = Schema.Schema.Type<typeof PromptJobStatus>
