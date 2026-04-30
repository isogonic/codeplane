const canvas = document.getElementById("board")
const context = canvas.getContext("2d")
const scoreEl = document.getElementById("score")
const linesEl = document.getElementById("lines")
const levelEl = document.getElementById("level")
const restartButton = document.getElementById("restart")

const blockSize = 30
const width = 10
const height = 20

const tetrominoes = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
}

const colors = {
  I: "#67e8f9",
  J: "#38bdf8",
  L: "#fb923c",
  O: "#fde047",
  S: "#4ade80",
  T: "#c084fc",
  Z: "#f87171",
}

const emptyBoard = () =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => 0))

let board = emptyBoard()
let player
let dropElapsed = 0
let dropRate = 900
let last = 0
let animationId
let score = 0
let lines = 0
let level = 1
let paused = false
let gameOver = false

const cloneMatrix = (matrix) => matrix.map((row) => [...row])

function randomShape() {
  const keys = Object.keys(tetrominoes)
  const key = keys[Math.floor(Math.random() * keys.length)]
  return { key, matrix: cloneMatrix(tetrominoes[key]), color: colors[key] }
}

function spawnPiece() {
  const next = randomShape()
  player = {
    matrix: next.matrix,
    color: next.color,
    key: next.key,
    x: Math.floor(width / 2) - Math.ceil(next.matrix[0].length / 2),
    y: 0,
  }

  if (collides()) {
    gameOver = true
    cancelAnimationFrame(animationId)
    draw()
  }
}

function rotateMatrix(matrix) {
  const rotated = matrix[0].map((_, col) => matrix.map((row) => row[col]).reverse())
  return rotated
}

function collides(offsetX = 0, offsetY = 0, matrix = player.matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue
      const boardX = x + player.x + offsetX
      const boardY = y + player.y + offsetY

      if (boardX < 0 || boardX >= width || boardY >= height) return true
      if (boardY < 0) continue
      if (board[boardY][boardX]) return true
    }
  }

  return false
}

function merge() {
  player.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return
      if (player.y + y < 0) return
      board[player.y + y][player.x + x] = player.color
    })
  })
}

function clearLines() {
  let cleared = 0

  for (let y = height - 1; y >= 0; ) {
    if (board[y].every((cell) => cell)) {
      board.splice(y, 1)
      board.unshift(Array.from({ length: width }, () => 0))
      cleared++
    } else {
      y--
    }
  }

  if (!cleared) return

  lines += cleared
  score += [0, 40, 100, 300, 1200][cleared] * level
  level = Math.floor(lines / 10) + 1
  dropRate = Math.max(100, 900 - (level - 1) * 80)

  scoreEl.textContent = score
  linesEl.textContent = lines
  levelEl.textContent = level
}

function move(dx, dy) {
  if (gameOver || paused) return
  player.x += dx
  player.y += dy

  if (collides()) {
    player.x -= dx
    player.y -= dy

    if (dy === 0) return

    merge()
    clearLines()
    spawnPiece()
  }
}

function hardDrop() {
  while (!collides(0, 1)) {
    player.y++
  }

  move(0, 1)
}

function rotate() {
  if (gameOver || paused) return

  const rotated = rotateMatrix(player.matrix)
  const old = player.matrix
  player.matrix = rotated

  if (!collides()) return

  let shift = 1
  while (collides(shift, 0)) {
    shift = shift > 0 ? -(shift + 1) : -(shift - 1)
    if (Math.abs(shift) > player.matrix[0].length) {
      player.matrix = old
      return
    }
  }

  player.x += shift
}

function drawCell(x, y, color) {
  context.fillStyle = color
  context.fillRect(x * blockSize, y * blockSize, blockSize, blockSize)
  context.fillStyle = "rgba(255,255,255,0.18)"
  context.fillRect(x * blockSize + 4, y * blockSize + 4, blockSize - 8, 6)

  context.strokeStyle = "rgba(255,255,255,0.16)"
  context.strokeRect(x * blockSize + 1, y * blockSize + 1, blockSize - 2, blockSize - 2)
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#030712"
  context.fillRect(0, 0, canvas.width, canvas.height)

  board.forEach((row, y) => {
    row.forEach((color, x) => {
      if (!color) return
      drawCell(x, y, color)
    })
  })

  player.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return
      const px = player.x + x
      const py = player.y + y
      if (py >= 0) drawCell(px, py, player.color)
    })
  })

  if (!gameOver) return

  context.fillStyle = "rgba(4, 10, 32, 0.85)"
  context.fillRect(0, canvas.height / 2 - 52, canvas.width, 104)

  context.fillStyle = "#f8fafc"
  context.textAlign = "center"
  context.font = "26px Trebuchet MS"
  context.fillText("GAME OVER", canvas.width / 2, canvas.height / 2)
  context.font = "14px Trebuchet MS"
  context.fillText("Press R to restart", canvas.width / 2, canvas.height / 2 + 28)
}

function update(time = 0) {
  const delta = time - last
  last = time
  dropElapsed += delta

  if (!gameOver && !paused && dropElapsed > dropRate) {
    move(0, 1)
    dropElapsed = 0
  }

  draw()
  animationId = requestAnimationFrame(update)
}

function resetGame() {
  cancelAnimationFrame(animationId)
  board = emptyBoard()
  score = 0
  lines = 0
  level = 1
  dropRate = 900
  dropElapsed = 0
  last = 0
  gameOver = false
  paused = false
  scoreEl.textContent = score
  linesEl.textContent = lines
  levelEl.textContent = level
  spawnPiece()
  animationId = requestAnimationFrame(update)
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyP") {
    if (gameOver) return
    paused = !paused
    return
  }

  if (event.code === "KeyR") {
    resetGame()
    return
  }

  if (paused) return

  if (event.code === "ArrowLeft") move(-1, 0)
  if (event.code === "ArrowRight") move(1, 0)
  if (event.code === "ArrowDown") move(0, 1)
  if (event.code === "ArrowUp") rotate()
  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

restartButton.addEventListener("click", () => resetGame())

spawnPiece()
animationId = requestAnimationFrame(update)
