const canvas = document.getElementById("board")
const context = canvas.getContext("2d")
const scoreNode = document.getElementById("score")
const linesNode = document.getElementById("lines")
const levelNode = document.getElementById("level")
const restartButton = document.getElementById("restart")

const COLS = 10
const ROWS = 20
const CELL = 30

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
  J: "#60a5fa",
  L: "#fb923c",
  O: "#facc15",
  S: "#4ade80",
  T: "#c084fc",
  Z: "#f87171",
}

const emptyBoard = () => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0))
const clone = (matrix) => matrix.map((row) => [...row])

let board = emptyBoard()
let active
let upcoming
let score = 0
let lines = 0
let level = 1
let paused = false
let gameOver = false
let dropTimer = 0
let dropInterval = 900
let lastTime = 0
let rafId

function randomPiece() {
  const names = Object.keys(pieces)
  const type = names[Math.floor(Math.random() * names.length)]
  return {
    matrix: clone(pieces[type]),
    color: colors[type],
    type,
  }
}

function rotateMatrix(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function collides(dx = 0, dy = 0, matrix = active.matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue

      const boardX = active.x + x + dx
      const boardY = active.y + y + dy

      if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true
      if (boardY < 0) continue
      if (board[boardY][boardX]) return true
    }
  }

  return false
}

function merge() {
  active.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return
      if (active.y + y < 0) return
      board[active.y + y][active.x + x] = active.color
    })
  })
}

function clearLines() {
  let count = 0

  for (let row = ROWS - 1; row >= 0; ) {
    if (board[row].every((value) => value)) {
      board.splice(row, 1)
      board.unshift(Array.from({ length: COLS }, () => 0))
      count++
    } else {
      row--
    }
  }

  if (!count) return

  const gain = [0, 100, 300, 500, 800]
  score += gain[Math.min(count, gain.length - 1)] * level
  lines += count
  level = Math.floor(lines / 10) + 1
  dropInterval = Math.max(140, 900 - (level - 1) * 70)

  scoreNode.textContent = String(score)
  linesNode.textContent = String(lines)
  levelNode.textContent = String(level)
}

function movePiece(dx, dy) {
  if (gameOver || paused) return

  active.x += dx
  active.y += dy

  if (!collides()) return

  active.x -= dx
  active.y -= dy

  if (!dy) return

  merge()
  clearLines()
  spawnPiece()
}

function hardDrop() {
  while (!collides(0, 1)) {
    active.y++
    score += 2
  }

  scoreNode.textContent = String(score)
  movePiece(0, 1)
}

function rotatePiece() {
  if (gameOver || paused) return

  const rotated = rotateMatrix(active.matrix)
  const prev = active.matrix
  active.matrix = rotated

  if (!collides()) return

  let kick = 1
  while (collides(kick, 0)) {
    kick = kick > 0 ? -(kick + 1) : -(kick - 1)
    if (Math.abs(kick) > active.matrix[0].length) {
      active.matrix = prev
      return
    }
  }

  active.x += kick
}

function drawCell(x, y, color) {
  const px = x * CELL
  const py = y * CELL

  context.fillStyle = color
  context.fillRect(px, py, CELL, CELL)
  context.fillStyle = "rgba(255,255,255,0.2)"
  context.fillRect(px + 4, py + 4, CELL - 8, 4)
  context.strokeStyle = "rgba(255,255,255,0.15)"
  context.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2)
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#020714"
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!board[y][x]) continue
      drawCell(x, y, board[y][x])
    }
  }

  active.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return

      const px = active.x + x
      const py = active.y + y
      if (py >= 0) drawCell(px, py, active.color)
    })
  })

  if (!gameOver) return

  context.fillStyle = "rgba(2, 8, 30, 0.88)"
  context.fillRect(0, ROWS * CELL / 2 - 55, COLS * CELL, 120)
  context.fillStyle = "#f8fafc"
  context.textAlign = "center"
  context.font = "28px Trebuchet MS"
  context.fillText("GAME OVER", COLS * CELL / 2, ROWS * CELL / 2)
  context.font = "14px Trebuchet MS"
  context.fillText("Press R to restart", COLS * CELL / 2, ROWS * CELL / 2 + 30)
}

function spawnPiece() {
  if (!upcoming) upcoming = randomPiece()

  active = {
    matrix: upcoming.matrix,
    color: upcoming.color,
    type: upcoming.type,
    x: Math.floor(COLS / 2) - Math.ceil(upcoming.matrix[0].length / 2),
    y: 0,
  }

  upcoming = randomPiece()

  if (collides()) {
    gameOver = true
    pauseLoop()
  }
}

function pauseLoop() {
  cancelAnimationFrame(rafId)
}

function loop(time = 0) {
  const delta = time - lastTime
  lastTime = time
  dropTimer += delta

  if (!gameOver && !paused && dropTimer > dropInterval) {
    movePiece(0, 1)
    dropTimer = 0
  }

  draw()
  if (gameOver) return
  rafId = requestAnimationFrame(loop)
}

function restart() {
  cancelAnimationFrame(rafId)
  board = emptyBoard()
  score = 0
  lines = 0
  level = 1
  paused = false
  gameOver = false
  dropTimer = 0
  lastTime = 0
  dropInterval = 900
  upcoming = null
  scoreNode.textContent = "0"
  linesNode.textContent = "0"
  levelNode.textContent = "1"
  spawnPiece()
  rafId = requestAnimationFrame(loop)
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyR") {
    restart()
    return
  }

  if (event.code === "KeyP" && !gameOver) {
    paused = !paused
    return
  }

  if (gameOver || paused) return

  if (event.code === "ArrowLeft") {
    event.preventDefault()
    movePiece(-1, 0)
    return
  }

  if (event.code === "ArrowRight") {
    event.preventDefault()
    movePiece(1, 0)
    return
  }

  if (event.code === "ArrowDown") {
    event.preventDefault()
    movePiece(0, 1)
    return
  }

  if (event.code === "ArrowUp") {
    event.preventDefault()
    rotatePiece()
    return
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

restartButton.addEventListener("click", restart)

spawnPiece()
rafId = requestAnimationFrame(loop)
