import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { AppRuntime } from "@/effect/app-runtime"
import { Installation } from "../../installation"
import { InstallationVersion } from "../../installation/version"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade codeplane to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "yarn", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const detectedMethod = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.method()))
    let method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`codeplane is installed to ${process.execPath} and may be managed by a package manager`)
      const picked = await prompts.select<Installation.Method | "cancel">({
        message: "Pick an install method to upgrade with:",
        options: [
          { label: "npm install -g", value: "npm" },
          { label: "pnpm add -g", value: "pnpm" },
          { label: "yarn global add", value: "yarn" },
          { label: "bun add -g", value: "bun" },
          { label: "Homebrew (brew upgrade)", value: "brew" },
          { label: "curl install script", value: "curl" },
          { label: "Cancel", value: "cancel" },
        ],
        initialValue: "cancel",
      })
      if (picked === "cancel" || prompts.isCancel(picked)) {
        prompts.outro("Done")
        return
      }
      method = picked as Installation.Method
    }
    if (method === "desktop") {
      prompts.log.error(
        "This Codeplane is managed by the desktop app. Use the desktop app's Updates panel to install a new version.",
      )
      prompts.outro("Done")
      return
    }
    prompts.log.info("Using method: " + method)
    const target = args.target
      ? Installation.cleanVersion(args.target)
      : await AppRuntime.runPromise(Installation.Service.use((svc) => svc.latest(method)))

    if (Installation.isSameVersion(InstallationVersion, target)) {
      prompts.log.warn(`codeplane upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${InstallationVersion} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.upgrade(method, target))).catch(
      (err) => err,
    )
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) {
        // necessary because choco only allows install/upgrade in elevated terminals
        if (method === "choco" && err.stderr.includes("not running from an elevated command shell")) {
          prompts.log.error("Please run the terminal as Administrator and try again")
        } else {
          prompts.log.error(err.stderr)
        }
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}
