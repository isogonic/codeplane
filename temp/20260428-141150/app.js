const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const scoreNode = document.getElementById("score")
const linesNode = document.getElementById("lines")
const levelNode = document.getElementById("level")
const statusNode = document.getElementById("status")
const pauseButton = document.getElementById("pause")
const restartButton = document.getElementById("restart")

const CELL = 30
const COLUMNS = 10
const ROWS = 20

const SHAPES = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[2, 2], [2, 2]],
  S: [[0, 2, 2], [2, 2, 0]],
  T: [[0, 3, 0], [3, 3, 3]],
  Z: [[4, 4, 0], [0, 4, 4]],
}

const COLORS = [
  "#0a1025",
  "#5eead4",
  "#93c5fd",
  "#f59e0b",
  "#f87171",
  "#a78bfa",
  "#4ade80",
  "#f472b6",
]

const SCORE_BY_LINES = [0, 100, 300, 500, 800]

const shapeNames = Object.keys(SHAPES)

let arena = buildArena()
let bag = []
let activePiece
let nextPiece
let score = 0
let lines = 0
let level = 1
let dropDelay = 900
let dropProgress = 0
let lastTime = 0
let frameId
let running = false
let paused = false
let gameOver = false

function buildArena() {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => 0))
}

function pickType() {
  if (!bag.length) {
    bag = shapeNames.slice().sort(() => Math.random() - 0.5)
  }

  return bag.pop()
}

function createPiece(matrixName) {
  return {
    matrix: SHAPES[matrixName].map((row) => [...row]),
    pos: { x: Math.floor(COLUMNS / 2) - Math.ceil(SHAPES[matrixName][0].length / 2), y: -1 },
  }
}

function nextType() {
  return createPiece(pickType())
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function intersects(matrix, x, y) {
  return matrix.some((row, rowIndex) =>
    row.some((value, columnIndex) => {
      if (!value) return false

      const boardX = x + columnIndex
      const boardY = y + rowIndex

      if (boardX < 0 || boardX >= COLUMNS || boardY >= ROWS) return true
      if (boardY < 0) return false

      return arena[boardY][boardX] !== 0
    }),
  )
}

function resetPiece() {
  if (!nextPiece) nextPiece = nextType()

  activePiece = {
    matrix: nextPiece.matrix,
    pos: { ...nextPiece.pos },
  }
  nextPiece = nextType()

  if (intersects(activePiece.matrix, activePiece.pos.x, activePiece.pos.y)) {
    gameOver = true
    running = false
    statusNode.textContent = "Game over — press R to restart"
  }
}

function move(dx, dy) {
  if (!running || gameOver || paused) return

  const nextX = activePiece.pos.x + dx
  const nextY = activePiece.pos.y + dy

  if (!intersects(activePiece.matrix, nextX, nextY)) {
    activePiece.pos.x = nextX
    activePiece.pos.y = nextY
    return true
  }

  return false
}

function kickRotate() {
  if (!running || gameOver || paused) return

  const rotated = rotate(activePiece.matrix)
  if (!intersects(rotated, activePiece.pos.x, activePiece.pos.y)) {
    activePiece.matrix = rotated
    return
  }

  if (!intersects(rotated, activePiece.pos.x - 1, activePiece.pos.y)) {
    activePiece.pos.x -= 1
    activePiece.matrix = rotated
    return
  }

  if (!intersects(rotated, activePiece.pos.x + 1, activePiece.pos.y)) {
    activePiece.pos.x += 1
    activePiece.matrix = rotated
  }
}

function freezePiece() {
  activePiece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      const targetY = activePiece.pos.y + y
      const targetX = activePiece.pos.x + x
      if (targetY >= 0) {
        arena[targetY][targetX] = value
      }
    }),
  )

  const cleared = clearLines()
  if (cleared) {
    score += SCORE_BY_LINES[cleared] * level
    lines += cleared
    level = Math.floor(lines / 10) + 1
    dropDelay = Math.max(140, 900 - (level - 1) * 70)

    scoreNode.textContent = String(score)
    linesNode.textContent = String(lines)
    levelNode.textContent = String(level)
  }

  resetPiece()
}

function clearLines() {
  let count = 0
  for (let row = ROWS - 1; row >= 0; row--) {
    if (!arena[row].every((cell) => cell !== 0)) continue

    arena.splice(row, 1)
    arena.unshift(Array.from({ length: COLUMNS }, () => 0))
    count += 1
    row += 1
  }

  return count
}

function ghostRow() {
  let y = activePiece.pos.y
  while (!intersects(activePiece.matrix, activePiece.pos.x, y + 1)) {
    y += 1
  }

  return y
}

function hardDrop() {
  const targetY = ghostRow()
  const distance = targetY - activePiece.pos.y
  activePiece.pos.y = targetY
  score += distance * 2
  scoreNode.textContent = String(score)
  dropProgress = 0
  handleLanding()
}

function softDrop() {
  const moved = move(0, 1)
  if (moved) {
    score += 1
    scoreNode.textContent = String(score)
    return
  }

  handleLanding()
}

function handleLanding() {
  freezePiece()
  dropProgress = 0
  if (gameOver) {
    running = false
    statusNode.textContent = "Game over — press R to restart"
  }
}

function drawCell(context, x, y, value, alpha = 1) {
  if (!value) return

  context.globalAlpha = alpha
  context.fillStyle = COLORS[value]
  context.fillRect(x * CELL, y * CELL, CELL, CELL)
  context.strokeStyle = "rgba(255, 255, 255, 0.2)"
  context.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
  context.globalAlpha = 1
}

function draw() {
  boardContext.setTransform(1, 0, 0, 1, 0, 0)
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = "#0d1630"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  arena.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      boardContext.fillStyle = COLORS[value]
      boardContext.fillRect(x * CELL, y * CELL, CELL, CELL)
      boardContext.strokeStyle = "rgba(255,255,255,0.1)"
      boardContext.strokeRect(x * CELL, y * CELL, CELL, CELL)
    }),
  )

  const projection = ghostRow()
  activePiece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return

      const boardX = activePiece.pos.x + x
      const boardY = activePiece.pos.y + y
      const ghostY = projection + y

      if (boardY >= 0) drawCell(boardContext, boardX, boardY, value)
      if (ghostY !== boardY) drawCell(boardContext, boardX, ghostY, value, 0.28)
    }),
  )

  nextContext.setTransform(1, 0, 0, 1, 0, 0)
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextContext.fillStyle = "#0d1630"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  nextPiece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      nextContext.fillStyle = COLORS[value]
      nextContext.fillRect((x + 1) * 24, (y + 1) * 24, 24, 24)
      nextContext.strokeStyle = "rgba(255,255,255,0.22)"
      nextContext.strokeRect((x + 1) * 24, (y + 1) * 24, 24, 24)
    }),
  )

  if (gameOver) {
    boardContext.fillStyle = "rgba(2, 8, 24, 0.8)"
    boardContext.fillRect(0, rowsMiddle(), 300, 120)
    boardContext.fillStyle = "#e9f0ff"
    boardContext.textAlign = "center"
    boardContext.font = "24px Trebuchet MS"
    boardContext.fillText("GAME OVER", COLUMNS * CELL / 2, ROWS * CELL / 2)
  }
}

function rowsMiddle() {
  return ROWS * CELL / 2 - 60
}

function update(time = 0) {
  const delta = time - lastTime
  lastTime = time

  if (running && !paused && !gameOver) {
    dropProgress += delta
    if (dropProgress >= dropDelay) {
      softDrop()
      dropProgress = 0
    }
  }

  if (!gameOver && !running && !statusNode.textContent.includes("Game over")) {
    statusNode.textContent = "Press an arrow key or Space to start"
  }

  if (paused && running && !gameOver) {
    statusNode.textContent = "Paused — press P to continue"
  }

  if (running && !gameOver && !paused) {
    statusNode.textContent = ""
  }

  draw()
  frameId = requestAnimationFrame(update)
}

function start() {
  if (running || gameOver) return

  running = true
  paused = false
  statusNode.textContent = ""
}

function restart() {
  if (frameId) cancelAnimationFrame(frameId)

  arena = buildArena()
  bag = []
  activePiece = null
  nextPiece = null
  score = 0
  lines = 0
  level = 1
  dropDelay = 900
  dropProgress = 0
  lastTime = 0
  running = false
  paused = false
  gameOver = false

  scoreNode.textContent = "0"
  linesNode.textContent = "0"
  levelNode.textContent = "1"
  statusNode.textContent = "Press an arrow key or Space to start"

  resetPiece()
  frameId = requestAnimationFrame(update)
}

document.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") {
    restart()
    return
  }

  if (event.key === "p" || event.key === "P") {
    if (!running || gameOver) return
    paused = !paused
    statusNode.textContent = paused ? "Paused — press P to continue" : ""
    return
  }

  if (!running) {
    if (event.key.startsWith("Arrow") || event.key === " ") {
      event.preventDefault()
      start()
    } else {
      return
    }
  }

  if (!running || paused || gameOver) return

  if (event.key === "ArrowLeft") {
    event.preventDefault()
    move(-1, 0)
  }

  if (event.key === "ArrowRight") {
    event.preventDefault()
    move(1, 0)
  }

  if (event.key === "ArrowDown") {
    event.preventDefault()
    softDrop()
  }

  if (event.key === "ArrowUp") {
    event.preventDefault()
    kickRotate()
  }

  if (event.key === " ") {
    event.preventDefault()
    hardDrop()
  }
})

pauseButton.addEventListener("click", () => {
  if (!running || gameOver) return
  paused = !paused
  statusNode.textContent = paused ? "Paused — press P to continue" : ""
})

restartButton.addEventListener("click", restart)

resetPiece()
statusNode.textContent = "Press an arrow key or Space to start"
frameId = requestAnimationFrame(update)
