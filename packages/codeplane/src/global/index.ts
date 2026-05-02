import fs from "fs/promises"
import { CodeplaneHome } from "@codeplane-ai/shared/home"
import os from "os"
import path from "path"
import { Filesystem } from "../util"
import { Flock } from "@codeplane-ai/shared/util/flock"

const resolved = CodeplaneHome.paths()

export const Path = {
  ...resolved,
  get home() {
    return process.env.CODEPLANE_TEST_HOME || os.homedir()
  },
}

// Initialize Flock with global state path
Flock.setGlobal({ state: Path.state })

await Promise.all([
  fs.mkdir(Path.root, { recursive: true }),
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.cache, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.local_server, { recursive: true }),
  fs.mkdir(Path.local_server_binaries, { recursive: true }),
  fs.mkdir(Path.skills, { recursive: true }),
  fs.mkdir(Path.plugins, { recursive: true }),
  fs.mkdir(Path.agents, { recursive: true }),
  fs.mkdir(Path.commands, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch {}
  await Filesystem.write(path.join(Path.cache, "version"), CACHE_VERSION)
}

export * as Global from "."
