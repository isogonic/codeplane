const canvas = document.getElementById("board")
const context = canvas.getContext("2d")
const scoreNode = document.getElementById("score")
const linesNode = document.getElementById("lines")
const levelNode = document.getElementById("level")
const restartButton = document.getElementById("restart")

const columns = 10
const rows = 20
const block = 30

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

const emptyBoard = () => Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))
const cloneMatrix = (matrix) => matrix.map((row) => [...row])

let board = emptyBoard()
let activePiece
let nextPiece
let score = 0
let lines = 0
let level = 1
let paused = false
let over = false
let elapsed = 0
let dropRate = 900
let lastFrame = 0
let frameId

function pickPiece() {
  const keys = Object.keys(shapes)
  const key = keys[Math.floor(Math.random() * keys.length)]
  return { matrix: cloneMatrix(shapes[key]), color: colors[key], name: key }
}

function rotate(matrix) {
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]).reverse())
}

function collides(offsetX = 0, offsetY = 0, matrix = activePiece.matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue

      const boardX = activePiece.x + x + offsetX
      const boardY = activePiece.y + y + offsetY

      if (boardX < 0 || boardX >= columns || boardY >= rows) return true
      if (boardY < 0) continue
      if (board[boardY][boardX]) return true
    }
  }

  return false
}

function mergePiece() {
  activePiece.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return
      if (activePiece.y + y < 0) return
      board[activePiece.y + y][activePiece.x + x] = activePiece.color
    })
  })
}

function clearFullLines() {
  let total = 0

  for (let y = rows - 1; y >= 0; ) {
    if (board[y].every((cell) => cell)) {
      board.splice(y, 1)
      board.unshift(Array.from({ length: columns }, () => 0))
      total++
    } else {
      y--
    }
  }

  if (!total) return

  const scores = [0, 100, 300, 500, 800]
  const points = scores[Math.min(total, scores.length - 1)] * level
  score += points
  lines += total
  level = Math.floor(lines / 10) + 1
  dropRate = Math.max(140, 900 - (level - 1) * 70)

  scoreNode.textContent = String(score)
  linesNode.textContent = String(lines)
  levelNode.textContent = String(level)
}

function move(dx, dy) {
  if (over || paused) return

  activePiece.x += dx
  activePiece.y += dy

  if (!collides()) return

  activePiece.x -= dx
  activePiece.y -= dy

  if (!dy) return

  mergePiece()
  clearFullLines()
  spawnPiece()
}

function hardDrop() {
  while (!collides(0, 1)) {
    activePiece.y++
    score += 2
  }

  scoreNode.textContent = String(score)
  move(0, 1)
}

function attemptRotate() {
  if (over || paused) return

  const rotated = rotate(activePiece.matrix)
  const previous = activePiece.matrix
  activePiece.matrix = rotated

  if (!collides()) return

  let nudge = 1
  while (collides(nudge, 0)) {
    nudge = nudge > 0 ? -(nudge + 1) : -(nudge - 1)
    if (Math.abs(nudge) > activePiece.matrix[0].length) {
      activePiece.matrix = previous
      return
    }
  }

  activePiece.x += nudge
}

function drawCell(x, y, color) {
  const px = x * block
  const py = y * block
  context.fillStyle = color
  context.fillRect(px, py, block, block)
  context.fillStyle = "rgba(255,255,255,0.2)"
  context.fillRect(px + 4, py + 4, block - 8, 4)
  context.strokeStyle = "rgba(255,255,255,0.15)"
  context.strokeRect(px + 1, py + 1, block - 2, block - 2)
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#020714"
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

  if (!over) return

  context.fillStyle = "rgba(3, 8, 30, 0.85)"
  context.fillRect(0, rows * block / 2 - 55, columns * block, 120)
  context.fillStyle = "#f8fafc"
  context.textAlign = "center"
  context.font = "28px Trebuchet MS"
  context.fillText("GAME OVER", columns * block / 2, rows * block / 2)
  context.font = "14px Trebuchet MS"
  context.fillText("Press R to restart", columns * block / 2, rows * block / 2 + 30)
}

function spawnPiece() {
  if (!nextPiece) nextPiece = pickPiece()

  activePiece = {
    matrix: nextPiece.matrix,
    color: nextPiece.color,
    name: nextPiece.name,
    x: Math.floor(columns / 2) - Math.ceil(nextPiece.matrix[0].length / 2),
    y: 0,
  }

  nextPiece = pickPiece()

  if (collides()) {
    over = true
    pauseOrStop()
  }
}

function pauseOrStop() {
  if (!over) return
  cancelAnimationFrame(frameId)
}

function loop(time = 0) {
  const delta = time - lastFrame
  lastFrame = time
  elapsed += delta

  if (!over && !paused && elapsed > dropRate) {
    move(0, 1)
    elapsed = 0
  }

  draw()
  if (over) return
  frameId = requestAnimationFrame(loop)
}

function resetGame() {
  cancelAnimationFrame(frameId)
  board = emptyBoard()
  score = 0
  lines = 0
  level = 1
  dropRate = 900
  elapsed = 0
  lastFrame = 0
  over = false
  paused = false
  nextPiece = null
  scoreNode.textContent = "0"
  linesNode.textContent = "0"
  levelNode.textContent = "1"
  spawnPiece()
  frameId = requestAnimationFrame(loop)
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyR") {
    resetGame()
    return
  }

  if (event.code === "KeyP" && !over) {
    paused = !paused
    return
  }

  if (over || paused) return

  if (event.code === "ArrowLeft") {
    event.preventDefault()
    move(-1, 0)
  }

  if (event.code === "ArrowRight") {
    event.preventDefault()
    move(1, 0)
  }

  if (event.code === "ArrowDown") {
    event.preventDefault()
    move(0, 1)
  }

  if (event.code === "ArrowUp") {
    event.preventDefault()
    attemptRotate()
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

restartButton.addEventListener("click", resetGame)

spawnPiece()
frameId = requestAnimationFrame(loop)
