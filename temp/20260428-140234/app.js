const board = document.getElementById("board")
const boardCtx = board.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextCtx = nextCanvas.getContext("2d")
const scoreNode = document.getElementById("score")
const linesNode = document.getElementById("lines")
const levelNode = document.getElementById("level")
const restartButton = document.getElementById("restart")

const COLS = 10
const ROWS = 20
const CELL = 30
const BASE_INTERVAL = 850

const SHAPES = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
}

const COLORS = {
  I: "#38bdf8",
  J: "#60a5fa",
  L: "#f97316",
  O: "#facc15",
  S: "#22c55e",
  T: "#c084fc",
  Z: "#f43f5e",
}

let field
let piece
let queue
let score
let clearedLines
let level
let dropInterval
let over
let paused
let accumulator
let lastFrame
let raf

const emptyRow = () => Array.from({ length: COLS }, () => 0)
const clearField = () => Array.from({ length: ROWS }, emptyRow)
const cloneMatrix = (matrix) => matrix.map((row) => [...row])

function randomPiece() {
  const names = Object.keys(SHAPES)
  const pick = names[Math.floor(Math.random() * names.length)]
  return {
    name: pick,
    matrix: cloneMatrix(SHAPES[pick]),
    color: COLORS[pick],
  }
}

function rotate(matrix) {
  return matrix[0].map((_, c) => matrix.map((row) => row[c]).reverse())
}

function collides(pieceX, pieceY, matrix = piece.matrix) {
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row].length; col++) {
      if (!matrix[row][col]) continue

      const x = pieceX + col
      const y = pieceY + row

      if (x < 0 || x >= COLS || y >= ROWS) return true
      if (y < 0) continue
      if (field[y][x]) return true
    }
  }

  return false
}

function lockPiece() {
  piece.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell || piece.y + y < 0) return
      field[piece.y + y][piece.x + x] = piece.color
    })
  })
}

function dropLineCheck() {
  let done = 0

  for (let y = ROWS - 1; y >= 0; ) {
    const full = field[y].every(Boolean)

    if (!full) {
      y--
      continue
    }

    field.splice(y, 1)
    field.unshift(emptyRow())
    done++
  }

  if (!done) return

  const rewards = [0, 100, 300, 500, 800]
  score += rewards[Math.min(done, rewards.length - 1)] * level
  clearedLines += done
  level = Math.floor(clearedLines / 10) + 1
  dropInterval = Math.max(130, BASE_INTERVAL - (level - 1) * 65)
  scoreNode.textContent = String(score)
  linesNode.textContent = String(clearedLines)
  levelNode.textContent = String(level)
}

function move(dx, dy) {
  if (over || paused) return

  const nextX = piece.x + dx
  const nextY = piece.y + dy

  if (!collides(nextX, nextY)) {
    piece.x = nextX
    piece.y = nextY
    return
  }

  if (!dy) return

  lockPiece()
  dropLineCheck()
  spawnPiece()
}

function rotateCurrent() {
  if (over || paused) return

  const previousMatrix = piece.matrix
  const nextMatrix = rotate(previousMatrix)
  const previousX = piece.x
  const nudgeOrder = [0, -1, 1, -2, 2]
  piece.matrix = nextMatrix

  const moved = nudgeOrder.some((nudge) => {
    const targetX = previousX + nudge
    if (!collides(targetX, piece.y, nextMatrix)) {
      piece.x = targetX
      return true
    }

    return false
  })

  if (moved) return

  piece.matrix = previousMatrix
  piece.x = previousX
}

function hardDrop() {
  if (over || paused) return

  while (!collides(piece.x, piece.y + 1)) {
    piece.y += 1
    score += 2
  }

  scoreNode.textContent = String(score)
  move(0, 1)
}

function spawnPiece() {
  if (!queue) queue = randomPiece()

  piece = {
    x: Math.floor(COLS / 2) - Math.ceil(queue.matrix[0].length / 2),
    y: 0,
    matrix: queue.matrix,
    color: queue.color,
    name: queue.name,
  }

  queue = randomPiece()
  drawQueue()

  if (collides(piece.x, piece.y)) {
    over = true
    paused = true
  }
}

function drawCell(x, y, color) {
  const px = x * CELL
  const py = y * CELL
  boardCtx.fillStyle = color
  boardCtx.fillRect(px, py, CELL, CELL)
  boardCtx.fillStyle = "rgba(255,255,255,0.2)"
  boardCtx.fillRect(px + 4, py + 4, CELL - 8, 3)
  boardCtx.strokeStyle = "rgba(255,255,255,0.1)"
  boardCtx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2)
}

function drawBoard() {
  boardCtx.fillStyle = "#020617"
  boardCtx.fillRect(0, 0, board.width, board.height)

  field.forEach((row, y) => {
    row.forEach((color, x) => {
      if (!color) return
      drawCell(x, y, color)
    })
  })

  piece.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return
      const targetX = piece.x + x
      const targetY = piece.y + y
      if (targetY < 0) return
      drawCell(targetX, targetY, piece.color)
    })
  })

  if (!over) return

  boardCtx.fillStyle = "rgba(2, 6, 23, 0.8)"
  boardCtx.fillRect(0, ROWS * CELL * 0.45, COLS * CELL, 120)
  boardCtx.fillStyle = "#f8fafc"
  boardCtx.textAlign = "center"
  boardCtx.font = "bold 28px sans-serif"
  boardCtx.fillText("GAME OVER", (COLS * CELL) / 2, ROWS * CELL * 0.54)
  boardCtx.font = "14px sans-serif"
  boardCtx.fillText("Press R to restart", (COLS * CELL) / 2, ROWS * CELL * 0.66)
}

function drawQueue() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextCtx.fillStyle = "rgba(2,6,23,0.7)"
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  if (!queue) return

  const preview = queue.matrix
  const offsetX = 2
  const offsetY = 2
  const size = 24

  preview.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return
      const px = x * size + offsetX
      const py = y * size + offsetY
      nextCtx.fillStyle = queue.color
      nextCtx.fillRect(px, py, size, size)
    })
  })
}

function gameLoop(time = 0) {
  const delta = time - lastFrame
  lastFrame = time
  accumulator += delta

  if (!over && !paused && accumulator > dropInterval) {
    move(0, 1)
    accumulator = 0
  }

  drawBoard()
  raf = requestAnimationFrame(gameLoop)
}

function reset() {
  field = clearField()
  queue = null
  score = 0
  clearedLines = 0
  level = 1
  dropInterval = BASE_INTERVAL
  over = false
  paused = false
  accumulator = 0
  lastFrame = 0
  scoreNode.textContent = "0"
  linesNode.textContent = "0"
  levelNode.textContent = "1"
  spawnPiece()
  cancelAnimationFrame(raf)
  requestAnimationFrame(gameLoop)
}

function handleControls(event) {
  if (over && event.code !== "KeyR") return

  if (event.code === "ArrowLeft") {
    event.preventDefault()
    move(-1, 0)
    return
  }

  if (event.code === "ArrowRight") {
    event.preventDefault()
    move(1, 0)
    return
  }

  if (event.code === "ArrowDown") {
    event.preventDefault()
    move(0, 1)
    return
  }

  if (event.code === "ArrowUp") {
    event.preventDefault()
    rotateCurrent()
    return
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
    return
  }

  if (event.code === "KeyR") {
    reset()
    return
  }

  if (event.code === "KeyP") {
    event.preventDefault()
    paused = !paused
  }
}

document.addEventListener("keydown", handleControls)
restartButton.addEventListener("click", reset)

field = clearField()
reset()
