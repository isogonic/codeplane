import fs from "node:fs/promises"
import path from "node:path"
import { CodeplaneHome } from "./home"

export type InstanceCacheArea = {
  key: "instance" | "local-server"
  label: string
  path: string
  bytes: number
}

export type InstanceCacheInfo = {
  exists: boolean
  bytes: number
  areas: InstanceCacheArea[]
}

type HomePaths = ReturnType<typeof CodeplaneHome.paths>

function safeJoin(root: string, ...parts: string[]) {
  const base = path.resolve(root)
  const resolved = path.resolve(base, ...parts)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("Invalid instance id")
  }
  return resolved
}

async function directoryBytes(target: string): Promise<number> {
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => undefined)
  if (!entries) return 0
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(target, entry.name)
      if (entry.isDirectory()) return directoryBytes(child)
      const stat = await fs.lstat(child).catch(() => undefined)
      return stat?.size ?? 0
    }),
  )
  return sizes.reduce((sum, value) => sum + value, 0)
}

function cacheAreas(id: string, home: HomePaths): Omit<InstanceCacheArea, "bytes">[] {
  return [
    {
      key: "instance",
      label: "Instance cache",
      path: safeJoin(path.join(home.globalRoot, "instances"), id, "cache"),
    },
    {
      key: "local-server",
      label: "Local server cache",
      path: safeJoin(home.local_server, id, "cache"),
    },
  ]
}

export async function getInstanceCacheInfo(id: string, home = CodeplaneHome.paths()): Promise<InstanceCacheInfo> {
  const areas = (
    await Promise.all(
      cacheAreas(id, home).map(async (area) => {
        const bytes = await directoryBytes(area.path)
        if (bytes === 0) return
        return { ...area, bytes }
      }),
    )
  ).filter((area): area is InstanceCacheArea => area !== undefined)
  return {
    areas,
    bytes: areas.reduce((sum, area) => sum + area.bytes, 0),
    exists: areas.length > 0,
  }
}

export async function clearInstanceCache(id: string, home = CodeplaneHome.paths()): Promise<InstanceCacheInfo> {
  const before = await getInstanceCacheInfo(id, home)
  await Promise.all(before.areas.map((area) => fs.rm(area.path, { force: true, recursive: true })))
  return before
}

export * as InstanceCache from "./instance-cache"
