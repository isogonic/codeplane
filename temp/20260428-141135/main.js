const COLS = 10
const ROWS = 20
const CELL = 30
const INITIAL_DROP_MS = 780
const MIN_DROP_MS = 120

const colors = [
  "#171d2b",
  "#26f4ff",
  "#2a7dff",
  "#d64eff",
  "#ffcc29",
  "#ff7a00",
  "#00dd9f",
  "#f04f7d",
]

const shapes = {
  I: [[1, 1, 1, 1]],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
}

const boardCanvas = document.getElementById("board")
const nextCanvas = document.getElementById("next")
const scoreOutput = document.getElementById("score")
const linesOutput = document.getElementById("lines")
const levelOutput = document.getElementById("level")
const restartButton = document.getElementById("restart")
const boardCtx = boardCanvas.getContext("2d")
const nextCtx = nextCanvas.getContext("2d")
boardCtx.imageSmoothingEnabled = false
nextCtx.imageSmoothingEnabled = false

let board
let piece
let nextPiece
let score
let lines
let level
let dropMs
let dropAccumulator
let lastTime
let paused
let gameOver

function cloneMatrix(matrix) {
  return matrix.map((row) => row.slice())
}

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0))
}

function randomShapeKey() {
  const keys = Object.keys(shapes)
  return keys[(Math.random() * keys.length) | 0]
}

function makePiece(type) {
  const color = (Object.keys(shapes).indexOf(type) % 7) + 1
  return {
    type,
    matrix: cloneMatrix(shapes[type]),
    x: Math.floor((COLS - shapes[type][0].length) / 2),
    y: 0,
    color,
  }
}

function rotate(matrix) {
  const rows = matrix.length
  const cols = matrix[0].length
  return Array.from({ length: cols }, (_, x) =>
    Array.from({ length: rows }, (_, y) => matrix[rows - 1 - y][x]),
  )
}

function intersects(dx = 0, dy = 0) {
  return piece.matrix.some((row, y) =>
    row.some((cell, x) =>
      cell !== 0 &&
      (board[y + piece.y + dy]?.[x + piece.x + dx] === undefined ||
        x + piece.x + dx < 0 ||
        x + piece.x + dx >= COLS ||
        y + piece.y + dy >= ROWS ||
        board[y + piece.y + dy]?.[x + piece.x + dx] !== 0),
    ),
  )
}

function commitPiece() {
  piece.matrix.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (cell !== 0) board[piece.y + y][piece.x + x] = piece.color
    }),
  )
}

function clearLines() {
  let cleared = 0
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row].every((cell) => cell !== 0)) {
      board.splice(row, 1)
      board.unshift(Array(COLS).fill(0))
      cleared += 1
      row += 1
    }
  }
  return cleared
}

function stepPiece() {
  if (intersects(0, 1)) {
    commitPiece()
    const cleared = clearLines()
    if (cleared) {
      lines += cleared
      score += [0, 40, 100, 300, 1200][cleared] * level
      level = 1 + Math.floor(lines / 10)
      dropMs = Math.max(MIN_DROP_MS, INITIAL_DROP_MS - (level - 1) * 60)
    }

    piece = nextPiece
    nextPiece = makePiece(randomShapeKey())
    if (intersects(0, 0)) {
      gameOver = true
      return
    }
    return
  }

  piece.y += 1
}

function hardDrop() {
  let distance = 0
  while (!intersects(0, 1)) {
    piece.y += 1
    distance += 1
  }
  score += distance * 2
  stepPiece()
}

function moveLeft() {
  if (!intersects(-1, 0)) piece.x -= 1
}

function moveRight() {
  if (!intersects(1, 0)) piece.x += 1
}

function moveDown() {
  if (!gameOver) stepPiece()
}

function rotatePiece() {
  const original = piece.matrix
  const rotated = rotate(piece.matrix)
  piece.matrix = rotated

  const offsets = [0, -1, 1, -2, 2]
  const startX = piece.x
  const shifted = offsets.find((offset) => {
    piece.x = startX + offset
    return !intersects(0, 0)
  })

  if (shifted === undefined) {
    piece.matrix = original
    piece.x = startX
  }
}

function renderBoard() {
  boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (board[y][x] !== 0) drawCell(boardCtx, x, y, colors[board[y][x]])
      else drawGridCell(x, y)
    }
  }

  if (piece) {
    const dropY = findDropY()
    piece.matrix.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (cell === 0) return
        drawCell(boardCtx, piece.x + x, dropY + y, `${colors[piece.color]}55`, true)
      }),
    )

    piece.matrix.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (cell === 0) return
        drawCell(boardCtx, piece.x + x, piece.y + y, colors[piece.color])
      }),
    )
  }

  if (gameOver) {
    boardCtx.fillStyle = "rgba(2,8,25,0.75)"
    boardCtx.fillRect(0, 210, boardCanvas.width, 160)
    boardCtx.fillStyle = "#f7fdff"
    boardCtx.font = "28px Orbitron, Trebuchet MS"
    boardCtx.textAlign = "center"
    boardCtx.fillText("GAME OVER", boardCanvas.width / 2, 280)
    boardCtx.font = "16px Orbitron, Trebuchet MS"
    boardCtx.fillText("Press R or Restart", boardCanvas.width / 2, 315)
  }
}

function drawGridCell(x, y) {
  boardCtx.strokeStyle = "#21355a45"
  boardCtx.strokeRect(x * CELL, y * CELL, CELL, CELL)
}

function drawCell(context, x, y, color, ghost = false) {
  context.fillStyle = color
  context.fillRect(x * CELL, y * CELL, CELL, CELL)

  if (ghost) return

  context.strokeStyle = "rgba(255,255,255,0.24)"
  context.strokeRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6)
}

function findDropY() {
  let y = piece.y
  while (!intersects(0, y - piece.y + 1)) {
    y += 1
  }
  return y
}

function renderNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextCtx.fillStyle = "#08102e"
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  const scale = 4
  const offsetX = (nextCanvas.width - nextPiece.matrix[0].length * scale) / 2
  const offsetY = (nextCanvas.height - nextPiece.matrix.length * scale) / 2

  nextPiece.matrix.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (cell === 0) return
      nextCtx.fillStyle = colors[nextPiece.color]
      nextCtx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale)
      nextCtx.strokeStyle = "rgba(255,255,255,0.25)"
      nextCtx.strokeRect(offsetX + x * scale + 0.5, offsetY + y * scale + 0.5, scale - 1, scale - 1)
    }),
  )
}

function updateHUD() {
  scoreOutput.textContent = `Score: ${score}`
  linesOutput.textContent = `Lines: ${lines}`
  levelOutput.textContent = `Level: ${level}`
}

function update(time = 0) {
  const delta = time - lastTime
  lastTime = time

  if (!paused && !gameOver) {
    dropAccumulator += delta
    if (dropAccumulator >= dropMs) {
      stepPiece()
      dropAccumulator = 0
    }
  }

  renderBoard()
  renderNext()
  updateHUD()
  requestAnimationFrame(update)
}

function reset() {
  board = emptyBoard()
  score = 0
  lines = 0
  level = 1
  dropMs = INITIAL_DROP_MS
  dropAccumulator = 0
  lastTime = 0
  paused = false
  gameOver = false
  piece = makePiece(randomShapeKey())
  nextPiece = makePiece(randomShapeKey())
}

document.addEventListener("keydown", (event) => {
  if (gameOver) {
    if (event.code === "KeyR" || event.key.toLowerCase() === "r") {
      reset()
    }
    return
  }

  if (event.key === "p" || event.key === "P") {
    paused = !paused
    return
  }

  if (event.code === "ArrowLeft") moveLeft()
  if (event.code === "ArrowRight") moveRight()
  if (event.code === "ArrowDown") moveDown()
  if (event.code === "ArrowUp") rotatePiece()
  if (event.code === "Space") hardDrop()

  if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space"].includes(event.code)) {
    event.preventDefault()
  }
})

restartButton.addEventListener("click", reset)

reset()
requestAnimationFrame(update)
