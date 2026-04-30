const boardCanvas = document.getElementById("board")
const nextCanvas = document.getElementById("next")
const scoreOutput = document.getElementById("score")
const linesOutput = document.getElementById("lines")
const levelOutput = document.getElementById("level")
const restartButton = document.getElementById("restart")
const boardContext = boardCanvas.getContext("2d")
const nextContext = nextCanvas.getContext("2d")

const columns = 10
const rows = 20
const block = 30
const fallStart = 900

const shapes = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
}

const colors = {
  I: "#38bdf8",
  J: "#60a5fa",
  L: "#fb923c",
  O: "#facc15",
  S: "#4ade80",
  T: "#c084fc",
  Z: "#f87171",
}

const makeBoard = () =>
  Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))

const randomKey = () => {
  const keys = Object.keys(shapes)
  return keys[Math.floor(Math.random() * keys.length)]
}

const copy = (matrix) => matrix.map((row) => [...row])

const rotate = (matrix) => matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())

let board = makeBoard()
let active = null
let next = null
let score = 0
let lines = 0
let level = 1
let pause = false
let over = false
let dropTimer = 0
let lastTime = 0
let fallDelay = fallStart
let frame = null

function newPiece() {
  const key = randomKey()
  return {
    key,
    cells: copy(shapes[key]),
    color: colors[key],
    x: Math.floor(columns / 2) - Math.ceil(shapes[key][0].length / 2),
    y: -2,
  }
}

function collides(dx = 0, dy = 0, matrix = active.cells) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue

      const nextX = active.x + x + dx
      const nextY = active.y + y + dy

      if (nextX < 0 || nextX >= columns || nextY >= rows) return true
      if (nextY < 0) continue
      if (board[nextY][nextX]) return true
    }
  }

  return false
}

function lockPiece() {
  active.cells.forEach((row, y) => {
    row.forEach((filled, x) => {
      if (!filled) return
      if (active.y + y < 0) return
      board[active.y + y][active.x + x] = active.color
    })
  })
}

function clearLines() {
  let cleared = 0

  for (let y = rows - 1; y >= 0; ) {
    if (!board[y].every(Boolean)) {
      y--
      continue
    }

    board.splice(y, 1)
    board.unshift(Array.from({ length: columns }, () => 0))
    cleared++
  }

  if (!cleared) return

  const reward = [0, 100, 300, 500, 800][Math.min(4, cleared)] * level

  score += reward
  lines += cleared
  level = Math.floor(lines / 10) + 1
  fallDelay = Math.max(140, fallStart - (level - 1) * 70)

  scoreOutput.textContent = String(score)
  linesOutput.textContent = String(lines)
  levelOutput.textContent = String(level)
}

function spawn() {
  if (!next) next = newPiece()

  active = {
    key: next.key,
    cells: next.cells,
    color: next.color,
    x: next.x,
    y: next.y,
  }

  next = newPiece()
  renderNext()

  if (collides()) {
    over = true
    cancelAnimationFrame(frame)
  }
}

function movePiece(dx, dy) {
  if (over || pause) return

  active.x += dx
  active.y += dy

  if (!collides()) return

  active.x -= dx
  active.y -= dy

  if (!dy) return

  lockPiece()
  clearLines()
  spawn()
}

function spin() {
  if (over || pause) return

  const original = active.cells
  active.cells = rotate(active.cells)

  if (!collides()) return

  let nudge = 1

  while (collides(nudge, 0)) {
    nudge = nudge > 0 ? -(nudge + 1) : -(nudge - 1)
    if (Math.abs(nudge) > original[0].length) {
      active.cells = original
      return
    }
  }

  active.x += nudge
}

function hardDrop() {
  while (!collides(0, 1)) {
    active.y++
    score += 2
  }

  scoreOutput.textContent = String(score)
  lockPiece()
  clearLines()
  spawn()
}

function drawCell(ctx, x, y, color) {
  const left = x * block
  const top = y * block

  ctx.fillStyle = color
  ctx.fillRect(left, top, block, block)
  ctx.fillStyle = "rgba(255,255,255,0.2)"
  ctx.fillRect(left + 4, top + 4, block - 8, 4)
  ctx.strokeStyle = "rgba(255,255,255,0.15)"
  ctx.strokeRect(left + 1, top + 1, block - 2, block - 2)
}

function renderBoard() {
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = "#020714"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  board.forEach((row, y) => {
    row.forEach((color, x) => {
      if (!color) return
      drawCell(boardContext, x, y, color)
    })
  })

  active.cells.forEach((row, y) => {
    row.forEach((filled, x) => {
      if (!filled) return
      const boardY = active.y + y
      const boardX = active.x + x
      if (boardY < 0) return
      drawCell(boardContext, boardX, boardY, active.color)
    })
  })

  if (!over) return

  boardContext.fillStyle = "rgba(3, 8, 30, 0.84)"
  boardContext.fillRect(0, 270, 300, 80)
  boardContext.fillStyle = "#f8fafc"
  boardContext.textAlign = "center"
  boardContext.font = "28px Trebuchet MS"
  boardContext.fillText("GAME OVER", 150, 308)
  boardContext.font = "14px Trebuchet MS"
  boardContext.fillText("Press R to restart", 150, 332)
}

function renderNext() {
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextContext.fillStyle = "rgba(5, 11, 29, 0.9)"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  if (!next) return

  const scale = 22
  const offsetX = (nextCanvas.width - next.cells[0].length * scale) / 2
  const offsetY = (nextCanvas.height - next.cells.length * scale) / 2

  next.cells.forEach((row, y) => {
    row.forEach((filled, x) => {
      if (!filled) return
      const left = offsetX + x * scale
      const top = offsetY + y * scale

      nextContext.fillStyle = next.color
      nextContext.fillRect(left, top, scale, scale)
      nextContext.fillStyle = "rgba(255,255,255,0.2)"
      nextContext.fillRect(left + 3, top + 3, scale - 6, 3)
      nextContext.strokeStyle = "rgba(255,255,255,0.12)"
      nextContext.strokeRect(left + 1, top + 1, scale - 2, scale - 2)
    })
  })
}

function loop(time = 0) {
  const dt = time - lastTime
  lastTime = time
  dropTimer += dt

  if (!over && !pause && dropTimer >= fallDelay) {
    movePiece(0, 1)
    dropTimer = 0
  }

  renderBoard()
  if (!over) frame = requestAnimationFrame(loop)
}

function reset() {
  cancelAnimationFrame(frame)
  board = makeBoard()
  score = 0
  lines = 0
  level = 1
  fallDelay = fallStart
  dropTimer = 0
  lastTime = 0
  over = false
  pause = false
  next = null

  scoreOutput.textContent = "0"
  linesOutput.textContent = "0"
  levelOutput.textContent = "1"

  spawn()
  frame = requestAnimationFrame(loop)
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyR") {
    reset()
    return
  }

  if (event.code === "KeyP" && !over) {
    pause = !pause
    if (!pause) {
      frame = requestAnimationFrame(loop)
    } else {
      cancelAnimationFrame(frame)
    }
    return
  }

  if (over || pause) return

  if (event.code === "ArrowLeft") {
    event.preventDefault()
    movePiece(-1, 0)
  }

  if (event.code === "ArrowRight") {
    event.preventDefault()
    movePiece(1, 0)
  }

  if (event.code === "ArrowDown") {
    event.preventDefault()
    movePiece(0, 1)
  }

  if (event.code === "ArrowUp") {
    event.preventDefault()
    spin()
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

restartButton.addEventListener("click", reset)

spawn()
frame = requestAnimationFrame(loop)
