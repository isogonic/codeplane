/**
 * Per-instance SSO configuration types.
 *
 * The mobile app supports OAuth 2.0 Authorization Code + PKCE flows
 * (RFC 7636). PKCE is mandatory because mobile apps are public
 * clients — there is no client secret we can keep safe in the
 * bundle, and no server we can call into to exchange the code.
 *
 * Apple-specific "Sign in with Apple" requires the
 * `AuthenticationServices` framework rather than a generic browser
 * flow; that's wired through a separate Capacitor plugin and is
 * documented as a follow-up. The model below carries the metadata
 * we'd need either way (clientId, scopes), so adding the Apple path
 * later is additive.
 */

export type SSOProviderKind =
  | "google"
  | "microsoft"
  | "github"
  | "okta"
  | "auth0"
  | "cloudflare-access"
  | "custom"

/**
 * Endpoint set for the OAuth flow. For custom providers all four
 * fields are user-supplied; for the named presets we resolve them at
 * runtime from `SSO_PROVIDER_PRESETS` so the form only has to ask for
 * the parts that actually vary (clientId, tenant/domain).
 */
export type SSOEndpoints = {
  authorizationEndpoint: string
  tokenEndpoint: string
  /** OIDC userinfo endpoint, optional — used to display the signed-in account. */
  userinfoEndpoint?: string
  /** Optional revocation endpoint hit on sign-out. */
  revocationEndpoint?: string
}

/**
 * The per-instance config the user fills out in the form. Lives
 * alongside `SavedInstance` (non-sensitive — clientId is intended to
 * be public, scopes are public, redirectUri is public). The actual
 * tokens never go in here; they live in the OS keychain via
 * `sso-store.ts`.
 */
export type SSOConfig = {
  enabled: boolean
  provider: SSOProviderKind
  /** Free-form display name shown next to the sign-in button. */
  displayName?: string
  clientId: string
  /** Space- or array-list of OAuth scopes; defaults vary by preset. */
  scopes: string[]
  /**
   * `codeplane://oauth-callback` is the recommended default. Must be
   * registered in Info.plist / AndroidManifest (already wired by the
   * mobile package's `build/` fragments).
   */
  redirectUri: string
  /** Optional tenant for Microsoft / Auth0 domain / Okta org. */
  tenant?: string
  /**
   * Endpoints used for the flow. For a preset provider, leaving
   * these undefined means "resolve from `SSO_PROVIDER_PRESETS`"; for
   * custom providers all fields must be filled in.
   */
  endpoints?: Partial<SSOEndpoints>
  /**
   * Server-side audience claim. Some IdPs (Auth0, Okta) issue access
   * tokens scoped to a specific API audience; the Codeplane server
   * has to validate it.
   */
  audience?: string
  /** Extra space-delimited authorization-request parameters. */
  extraAuthParams?: Record<string, string>
}

/**
 * Tokens returned from the token endpoint. We persist these in the
 * keychain keyed by the instance ID. `expiresAt` is our own
 * monotonic-clock-shifted absolute timestamp (computed at exchange
 * time from `expires_in`) — the spec's `expires_in` is relative.
 */
export type SSOTokens = {
  accessToken: string
  refreshToken?: string
  idToken?: string
  /** Epoch milliseconds of access-token expiry; used for proactive refresh. */
  expiresAt: number
  /** Original `token_type`, normally "Bearer". */
  tokenType: string
  /** OIDC scopes actually granted (may be narrower than what we requested). */
  scope?: string
}

/**
 * Default endpoint + scope sets for the named providers. All values
 * here are public per each provider's docs and don't carry any
 * tenant-specific information. Custom providers don't appear in the
 * map — the form requires the user to provide all endpoints.
 */
export const SSO_PROVIDER_PRESETS: Record<
  Exclude<SSOProviderKind, "custom">,
  {
    label: string
    defaultScopes: string[]
    /** Some providers need a tenant ID baked into the endpoint URL. */
    endpoints: (config: SSOConfig) => SSOEndpoints
    /** Extra auth-request parameters this provider expects. */
    extraAuthParams?: Record<string, string>
  }
> = {
  google: {
    label: "Google",
    defaultScopes: ["openid", "profile", "email"],
    endpoints: () => ({
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      revocationEndpoint: "https://oauth2.googleapis.com/revoke",
    }),
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    label: "Microsoft",
    defaultScopes: ["openid", "profile", "email", "offline_access"],
    endpoints: (config) => {
      const tenant = config.tenant?.trim() || "common"
      return {
        authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        userinfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
      }
    },
  },
  github: {
    label: "GitHub",
    // GitHub doesn't issue refresh tokens for OAuth Apps; using a
    // GitHub App + the device-flow endpoint is the path for that and
    // is documented as a follow-up.
    defaultScopes: ["read:user", "user:email"],
    endpoints: () => ({
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userinfoEndpoint: "https://api.github.com/user",
    }),
  },
  okta: {
    label: "Okta",
    defaultScopes: ["openid", "profile", "email", "offline_access"],
    endpoints: (config) => {
      const domain = config.tenant?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") || ""
      const base = domain ? `https://${domain}` : ""
      return {
        authorizationEndpoint: `${base}/oauth2/default/v1/authorize`,
        tokenEndpoint: `${base}/oauth2/default/v1/token`,
        userinfoEndpoint: `${base}/oauth2/default/v1/userinfo`,
        revocationEndpoint: `${base}/oauth2/default/v1/revoke`,
      }
    },
  },
  auth0: {
    label: "Auth0",
    defaultScopes: ["openid", "profile", "email", "offline_access"],
    endpoints: (config) => {
      const domain = config.tenant?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") || ""
      const base = domain ? `https://${domain}` : ""
      return {
        authorizationEndpoint: `${base}/authorize`,
        tokenEndpoint: `${base}/oauth/token`,
        userinfoEndpoint: `${base}/userinfo`,
        revocationEndpoint: `${base}/oauth/revoke`,
      }
    },
  },
  "cloudflare-access": {
    label: "Cloudflare Access",
    defaultScopes: ["openid", "profile", "email"],
    endpoints: (config) => {
      // Cloudflare Access OIDC endpoints are scoped to the team
      // domain — the user supplies it in `tenant`.
      const team = config.tenant?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") || ""
      const base = team ? `https://${team}` : ""
      return {
        authorizationEndpoint: `${base}/cdn-cgi/access/sso/oidc/authorize`,
        tokenEndpoint: `${base}/cdn-cgi/access/sso/oidc/token`,
        userinfoEndpoint: `${base}/cdn-cgi/access/sso/oidc/userinfo`,
      }
    },
  },
}

/**
 * Resolve the effective endpoints + scopes for a config.
 *
 * For a preset provider this fills in any endpoint the user didn't
 * override; for `custom` it returns whatever they typed verbatim.
 * Throws if a custom config is missing a required endpoint — the
 * caller (form / flow) catches this and surfaces it inline.
 */
export function resolveSSOEndpoints(config: SSOConfig): SSOEndpoints {
  if (config.provider === "custom") {
    const e = config.endpoints ?? {}
    if (!e.authorizationEndpoint || !e.tokenEndpoint) {
      throw new Error("Custom SSO requires both authorizationEndpoint and tokenEndpoint")
    }
    return {
      authorizationEndpoint: e.authorizationEndpoint,
      tokenEndpoint: e.tokenEndpoint,
      userinfoEndpoint: e.userinfoEndpoint,
      revocationEndpoint: e.revocationEndpoint,
    }
  }
  const preset = SSO_PROVIDER_PRESETS[config.provider]
  const presetEndpoints = preset.endpoints(config)
  return {
    authorizationEndpoint: config.endpoints?.authorizationEndpoint ?? presetEndpoints.authorizationEndpoint,
    tokenEndpoint: config.endpoints?.tokenEndpoint ?? presetEndpoints.tokenEndpoint,
    userinfoEndpoint: config.endpoints?.userinfoEndpoint ?? presetEndpoints.userinfoEndpoint,
    revocationEndpoint: config.endpoints?.revocationEndpoint ?? presetEndpoints.revocationEndpoint,
  }
}

export function defaultScopesFor(provider: SSOProviderKind): string[] {
  if (provider === "custom") return ["openid", "profile", "email"]
  return SSO_PROVIDER_PRESETS[provider].defaultScopes
}

export const DEFAULT_REDIRECT_URI = "codeplane://oauth-callback"
