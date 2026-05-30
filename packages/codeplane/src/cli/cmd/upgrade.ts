import { AppRuntime } from "@/effect/app-runtime"
import { Installation } from "@/installation"
import { InstallationVersion, hasUpdate, isSameVersion } from "@/installation/version"
import { cmd } from "./cmd"

export function normalizeUpgradeTarget(target: string | undefined) {
  return target?.replace(/^[vV]/, "")
}

// User-facing `codeplane upgrade` command.
//
// Until v27.4.43 the auto-upgrade scheduler in `cli/upgrade.ts` only
// ever ran from the TUI worker (via the `checkUpgrade` RPC). That meant
// `codeplane -v`, `codeplane serve`, and `codeplane web` never auto-
// bumped — and there was no manual `codeplane upgrade` to fall back on,
// so users who didn't live inside the TUI got pinned to whatever
// version they originally installed (the user himself was stuck on
// 27.4.22 through 13 patch releases for exactly this reason).
//
// This command exposes the same `Installation.Service.upgrade()` flow
// but with explicit user intent: ignore the `autoupdate` config (the
// user typed the command, they want to upgrade), pick `--target` if
// provided otherwise `latest`, and print every step so silent failures
// are impossible.
export const UpgradeCommand = cmd<unknown, { target?: string; check?: boolean }>({
  command: "upgrade [target]",
  describe: "upgrade codeplane to the latest (or a specific) version",
  builder: (yargs) =>
    yargs
      .positional("target", {
        describe: "version to install (defaults to the latest stable release)",
        type: "string",
      })
      .option("check", {
        describe: "only check what version is available; do not install",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const method = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.method()))
    process.stdout.write(`Current : ${InstallationVersion}\n`)
    process.stdout.write(`Method  : ${method}\n`)

    if (!Installation.canUpgradeInPlace(method)) {
      if (method === "desktop") {
        process.stderr.write(
          `\nThis Codeplane server is managed by the desktop app. Use the desktop Updates panel to update the shell, or update local runtimes from the instance selector.\n`,
        )
        process.exit(2)
      }
      if (method === "managed-local") {
        process.stderr.write(
          `\nThis Codeplane server is a managed local runtime. Restart Codeplane to pick up the newest runtime, or run \`codeplane instance local install <version>\` to pre-fetch one.\n`,
        )
        process.exit(2)
      }
      process.stderr.write(
        `\nCannot determine how this build of codeplane was installed, so no automatic upgrade path exists.\n` +
          `Re-install manually from https://github.com/isogonic/codeplane/releases/latest, or use the\n` +
          `package manager you originally installed with (npm/pnpm/bun/yarn/brew/scoop/choco).\n`,
      )
      process.exit(2)
    }

    const target = normalizeUpgradeTarget(args.target)
    const latest = target
      ? target
      : await AppRuntime.runPromise(Installation.Service.use((svc) => svc.latest(method))).catch(() => undefined)
    if (!latest) {
      process.stderr.write(
        `\nCould not resolve latest version from the ${method} registry. Check network access and try again,\n` +
          `or pass an explicit version: \`codeplane upgrade <version>\`.\n`,
      )
      process.exit(2)
    }
    process.stdout.write(`${target ? "Target  " : "Latest  "}: ${latest}\n`)

    if (args.check) {
      const newer = hasUpdate(InstallationVersion, latest)
      process.stdout.write(
        `\n${
          newer
            ? "Update available."
            : isSameVersion(InstallationVersion, latest)
              ? "Already on latest."
              : "Already on a newer build than latest."
        }\n`,
      )
      return
    }

    if (!target && isSameVersion(InstallationVersion, latest)) {
      process.stdout.write(`\nAlready on ${latest}. Nothing to do.\n`)
      return
    }

    process.stdout.write(`\nUpgrading via ${method} → ${latest} …\n`)
    try {
      await AppRuntime.runPromise(Installation.Service.use((svc) => svc.upgrade(method, latest)))
      process.stdout.write(`\nUpgrade complete. Re-run \`codeplane -v\` to confirm.\n`)
    } catch (err) {
      const stderr =
        err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : err instanceof Error
            ? (err.stack ?? err.message)
            : String(err)
      process.stderr.write(`\nUpgrade failed:\n${stderr}\n`)
      process.exit(1)
    }
  },
})
