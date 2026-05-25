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
      .option("dir", {
        alias: "directory",
        describe: "directory to open on the selected instance",
        type: "string",
      })
      .option("continue", {
        alias: "c",
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: "s",
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session when continuing (use with --continue or --session)",
        type: "boolean",
      })
      .option("model", {
        alias: "m",
        describe: "model to use in the format of provider/model",
        type: "string",
      })
      .option("agent", {
        describe: "agent to use",
        type: "string",
      })
      .option("prompt", {
        describe: "prompt to start with",
        type: "string",
      })
      .option("route", {
        describe: "initial TUI route",
        type: "string",
      }),
  handler: async (args: {
    instance?: string
    dir?: string
    continue?: boolean
    session?: string
    fork?: boolean
    model?: string
    agent?: string
    prompt?: string
    route?: string
    "--"?: string[]
  }) => {
    const forwarded = [
      ...(args.instance ? ["--instance", args.instance] : []),
      ...(args.dir ? ["--dir", args.dir] : []),
      ...(args.continue ? ["--continue"] : []),
      ...(args.session ? ["--session", args.session] : []),
      ...(args.fork ? ["--fork"] : []),
      ...(args.model ? ["--model", args.model] : []),
      ...(args.agent ? ["--agent", args.agent] : []),
      ...(args.prompt ? ["--prompt", args.prompt] : []),
      ...(args.route ? ["--route", args.route] : []),
      ...(args["--"] ?? []),
    ]
    await launchTUI(forwarded)
  },
}
