const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const scoreEl = document.getElementById("score")
const levelEl = document.getElementById("level")
const linesEl = document.getElementById("lines")
const statusEl = document.getElementById("status")

const COLUMNS = 10
const ROWS = 20
const CELL = 30

const COLORS = [
  "rgba(255,255,255,0.06)",
  "#00b7ff",
  "#ffd166",
  "#06d6a0",
  "#ef476f",
  "#118ab2",
  "#8338ec",
  "#ffbe0b",
]

const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[2, 2], [2, 2]],
  T: [[0, 3, 0], [3, 3, 3]],
  S: [[0, 4, 4], [4, 4, 0]],
  Z: [[5, 5, 0], [0, 5, 5]],
  J: [[6, 0, 0], [6, 6, 6]],
  L: [[0, 0, 7], [7, 7, 7]],
}

const shapeList = Object.keys(SHAPES)
const linePoints = [0, 40, 100, 300, 1200]

let arena = createMatrix(COLUMNS, ROWS)
let bag = []
let piece = spawnPiece()
let next = spawnPiece()
let score = 0
let lines = 0
let level = 1
let dropTick = 0
let dropDelay = 900
let running = false
let paused = false
let gameOver = false
let lastTime = 0

function createMatrix(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(0))
}

function randomShapeType() {
  if (!bag.length) {
    bag = shapeList.slice().sort(() => Math.random() - 0.5)
  }
  return bag.pop()
}

function spawnPiece() {
  const matrix = SHAPES[randomShapeType()].map((row) => row.slice())
  return { matrix, position: { x: 3, y: -1 } }
}

function rotate(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]).reverse())
}

function collision(matrix, offsetX, offsetY) {
  return matrix.some((row, y) =>
    row.some((value, x) => {
      if (!value) return false
      const boardX = x + offsetX
      const boardY = y + offsetY
      return (
        boardX < 0 ||
        boardX >= COLUMNS ||
        boardY >= ROWS ||
        (boardY >= 0 && arena[boardY][boardX] !== 0)
      )
    }),
  )
}

function merge() {
  piece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      const boardX = x + piece.position.x
      const boardY = y + piece.position.y
      if (boardY >= 0) arena[boardY][boardX] = value
    }),
  )
}

function clearFullLines() {
  let cleared = 0
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (arena[row].every((cell) => cell !== 0)) {
      arena.splice(row, 1)
      arena.unshift(Array(COLUMNS).fill(0))
      cleared += 1
      row += 1
    }
  }

  if (!cleared) return 0

  lines += cleared
  score += linePoints[cleared] * level
  level = Math.floor(lines / 10) + 1
  dropDelay = Math.max(120, 900 - (level - 1) * 70)
  return cleared
}

function move(dx, dy) {
  const nextX = piece.position.x + dx
  const nextY = piece.position.y + dy
  if (!collision(piece.matrix, nextX, nextY)) {
    piece.position.x = nextX
    piece.position.y = nextY
    return true
  }
  return false
}

function rotateAndKick() {
  const rotated = rotate(piece.matrix)
  if (!collision(rotated, piece.position.x, piece.position.y)) {
    piece.matrix = rotated
    return
  }

  const leftKick = collision(rotated, piece.position.x - 1, piece.position.y)
  if (!leftKick) {
    piece.matrix = rotated
    piece.position.x -= 1
    return
  }

  if (!collision(rotated, piece.position.x + 1, piece.position.y)) {
    piece.matrix = rotated
    piece.position.x += 1
  }
}

function ghostY() {
  let testY = piece.position.y
  while (!collision(piece.matrix, piece.position.x, testY + 1)) {
    testY += 1
  }
  return testY
}

function softDrop() {
  if (move(0, 1)) {
    score += 1
    scoreEl.textContent = String(score)
    return
  }
  lockPiece()
}

function hardDrop() {
  const targetY = ghostY()
  const dropped = targetY - piece.position.y
  piece.position.y = targetY
  score += dropped * 2
  scoreEl.textContent = String(score)
  lockPiece()
}

function lockPiece() {
  merge()
  const cleared = clearFullLines()

  if (cleared > 0) {
    scoreEl.textContent = String(score)
    linesEl.textContent = String(lines)
    levelEl.textContent = String(level)
  }

  piece = next
  next = spawnPiece()

  if (collision(piece.matrix, piece.position.x, piece.position.y)) {
    gameOver = true
    running = false
    statusEl.textContent = "Game Over — press R to restart"
  }
}

function reset() {
  arena = createMatrix(COLUMNS, ROWS)
  bag = []
  piece = spawnPiece()
  next = spawnPiece()
  score = 0
  lines = 0
  level = 1
  dropDelay = 900
  dropTick = 0
  running = true
  paused = false
  gameOver = false
  statusEl.textContent = ""
  scoreEl.textContent = "0"
  levelEl.textContent = "1"
  linesEl.textContent = "0"
}

function drawCell(context, x, y, value, alpha = 1) {
  if (!value) return
  context.globalAlpha = alpha
  context.fillStyle = COLORS[value]
  context.fillRect(x * CELL, y * CELL, CELL, CELL)
  context.strokeStyle = "rgba(255,255,255,0.22)"
  context.strokeRect(x * CELL, y * CELL, CELL, CELL)
  context.globalAlpha = 1
}

function drawBoard() {
  boardContext.setTransform(1, 0, 0, 1, 0, 0)
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = "#0f1830"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  arena.forEach((row, y) =>
    row.forEach((value, x) => {
      boardContext.fillStyle = COLORS[value]
      boardContext.fillRect(x * CELL, y * CELL, CELL, CELL)
      boardContext.strokeStyle = value ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"
      boardContext.strokeRect(x * CELL, y * CELL, CELL, CELL)
    }),
  )

  const ghostRow = ghostY()
  piece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      const boardX = x + piece.position.x
      const boardY = y + piece.position.y
      if (boardY >= 0) drawCell(boardContext, boardX, boardY, value)

      const ghostX = boardX
      const projectedY = y + ghostRow
      if (projectedY !== boardY) {
        drawCell(
          boardContext,
          ghostX,
          projectedY,
          value,
          0.2,
        )
      }
    }),
  )

  nextContext.setTransform(1, 0, 0, 1, 0, 0)
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextContext.fillStyle = "#0f1830"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  next.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      nextContext.fillStyle = COLORS[value]
      nextContext.fillRect((x + 1) * 24, (y + 1) * 24, 24, 24)
      nextContext.strokeStyle = "rgba(255,255,255,0.2)"
      nextContext.strokeRect((x + 1) * 24, (y + 1) * 24, 24, 24)
    }),
  )
}

function draw() {
  drawBoard()
  if (gameOver || paused || !running) {
    if (gameOver) return
    if (running && paused) {
      statusEl.textContent = "Paused — press P to continue"
      return
    }
    statusEl.textContent = "Press an arrow key or Space to start"
    return
  }

  statusEl.textContent = ""
}

function update(time = 0) {
  const delta = time - lastTime
  lastTime = time

  if (running && !gameOver && !paused) {
    dropTick += delta
    if (dropTick > dropDelay) {
      softDrop()
      dropTick = 0
    }
  }

  draw()
  requestAnimationFrame(update)
}

document.addEventListener("keydown", (event) => {
  const shouldStart = !running && !gameOver

  if (event.key === "r" || event.key === "R") {
    reset()
    return
  }

  if (event.key === "p" || event.key === "P") {
    if (running) {
      paused = !paused
      if (!paused) statusEl.textContent = ""
      else statusEl.textContent = "Paused — press P to continue"
    }
    return
  }

  if (!running) {
    if (event.key.startsWith("Arrow") || event.key === " ") {
      running = true
      statusEl.textContent = ""
    } else {
      return
    }
  }

  if (gameOver || paused) return

  const actions = {
    ArrowLeft: () => move(-1, 0),
    ArrowRight: () => move(1, 0),
    ArrowDown: () => softDrop(),
    ArrowUp: () => rotateAndKick(),
    " ": () => hardDrop(),
  }

  const action = actions[event.key]
  if (!action) return

  event.preventDefault()
  action()
  dropTick = 0
  draw()
})

statusEl.textContent = "Press an arrow key or Space to start"
requestAnimationFrame(update)
