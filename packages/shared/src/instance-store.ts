import fs from "node:fs/promises"
import path from "node:path"
import type { SavedInstance } from "./instance"

export type State = {
  instances: SavedInstance[]
  lastInstanceID?: string
}

async function read(file: string): Promise<State> {
  return fs
    .readFile(file, "utf8")
    .then((value) => JSON.parse(value) as State)
    .then((value) => ({
      instances: Array.isArray(value.instances) ? value.instances : [],
      lastInstanceID: value.lastInstanceID,
    }))
    .catch(() => ({ instances: [] }))
}

async function write(file: string, value: State) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function createInstanceStore(file: string) {
  const getState = () => read(file)
  const list = () => read(file).then((state) => state.instances)
  const getLast = () => read(file).then((state) => state.lastInstanceID)

  async function replace(value: State) {
    const next = {
      instances: Array.isArray(value.instances) ? value.instances : [],
      lastInstanceID: value.lastInstanceID,
    }
    await write(file, next)
    return next
  }

  async function save(instance: SavedInstance) {
    const state = await read(file)
    const existing = state.instances.findIndex((item) => item.id === instance.id)
    const instances =
      existing === -1
        ? [...state.instances, instance]
        : state.instances.map((item, index) => (index === existing ? instance : item))
    await write(file, {
      instances,
      lastInstanceID: instance.id,
    })
    return instances
  }

  async function remove(id: string) {
    const state = await read(file)
    const instances = state.instances.filter((item) => item.id !== id)
    await write(file, {
      instances,
      lastInstanceID: state.lastInstanceID === id ? instances[0]?.id : state.lastInstanceID,
    })
    return instances
  }

  async function setLast(id: string | undefined) {
    const state = await read(file)
    await write(file, {
      instances: state.instances,
      lastInstanceID: id,
    })
    return id
  }

  async function migrate(legacyFile: string) {
    const current = await read(file)
    if (current.instances.length > 0 || current.lastInstanceID) return current
    if (legacyFile === file) return current
    const legacy = await read(legacyFile)
    if (legacy.instances.length === 0 && !legacy.lastInstanceID) return current
    await write(file, legacy)
    return legacy
  }

  return {
    file,
    getLast,
    getState,
    list,
    migrate,
    remove,
    replace,
    save,
    setLast,
  }
}
