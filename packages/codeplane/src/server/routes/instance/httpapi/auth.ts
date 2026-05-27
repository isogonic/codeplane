import { Effect, Layer, Redacted, Schema } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { Flag } from "@/flag/flag"
import { timingSafeEqual } from "../../../../util/timing-safe-equal"

class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Authorization extends HttpApiMiddleware.Service<Authorization>()(
  "@codeplane/ExperimentalHttpApiAuthorization",
  {
    error: Unauthorized,
    security: {
      basic: HttpApiSecurity.basic,
    },
  },
) {}

const emptyCredential = {
  username: "",
  password: Redacted.make(""),
}

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: { readonly username: string; readonly password: typeof emptyCredential.password },
) {
  return Effect.gen(function* () {
    if (!Flag.CODEPLANE_SERVER_PASSWORD) return yield* effect

    // Constant-time compare both username and password. The previous `!==`
    // checks short-circuited at the first byte that differed, which leaks
    // password and username byte-by-byte over the network to an attacker
    // measuring response latency. Always compare both fields so the time
    // doesn't reveal which one failed either.
    const expectedUsername = Flag.CODEPLANE_SERVER_USERNAME ?? "codeplane"
    const usernameOk = yield* Effect.promise(() => timingSafeEqual(credential.username, expectedUsername))
    const passwordOk = yield* Effect.promise(() =>
      timingSafeEqual(Redacted.value(credential.password), Flag.CODEPLANE_SERVER_PASSWORD ?? ""),
    )
    if (!usernameOk || !passwordOk) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    return yield* effect
  })
}

export const authorizationLayer = Layer.succeed(
  Authorization,
  Authorization.of({
    // `auth_token` query credential support was removed — leaking
    // credentials through URLs/logs/Referer headers is too risky for a
    // server that grants full machine control. Clients must send Basic
    // Auth via the Authorization header. WebSocket-only callers go
    // through the `auth_token` rewrite in src/server/middleware.ts.
    basic: (effect, { credential }) => validateCredential(effect, credential),
  }),
)
