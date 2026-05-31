import { cmd } from "./cmd"
import { UI } from "../ui"
import { generateSecret, isValidSecret, otpauthURI, generateCode, base32Decode } from "../../server/totp"

// `codeplane totp` — manage the second factor (TOTP) for the server's Basic
// Auth gate.
//
//   codeplane totp generate            generate a fresh secret + enrolment URI
//   codeplane totp generate --account me --issuer "My Box"
//   codeplane totp uri --secret <s>    print the otpauth:// URI for a secret
//   codeplane totp code --secret <s>   print the current 6-digit code (debug)
//
// The generated secret is what you pass to the server via
// CODEPLANE_SERVER_TOTP_SECRET (or `serve --totp-secret <s>`); the otpauth URI
// (or the secret typed manually) is what you add to your authenticator app.

function printEnrolment(secret: string, account: string, issuer: string) {
  const uri = otpauthURI({ secret, account, issuer })
  UI.empty()
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Two-factor (TOTP) secret generated.")
  UI.empty()
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "  Secret (base32):  " + UI.Style.TEXT_HIGHLIGHT + secret)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "  Account:          " + UI.Style.TEXT_NORMAL + account)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "  Issuer:           " + UI.Style.TEXT_NORMAL + issuer)
  UI.empty()
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "  otpauth URI:")
  UI.println("  " + UI.Style.TEXT_INFO + uri + UI.Style.TEXT_NORMAL)
  UI.empty()
  UI.println(UI.Style.TEXT_DIM + "  Add it to your authenticator app (Google Authenticator, 1Password,")
  UI.println(UI.Style.TEXT_DIM + "  Authy, Aegis, …) — paste the otpauth URI, or enter the base32 secret")
  UI.println(UI.Style.TEXT_DIM + "  manually. Generate a QR from the URI with any qr tool if you prefer.")
  UI.empty()
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "  Start the server with it:")
  UI.println(
    UI.Style.TEXT_DIM +
      "    codeplane serve --hostname 0.0.0.0 --password <pw> --totp-secret " +
      secret +
      UI.Style.TEXT_NORMAL,
  )
  UI.println(UI.Style.TEXT_DIM + "  or set CODEPLANE_SERVER_TOTP_SECRET in the environment." + UI.Style.TEXT_NORMAL)
  UI.empty()
}

export const TotpCommand = cmd({
  command: "totp <command>",
  describe: "manage two-factor (TOTP) auth for the server",
  builder: (yargs) =>
    yargs
      .command(
        "generate",
        "generate a new TOTP secret and enrolment URI",
        (y) =>
          y
            .option("account", {
              type: "string",
              describe: "label shown in the authenticator app (usually the Basic Auth username)",
            })
            .option("issuer", {
              type: "string",
              describe: "issuer grouping in the authenticator app",
              default: "Codeplane",
            }),
        (args) => {
          const secret = generateSecret()
          const account = (args.account as string | undefined)?.trim() || "codeplane"
          printEnrolment(secret, account, args.issuer as string)
        },
      )
      .command(
        "uri",
        "print the otpauth:// URI for an existing secret",
        (y) =>
          y
            .option("secret", { type: "string", demandOption: true, describe: "base32 TOTP secret" })
            .option("account", { type: "string", default: "codeplane" })
            .option("issuer", { type: "string", default: "Codeplane" }),
        (args) => {
          const secret = (args.secret as string).trim()
          if (!isValidSecret(secret)) {
            UI.error("Invalid base32 TOTP secret.")
            process.exit(1)
          }
          UI.println(otpauthURI({ secret, account: args.account as string, issuer: args.issuer as string }))
        },
      )
      .command(
        "code",
        "print the current 6-digit code for a secret (for testing)",
        (y) => y.option("secret", { type: "string", demandOption: true, describe: "base32 TOTP secret" }),
        (args) => {
          const secret = (args.secret as string).trim()
          if (!base32Decode(secret)) {
            UI.error("Invalid base32 TOTP secret.")
            process.exit(1)
          }
          const code = generateCode(secret)
          if (!code) {
            UI.error("Could not compute a code for that secret.")
            process.exit(1)
          }
          UI.println(code)
        },
      )
      .demandCommand(1, "Specify a totp subcommand (generate, uri, code)."),
  handler: () => {},
})
