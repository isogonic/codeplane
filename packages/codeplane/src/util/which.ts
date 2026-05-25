import whichPkg from "which"
import path from "path"
import { Global } from "../global"
import { environment } from "../shell/environment"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const source = env ?? environment()
  const base = source.PATH ?? source.Path ?? ""
  const full = base ? base + path.delimiter + Global.Path.bin : Global.Path.bin
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt: source.PATHEXT ?? source.PathExt,
  })
  return typeof result === "string" ? result : null
}
