// TUI-local barrel for filesystem. Provides both styles:
//   import { Filesystem } from "@/tui/_compat/filesystem"
//   import * as Filesystem from "@/tui/_compat/filesystem"
// Also re-exports AppFileSystem (Effect-based service) sourced from
// _compat/app-filesystem.ts.
export * from "@/util/filesystem"
export { AppFileSystem } from "@/tui/_compat/app-filesystem"
import * as FsImpl from "@/util/filesystem"

export const Filesystem = {
  exists: FsImpl.exists,
  isDir: FsImpl.isDir,
  stat: FsImpl.stat,
  statAsync: FsImpl.statAsync,
  size: FsImpl.size,
  readText: FsImpl.readText,
  readJson: FsImpl.readJson,
  readBytes: FsImpl.readBytes,
  readArrayBuffer: FsImpl.readArrayBuffer,
  write: FsImpl.write,
  writeJson: FsImpl.writeJson,
  writeStream: FsImpl.writeStream,
  mimeType: FsImpl.mimeType,
  normalizePath: FsImpl.normalizePath,
  normalizePathPattern: FsImpl.normalizePathPattern,
  resolve: FsImpl.resolve,
  windowsPath: FsImpl.windowsPath,
  overlaps: FsImpl.overlaps,
  contains: FsImpl.contains,
  findUp: FsImpl.findUp,
  up: FsImpl.up,
  globUp: FsImpl.globUp,
} as const
