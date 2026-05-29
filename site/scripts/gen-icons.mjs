/*
 * Regenerates the favicon raster set + the social OG image from the two
 * source SVGs in /public:
 *   favicon.svg → favicon.ico (16/32/48), icon-192.png, icon-512.png,
 *                 apple-touch-icon.png (180)
 *   og.svg      → og.png (1200×630)
 *
 * Run after editing either source:  bun run scripts/gen-icons.mjs
 * Uses sharp (already present as a Next dependency).
 */
import sharp from "sharp"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const pub = join(process.cwd(), "public")
const favSvg = readFileSync(join(pub, "favicon.svg"))
const ogSvg = readFileSync(join(pub, "og.svg"))

// High density base render → crisp downscales at every size.
function renderSquare(svg, size) {
  return sharp(svg, { density: 384 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
}

function packIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const bodies = []
  images.forEach((img, i) => {
    const e = i * 16
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0) // width
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1) // height
    dir.writeUInt8(0, e + 2) // palette
    dir.writeUInt8(0, e + 3) // reserved
    dir.writeUInt16LE(1, e + 4) // color planes
    dir.writeUInt16LE(32, e + 6) // bits per pixel
    dir.writeUInt32LE(img.buf.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += img.buf.length
    bodies.push(img.buf)
  })
  return Buffer.concat([header, dir, ...bodies])
}

async function main() {
  writeFileSync(join(pub, "icon-192.png"), await renderSquare(favSvg, 192))
  writeFileSync(join(pub, "icon-512.png"), await renderSquare(favSvg, 512))
  writeFileSync(join(pub, "apple-touch-icon.png"), await renderSquare(favSvg, 180))

  const icoImgs = []
  for (const size of [16, 32, 48]) icoImgs.push({ size, buf: await renderSquare(favSvg, size) })
  writeFileSync(join(pub, "favicon.ico"), packIco(icoImgs))

  writeFileSync(
    join(pub, "og.png"),
    await sharp(ogSvg, { density: 144 }).resize(1200, 630).png().toBuffer(),
  )

  console.log("icons + og.png regenerated")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
