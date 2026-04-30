const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const scoreText = document.getElementById("score")
const linesText = document.getElementById("lines")
const levelText = document.getElementById("level")
const restartButton = document.getElementById("restart")

const columns = 10
const rows = 20
const scale = 30
const baseDropTime = 900

const pieces = {
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
  J: "#4f46e5",
  L: "#fb923c",
  O: "#facc15",
  S: "#22c55e",
  T: "#f472b6",
  Z: "#f43f5e",
}

const makeBoard = () =>
  Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))

const clone = (matrix) => matrix.map((row) => [...row])

let board = makeBoard()
let current
let next
let level = 1
let score = 0
let lines = 0
let droppedMs = 0
let dropSpeed = baseDropTime
let paused = false
let gameOver = false
let lastTick = 0
let animId

function randomPiece() {
  const keys = Object.keys(pieces)
  const picked = keys[Math.floor(Math.random() * keys.length)]
  return { matrix: clone(pieces[picked]), color: colors[picked], id: picked }
}

function rotate(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]).reverse())
}

function collides(offsetX = 0, offsetY = 0, matrix = current.matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) {
        continue
      }

      const boardX = current.x + x + offsetX
      const boardY = current.y + y + offsetY

      if (boardX < 0 || boardX >= columns || boardY >= rows) {
        return true
      }
      if (boardY < 0) {
        continue
      }
      if (board[boardY][boardX]) {
        return true
      }
    }
  }

  return false
}

function paint(x, y, color) {
  const px = x * scale
  const py = y * scale

  boardContext.fillStyle = color
  boardContext.fillRect(px, py, scale, scale)
  boardContext.fillStyle = "rgba(255,255,255,0.18)"
  boardContext.fillRect(px + 3, py + 3, scale - 6, 3)
  boardContext.strokeStyle = "rgba(255,255,255,0.15)"
  boardContext.strokeRect(px + 1, py + 1, scale - 2, scale - 2)
}

function paintPiece(ctx, canvasMatrix, offsetX, offsetY, fill, block) {
  const square = block || 30
  for (let y = 0; y < canvasMatrix.length; y++) {
    for (let x = 0; x < canvasMatrix[y].length; x++) {
      if (!canvasMatrix[y][x]) {
        continue
      }
      const px = (offsetX + x) * square
      const py = (offsetY + y) * square
      ctx.fillStyle = fill
      ctx.fillRect(px, py, square, square)

      if (ctx === boardContext) {
        ctx.fillStyle = "rgba(255,255,255,0.18)"
        ctx.fillRect(px + 3, py + 3, square - 6, 3)
        ctx.strokeStyle = "rgba(255,255,255,0.15)"
        ctx.strokeRect(px + 1, py + 1, square - 2, square - 2)
      }
    }
  }
}

function mergeCurrent() {
  current.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value || current.y + y < 0) {
        return
      }
      board[current.y + y][current.x + x] = current.color
    })
  })
}

function clearRows() {
  let fullRows = 0

  for (let y = rows - 1; y >= 0; ) {
    if (board[y].every(Boolean)) {
      board.splice(y, 1)
      board.unshift(Array.from({ length: columns }, () => 0))
      fullRows++
    } else {
      y--
    }
  }

  if (!fullRows) {
    return
  }

  const rowScore = [0, 100, 300, 500, 800]
  score += rowScore[Math.min(fullRows, rowScore.length - 1)] * level
  lines += fullRows
  level = Math.floor(lines / 10) + 1
  dropSpeed = Math.max(120, baseDropTime - (level - 1) * 80)

  scoreText.textContent = String(score)
  linesText.textContent = String(lines)
  levelText.textContent = String(level)
}

function spawn() {
  if (!next) {
    next = randomPiece()
  }

  current = {
    matrix: next.matrix,
    color: next.color,
    id: next.id,
    x: Math.floor(columns / 2) - Math.ceil(next.matrix[0].length / 2),
    y: 0,
  }

  next = randomPiece()
  renderNext()

  if (collides()) {
    gameOver = true
    cancelAnimationFrame(animId)
  }
}

function move(dx, dy) {
  if (gameOver || paused) {
    return
  }

  current.x += dx
  current.y += dy

  if (!collides()) {
    return
  }

  current.x -= dx
  current.y -= dy

  if (!dy) {
    return
  }

  mergeCurrent()
  clearRows()
  spawn()
}

function rotateCurrent() {
  if (gameOver || paused) {
    return
  }

  const rotated = rotate(current.matrix)
  const before = current.matrix
  current.matrix = rotated

  if (!collides()) {
    return
  }

  let push = 1
  while (collides(push, 0) && push <= current.matrix[0].length) {
    push = push > 0 ? -(push + 1) : -(push - 1)
  }

  if (collides(push, 0)) {
    current.matrix = before
    return
  }

  current.x += push
}

function hardDrop() {
  while (!collides(0, 1)) {
    current.y += 1
    score += 2
  }

  scoreText.textContent = String(score)
  move(0, 1)
}

function reset() {
  cancelAnimationFrame(animId)
  board = makeBoard()
  score = 0
  lines = 0
  level = 1
  dropSpeed = baseDropTime
  droppedMs = 0
  lastTick = 0
  paused = false
  gameOver = false
  next = null

  scoreText.textContent = "0"
  linesText.textContent = "0"
  levelText.textContent = "1"

  spawn()
  animId = requestAnimationFrame(frame)
}

function drawBoard() {
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = "#020814"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (!board[y][x]) {
        continue
      }
      paint(x, y, board[y][x])
    }
  }

  current.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) {
        return
      }
      const py = current.y + y
      const px = current.x + x
      if (py >= 0) {
        paint(px, py, current.color)
      }
    })
  })

  if (gameOver) {
    boardContext.fillStyle = "rgba(2, 8, 26, 0.75)"
    boardContext.fillRect(10, 250, 280, 120)
    boardContext.fillStyle = "#f8fafc"
    boardContext.textAlign = "center"
    boardContext.font = "30px Trebuchet MS"
    boardContext.fillText("GAME OVER", columns * scale / 2, rows * scale / 2)
    boardContext.font = "14px Trebuchet MS"
    boardContext.fillText("Press R to restart", columns * scale / 2, rows * scale / 2 + 30)
  }

  if (paused && !gameOver) {
    boardContext.fillStyle = "rgba(2, 8, 26, 0.75)"
    boardContext.fillRect(10, 250, 280, 120)
    boardContext.fillStyle = "#f8fafc"
    boardContext.textAlign = "center"
    boardContext.font = "30px Trebuchet MS"
    boardContext.fillText("PAUSED", columns * scale / 2, rows * scale / 2)
  }
}

function renderNext() {
  if (!next) {
    return
  }

  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextContext.fillStyle = "#040816"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  const size = 24
  const x = Math.floor((4 - next.matrix[0].length) / 2)
  const y = Math.floor((4 - next.matrix.length) / 2)
  paintPiece(nextContext, next.matrix, x, y, next.color, size)
}

function frame(now = 0) {
  const delta = now - lastTick
  lastTick = now
  droppedMs += delta

  if (!gameOver && !paused && droppedMs > dropSpeed) {
    move(0, 1)
    droppedMs = 0
  }

  drawBoard()

  if (!gameOver) {
    animId = requestAnimationFrame(frame)
  }
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyR") {
    reset()
    return
  }

  if (gameOver || paused) {
    if (event.code === "KeyP" && !gameOver) {
      paused = false
      lastTick = 0
      animId = requestAnimationFrame(frame)
    }

    return
  }

  if (event.code === "KeyP") {
    paused = true
    cancelAnimationFrame(animId)
    drawBoard()
    return
  }

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
  }
})

restartButton.addEventListener("click", reset)

spawn()
animId = requestAnimationFrame(frame)
