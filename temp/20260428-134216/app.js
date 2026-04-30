const canvas = document.getElementById("board")
const context = canvas.getContext("2d")
const scoreNode = document.getElementById("score")
const linesNode = document.getElementById("lines")
const levelNode = document.getElementById("level")
const restartButton = document.getElementById("restart")

const columns = 10
const rows = 20
const cell = 30

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
  I: "#06b6d4",
  J: "#3b82f6",
  L: "#fb923c",
  O: "#eab308",
  S: "#22c55e",
  T: "#a855f7",
  Z: "#ef4444",
}

const createBoard = () => Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))
const cloneMatrix = (matrix) => matrix.map((row) => [...row])

let board = createBoard()
let activePiece
let nextPiece
let score = 0
let lines = 0
let level = 1
let dropMs = 900
let pause = false
let gameOver = false
let frameId
let elapsed = 0
let lastTick = 0

function randomPiece() {
  const keys = Object.keys(shapes)
  const key = keys[Math.floor(Math.random() * keys.length)]
  return { matrix: cloneMatrix(shapes[key]), color: colors[key], name: key }
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function collides(dx = 0, dy = 0, matrix = activePiece.matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue

      const boardX = activePiece.x + x + dx
      const boardY = activePiece.y + y + dy

      if (boardX < 0 || boardX >= columns || boardY >= rows) return true
      if (boardY < 0) continue
      if (board[boardY][boardX]) return true
    }
  }
  return false
}

function merge() {
  activePiece.matrix.forEach((row, y) => {
    row.forEach((cellValue, x) => {
      if (!cellValue) return
      if (activePiece.y + y < 0) return
      board[activePiece.y + y][activePiece.x + x] = activePiece.color
    })
  })
}

function clearLines() {
  let removed = 0
  for (let y = rows - 1; y >= 0; ) {
    if (board[y].every((value) => value)) {
      board.splice(y, 1)
      board.unshift(Array.from({ length: columns }, () => 0))
      removed++
    } else {
      y--
    }
  }

  if (!removed) return

  const rewards = [0, 100, 300, 500, 800]
  const points = rewards[Math.min(removed, rewards.length - 1)] * level
  score += points
  lines += removed
  level = Math.floor(lines / 10) + 1
  dropMs = Math.max(140, 900 - (level - 1) * 70)

  scoreNode.textContent = String(score)
  linesNode.textContent = String(lines)
  levelNode.textContent = String(level)
}

function attemptMove(dx, dy) {
  if (gameOver || pause) return

  activePiece.x += dx
  activePiece.y += dy

  if (!collides()) return

  activePiece.x -= dx
  activePiece.y -= dy

  if (!dy) return

  merge()
  clearLines()
  spawn()
}

function hardDrop() {
  while (!collides(0, 1)) {
    activePiece.y++
    score += 2
  }

  scoreNode.textContent = String(score)
  attemptMove(0, 1)
}

function rotatePiece() {
  if (gameOver || pause) return

  const rotated = rotate(activePiece.matrix)
  const original = activePiece.matrix
  activePiece.matrix = rotated

  if (!collides()) return

  let nudge = 1
  while (collides(nudge, 0)) {
    nudge = nudge > 0 ? -(nudge + 1) : -(nudge - 1)
    if (Math.abs(nudge) > activePiece.matrix[0].length) {
      activePiece.matrix = original
      return
    }
  }

  activePiece.x += nudge
}

function drawCell(x, y, color) {
  const left = x * cell
  const top = y * cell
  context.fillStyle = color
  context.fillRect(left, top, cell, cell)
  context.fillStyle = "rgba(255, 255, 255, 0.2)"
  context.fillRect(left + 4, top + 4, cell - 8, 4)
  context.strokeStyle = "rgba(255, 255, 255, 0.12)"
  context.strokeRect(left + 1, top + 1, cell - 2, cell - 2)
}

function render() {
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#030816"
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (!board[y][x]) continue
      drawCell(x, y, board[y][x])
    }
  }

  activePiece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return
      const px = activePiece.x + x
      const py = activePiece.y + y
      if (py >= 0) drawCell(px, py, activePiece.color)
    })
  })

  if (!gameOver) return

  context.fillStyle = "rgba(3, 8, 31, 0.9)"
  context.fillRect(0, rows * cell / 2 - 60, columns * cell, 130)
  context.fillStyle = "#f8fafc"
  context.textAlign = "center"
  context.font = "28px Georgia"
  context.fillText("GAME OVER", columns * cell / 2, rows * cell / 2)
  context.font = "14px Arial"
  context.fillText("Press R to restart", columns * cell / 2, rows * cell / 2 + 28)
}

function spawn() {
  if (!nextPiece) nextPiece = randomPiece()

  activePiece = {
    matrix: nextPiece.matrix,
    color: nextPiece.color,
    name: nextPiece.name,
    x: Math.floor(columns / 2) - Math.ceil(nextPiece.matrix[0].length / 2),
    y: 0,
  }

  nextPiece = randomPiece()

  if (collides()) {
    gameOver = true
    cancelAnimationFrame(frameId)
  }
}

function frame(time = 0) {
  const delta = time - lastTick
  lastTick = time
  elapsed += delta

  if (!gameOver && !pause && elapsed > dropMs) {
    attemptMove(0, 1)
    elapsed = 0
  }

  render()
  if (!gameOver) frameId = requestAnimationFrame(frame)
}

function reset() {
  cancelAnimationFrame(frameId)
  board = createBoard()
  score = 0
  lines = 0
  level = 1
  dropMs = 900
  elapsed = 0
  lastTick = 0
  pause = false
  gameOver = false
  nextPiece = null
  scoreNode.textContent = "0"
  linesNode.textContent = "0"
  levelNode.textContent = "1"
  spawn()
  frameId = requestAnimationFrame(frame)
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyR") {
    reset()
    return
  }

  if (event.code === "KeyP" && !gameOver) {
    pause = !pause
    return
  }

  if (gameOver || pause) return

  if (event.code === "ArrowLeft") {
    event.preventDefault()
    attemptMove(-1, 0)
  }

  if (event.code === "ArrowRight") {
    event.preventDefault()
    attemptMove(1, 0)
  }

  if (event.code === "ArrowDown") {
    event.preventDefault()
    attemptMove(0, 1)
  }

  if (event.code === "ArrowUp") {
    event.preventDefault()
    rotatePiece()
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

restartButton.addEventListener("click", reset)

spawn()
frameId = requestAnimationFrame(frame)
