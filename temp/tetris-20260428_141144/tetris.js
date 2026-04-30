const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const overlay = document.getElementById("overlay")
const scoreElement = document.getElementById("score")
const linesElement = document.getElementById("lines")
const levelElement = document.getElementById("level")
const resetButton = document.getElementById("reset")

const columns = 10
const rows = 20
const block = 30
const colors = {
  I: "#4dd2ff",
  J: "#4d72ff",
  L: "#ff9c42",
  O: "#f7f34b",
  S: "#43d17a",
  T: "#ba4dff",
  Z: "#ff4d6a",
}

const piecePool = [
  {
    shape: [[1, 1, 1, 1]],
    color: "I",
  },
  {
    shape: [[1, 0, 0], [1, 1, 1]],
    color: "J",
  },
  {
    shape: [[0, 0, 1], [1, 1, 1]],
    color: "L",
  },
  {
    shape: [[1, 1], [1, 1]],
    color: "O",
  },
  {
    shape: [[0, 1, 1], [1, 1, 0]],
    color: "S",
  },
  {
    shape: [[0, 1, 0], [1, 1, 1]],
    color: "T",
  },
  {
    shape: [[1, 1, 0], [0, 1, 1]],
    color: "Z",
  },
]

const lineReward = [0, 100, 300, 500, 800]
const boardColor = "#101737"

let board = []
let activePiece = null
let previewPiece = null
let score = 0
let lines = 0
let level = 1
let dropInterval = 900
let dropCounter = 0
let gameOver = false
let paused = false
let lastTime = 0

function createBoard() {
  return Array.from({ length: rows }, () => Array(columns).fill(0))
}

function cloneShape(shape) {
  return shape.map((row) => [...row])
}

function randomPiece() {
  const choice = piecePool[Math.floor(Math.random() * piecePool.length)]
  return {
    x: Math.floor((columns - choice.shape[0].length) / 2),
    y: 0,
    shape: cloneShape(choice.shape),
    color: choice.color,
  }
}

function rotate(matrix) {
  return matrix[0].map((_, col) => matrix.map((row) => row[col]).reverse())
}

function collides(piece, dx = 0, dy = 0, candidateShape = piece.shape) {
  return candidateShape.some((row, y) =>
    row.some((value, x) => {
      if (!value) {
        return false
      }
      const boardX = piece.x + x + dx
      const boardY = piece.y + y + dy
      if (boardX < 0 || boardX >= columns || boardY >= rows) {
        return true
      }
      return boardY >= 0 && board[boardY][boardX]
    }),
  )
}

function lockPiece() {
  activePiece.shape.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) {
        return
      }
      board[activePiece.y + y][activePiece.x + x] = activePiece.color
    }),
  )
}

function clearLines() {
  let cleared = 0
  for (let y = rows - 1; y >= 0; y--) {
    if (board[y].every(Boolean)) {
      board.splice(y, 1)
      board.unshift(Array(columns).fill(0))
      cleared += 1
      y += 1
    }
  }
  return cleared
}

function spawnPiece() {
  activePiece = previewPiece || randomPiece()
  previewPiece = randomPiece()

  activePiece.x = Math.floor((columns - activePiece.shape[0].length) / 2)
  activePiece.y = 0
  if (collides(activePiece)) {
    gameOver = true
    overlay.textContent = "Game Over"
    overlay.classList.remove("hidden")
    return false
  }

  overlay.classList.add("hidden")
  return true
}

function move(dx, dy) {
  if (gameOver || paused) {
    return false
  }
  if (!collides(activePiece, dx, dy)) {
    activePiece.x += dx
    activePiece.y += dy
    return true
  }
  return false
}

function rotateActive() {
  const rotated = rotate(activePiece.shape)
  if (collides(activePiece, 0, 0, rotated)) {
    return
  }
  activePiece.shape = rotated
}

function hardDrop() {
  while (!collides(activePiece, 0, 1)) {
    activePiece.y += 1
    score += 2
  }
  settleActivePiece()
}

function settleActivePiece() {
  lockPiece()
  const cleared = clearLines()
  if (cleared > 0) {
    lines += cleared
    score += lineReward[cleared] * level
    level = 1 + Math.floor(lines / 10)
    dropInterval = Math.max(100, 900 - (level - 1) * 70)
  }

  if (!spawnPiece()) {
    return
  }
}

function softDrop() {
  if (!move(0, 1)) {
    settleActivePiece()
  }
}

function updateStats() {
  scoreElement.textContent = String(score)
  linesElement.textContent = String(lines)
  levelElement.textContent = String(level)
}

function drawCell(context, x, y, color) {
  context.fillStyle = color
  context.fillRect(x * block, y * block, block, block)

  context.strokeStyle = "rgba(255, 255, 255, 0.18)"
  context.strokeRect(x * block + 1, y * block + 1, block - 2, block - 2)
}

function drawBoard() {
  boardContext.setTransform(1, 0, 0, 1, 0, 0)
  boardContext.imageSmoothingEnabled = false
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = boardColor
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  board.forEach((row, y) =>
    row.forEach((color, x) => {
      if (color) {
        drawCell(boardContext, x, y, colors[color])
      }
    }),
  )

  activePiece.shape.forEach((row, y) =>
    row.forEach((value, x) => {
      if (value) {
        drawCell(boardContext, activePiece.x + x, activePiece.y + y, colors[activePiece.color])
      }
    }),
  )

  if (gameOver) {
    boardContext.fillStyle = "rgba(0, 0, 0, 0.55)"
    boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)
  }
}

function drawPreview() {
  const cellSize = 30
  const centerX = 1
  const centerY = 1
  nextContext.setTransform(1, 0, 0, 1, 0, 0)
  nextContext.imageSmoothingEnabled = false
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextContext.fillStyle = "#0d1330"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  const offsetX = Math.max(0, 2 - previewPiece.shape[0].length / 2)
  previewPiece.shape.forEach((row, y) =>
    row.forEach((value, x) => {
      if (value) {
        nextContext.fillStyle = colors[previewPiece.color]
        nextContext.fillRect(
          (x + centerX - offsetX) * cellSize,
          (y + centerY) * cellSize,
          cellSize,
          cellSize,
        )
      }
    }),
  )
}

function draw() {
  drawBoard()
  drawPreview()
  updateStats()
}

function step(time = 0) {
  const delta = time - lastTime
  lastTime = time

  if (!gameOver && !paused) {
    dropCounter += delta
    if (dropCounter > dropInterval) {
      dropCounter = 0
      softDrop()
    }
  }

  draw()
  requestAnimationFrame(step)
}

function start() {
  board = createBoard()
  score = 0
  lines = 0
  level = 1
  dropInterval = 900
  gameOver = false
  paused = false
  dropCounter = 0
  lastTime = 0
  previewPiece = randomPiece()
  spawnPiece()
  overlay.classList.add("hidden")
  updateStats()
}

document.addEventListener("keydown", (event) => {
  if (gameOver && event.code !== "KeyR" && event.code !== "Enter" && event.code !== "Space") {
    return
  }

  if (event.code === "KeyP") {
    if (gameOver) {
      return
    }
    paused = !paused
    overlay.textContent = paused ? "Paused" : ""
    overlay.classList.toggle("hidden", !paused)
    return
  }

  if (paused) {
    return
  }

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
    softDrop()
    score += 1
  }

  if (event.code === "ArrowUp") {
    event.preventDefault()
    rotateActive()
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

resetButton.addEventListener("click", () => {
  start()
})

start()
requestAnimationFrame(step)
