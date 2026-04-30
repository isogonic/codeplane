export * as ConfigGit from "./git"

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Provider = Schema.Literals(["github", "gitlab", "bitbucket", "azure-devops", "generic"])
  .annotate({ identifier: "GitProviderConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Provider = Schema.Schema.Type<typeof Provider>

export const Credential = Schema.Struct({
  type: Schema.optional(Schema.Literals(["stored", "env", "ssh", "none"])),
  key: Schema.optional(Schema.String).annotate({
    description: "Key in the local codeplane auth store, usually git:<instance-name>",
  }),
  env: Schema.optional(Schema.String).annotate({
    description: "Environment variable containing the token/password for this Git host",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Username used with HTTPS basic auth. Defaults to oauth2 for GitLab and x-access-token otherwise.",
  }),
  sshCommand: Schema.optional(Schema.String).annotate({
    description: "Optional GIT_SSH_COMMAND for SSH remotes, for example ssh -i ~/.ssh/id_ed25519",
  }),
})
  .annotate({ identifier: "GitCredentialConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Credential = Schema.Schema.Type<typeof Credential>

export const Instance = Schema.Struct({
  url: Schema.String.annotate({
    description: "Base URL for the Git host, for example https://github.com or https://gitlab.example.com",
  }),
  provider: Schema.optional(Provider),
  hosts: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional hostnames that should match this instance",
  }),
  defaultRemote: Schema.optional(Schema.String).annotate({
    description: "Preferred remote name for operations that need a remote",
  }),
  credential: Schema.optional(Credential),
})
  .annotate({ identifier: "GitInstanceConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Instance = Schema.Schema.Type<typeof Instance>

export const Info = Schema.Record(Schema.String, Instance)
  .annotate({ identifier: "GitConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
