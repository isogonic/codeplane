import type { Argv } from "yargs"
import { launchTUI } from "../../tui/launcher"

export const TuiCommand = {
  command: "tui",
  describe: "start the terminal UI",
  builder: (yargs: Argv) =>
    yargs
      .option("instance", {
        alias: "i",
        describe: "saved instance id to open",
        type: "string",
      })
      .option("route", {
        describe: "initial TUI route",
        type: "string",
      }),
  handler: async (args: { instance?: string; route?: string; "--"?: string[] }) => {
    const forwarded = [
      ...(args.instance ? ["--instance", args.instance] : []),
      ...(args.route ? ["--route", args.route] : []),
      ...(args["--"] ?? []),
    ]
    await launchTUI(forwarded)
  },
}
