export * as ConfigCommit from "./commit"

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Info = Schema.Struct({
  coauthor: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true, commits made through Codeplane include Co-Authored-By: Codeplane <noreply@codeplane.cc>.",
  }),
})
  .annotate({ identifier: "CommitConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
