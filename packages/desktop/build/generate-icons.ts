import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const run = (cmd: string[]) => {
  const result = Bun.spawnSync({
    cmd,
    stderr: "pipe",
  })
  if (!result.exitCode) return
  throw new Error(new TextDecoder().decode(result.stderr).trim() || `${cmd[0]} failed`)
}

const renderPng = (input: string, output: string, size: number) =>
  run(["sips", "-s", "format", "png", "--resampleHeightWidth", `${size}`, `${size}`, input, "--out", output])

const renderPngScale = (input: string, output: string, width: number, height: number) =>
  run([
    "sips",
    "-s",
    "format",
    "png",
    "--resampleHeight",
    `${height}`,
    "--resampleWidth",
    `${width}`,
    input,
    "--out",
    output,
  ])

const buildIco = (images: { size: number; data: Buffer<ArrayBufferLike> }[]) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length + images.length * 16
  const entries = images.map((image) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 0)
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += image.data.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
}

const main = async () => {
  if (process.platform !== "darwin") throw new Error("Desktop icon generation currently requires macOS")
  const buildDir = import.meta.dir
  const svgPath = path.join(buildDir, "icon.svg")
  const dmgSvgPath = path.join(buildDir, "dmg-background.svg")
  const iconsetRoot = await mkdtemp(path.join(tmpdir(), "codeplane-iconset-"))
  const iconset = path.join(iconsetRoot, "icon.iconset")
  const pngPath = path.join(buildDir, "icon.png")
  const icnsPath = path.join(buildDir, "icon.icns")
  const icoPath = path.join(buildDir, "icon.ico")
  const dmgBgPath = path.join(buildDir, "dmg-background.png")
  const dmgBgRetinaPath = path.join(buildDir, "dmg-background@2x.png")
  const iconsetSizes = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ] as const
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  await mkdir(iconset)

  try {
    renderPng(svgPath, pngPath, 1024)
    iconsetSizes.forEach(([name, size]) => renderPng(svgPath, path.join(iconset, name), size))
    run(["iconutil", "-c", "icns", iconset, "-o", icnsPath])
    renderPngScale(dmgSvgPath, dmgBgPath, 540, 380)
    renderPngScale(dmgSvgPath, dmgBgRetinaPath, 1080, 760)
    const icoImages = await Promise.all(
      icoSizes.map(async (size) => {
        const output = path.join(iconsetRoot, `icon-${size}.png`)
        renderPng(svgPath, output, size)
        return {
          size,
          data: await readFile(output),
        }
      }),
    )
    await Bun.write(icoPath, buildIco(icoImages))
  } finally {
    await rm(iconsetRoot, { recursive: true, force: true })
  }
}

await main()
