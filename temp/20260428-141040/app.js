const boardCanvas = document.getElementById("board")
const boardCtx = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextCtx = nextCanvas.getContext("2d")
const scoreEl = document.getElementById("score")
const levelEl = document.getElementById("level")
const linesEl = document.getElementById("lines")
const statusEl = document.getElementById("status")

const CELL_SIZE = 30
const COLUMNS = 10
const ROWS = 20
const colors = {
  0: "rgba(255,255,255,0.06)",
  1: "#00d4ff",
  2: "#ffd166",
  3: "#06d6a0",
  4: "#ef476f",
  5: "#118ab2",
  6: "#8338ec",
  7: "#ffbe0b",
}

const shapes = {
  I: [[1, 1, 1, 1]],
  O: [[2, 2], [2, 2]],
  T: [[0, 3, 0], [3, 3, 3]],
  S: [[0, 4, 4], [4, 4, 0]],
  Z: [[5, 5, 0], [0, 5, 5]],
  J: [[6, 0, 0], [6, 6, 6]],
  L: [[0, 0, 7], [7, 7, 7]],
}

const values = Object.values(shapes)

const emptyBoard = () =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => 0))

let board = emptyBoard()
let active = {
  matrix: pickShape(),
  pos: { x: 3, y: 0 },
}
let upcoming = pickShape()
let dropDelay = 1000
let dropCounter = 0
let level = 1
let lines = 0
let score = 0
let running = false
let gameOver = false
let lastTime = 0

function pickShape() {
  const shape = values[Math.floor(Math.random() * values.length)]
  return JSON.parse(JSON.stringify(shape))
}

function setMessage(message) {
  statusEl.textContent = message
}

function rotate(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]).reverse())
}

function collision(matrix, pos) {
  return matrix.some((row, y) =>
    row.some((value, x) => {
      if (!value) return false
      const boardX = x + pos.x
      const boardY = y + pos.y
      return (
        boardX < 0 ||
        boardX >= COLUMNS ||
        boardY >= ROWS ||
        (boardY >= 0 && board[boardY][boardX] !== 0)
      )
    }),
  )
}

function place() {
  active.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      const boardY = y + active.pos.y
      const boardX = x + active.pos.x
      if (boardY >= 0) board[boardY][boardX] = value
    }),
  )
}

function clearFullLines() {
  let cleared = 0

  for (let y = ROWS - 1; y >= 0; y -= 1) {
    if (board[y].every((cell) => cell !== 0)) {
      board.splice(y, 1)
      board.unshift(Array.from({ length: COLUMNS }, () => 0))
      cleared += 1
      y += 1
    }
  }

  if (!cleared) return 0

  lines += cleared
  linesEl.textContent = String(lines)
  const bonuses = {
    1: 40,
    2: 100,
    3: 300,
    4: 1200,
  }
  score += bonuses[cleared] * level
  scoreEl.textContent = String(score)

  level = Math.floor(lines / 10) + 1
  levelEl.textContent = String(level)
  dropDelay = Math.max(120, 1000 - level * 80)
  return cleared
}

function move(dx, dy) {
  const nextPos = { x: active.pos.x + dx, y: active.pos.y + dy }
  if (!collision(active.matrix, nextPos)) {
    active.pos = nextPos
    return true
  }
  return false
}

function rotateAndPlace() {
  const next = rotate(active.matrix)
  if (!collision(next, active.pos)) {
    active.matrix = next
    return
  }

  const offset = active.pos.x > COLUMNS / 2 ? -1 : 1
  if (!collision(next, { ...active.pos, x: active.pos.x + offset })) {
    active.pos.x += offset
    active.matrix = next
  }
}

function lockPiece() {
  place()
  clearFullLines()
  active = {
    matrix: upcoming,
    pos: { x: 3, y: 0 },
  }
  upcoming = pickShape()
  if (collision(active.matrix, active.pos)) {
    gameOver = true
    running = false
    setMessage("Game Over — press R to restart")
  }
}

function softDrop() {
  if (move(0, 1)) return
  lockPiece()
}

function hardDrop() {
  while (move(0, 1)) {
    score += 2
  }
  scoreEl.textContent = String(score)
  lockPiece()
}

function reset() {
  board = emptyBoard()
  active = { matrix: pickShape(), pos: { x: 3, y: 0 } }
  upcoming = pickShape()
  dropCounter = 0
  dropDelay = 1000
  level = 1
  lines = 0
  score = 0
  running = true
  gameOver = false
  scoreEl.textContent = "0"
  levelEl.textContent = "1"
  linesEl.textContent = "0"
  setMessage("")
}

function drawCell(context, x, y, value) {
  if (!value) return
  context.fillStyle = colors[value]
  context.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
  context.strokeStyle = "rgba(255,255,255,0.2)"
  context.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
}

function drawBoard() {
  boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardCtx.setTransform(1, 0, 0, 1, 0, 0)
  boardCtx.fillStyle = "#0b0f22"
  boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  board.forEach((row, y) =>
    row.forEach((value, x) => {
      boardCtx.fillStyle = colors[value]
      boardCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      boardCtx.strokeStyle = value ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"
      boardCtx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }),
  )

  boardCtx.setTransform(1, 0, 0, 1, 0, 0)
  active.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      const boardX = x + active.pos.x
      const boardY = y + active.pos.y
      if (!value || boardY < 0) return
      drawCell(boardCtx, boardX, boardY, value)
    }),
  )

  nextCtx.setTransform(1, 0, 0, 1, 0, 0)
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextCtx.fillStyle = "#0b0f22"
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height)
  upcoming.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      nextCtx.fillStyle = colors[value]
      nextCtx.fillRect((x + 1) * 24, (y + 1) * 24, 24, 24)
      nextCtx.strokeStyle = "rgba(255,255,255,0.2)"
      nextCtx.strokeRect((x + 1) * 24, (y + 1) * 24, 24, 24)
    }),
  )
}

function draw() {
  drawBoard()
  if (!running) {
    if (gameOver) return
    setMessage("Press any arrow key to start")
  }
}

function update(time = 0) {
  const delta = time - lastTime
  lastTime = time

  if (running && !gameOver) {
    dropCounter += delta
    if (dropCounter >= dropDelay) {
      softDrop()
      dropCounter = 0
    }
  }

  draw()
  requestAnimationFrame(update)
}

function startIfNeeded(event) {
  if (running || gameOver) return

  if (event.key === "r" || event.key === "R") {
    return
  }

  running = true
  setMessage("")
}

document.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") {
    reset()
    return
  }

  if (!running) {
    startIfNeeded(event)
  }

  if (gameOver) {
    event.preventDefault()
    return
  }

  const moves = {
    ArrowLeft: () => move(-1, 0),
    ArrowRight: () => move(1, 0),
    ArrowDown: () => softDrop(),
    ArrowUp: () => rotateAndPlace(),
    " ": () => hardDrop(),
  }

  const action = moves[event.key]
  if (!action) return
  event.preventDefault()
  action()
})

setMessage("Press any arrow key to start")
requestAnimationFrame(update)
