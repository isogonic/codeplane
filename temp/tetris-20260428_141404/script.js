const boardWidth = 10
const boardHeight = 20
const cellSize = 24

const pieces = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
}

const palette = {
  I: "#4fd3ff",
  J: "#5878ff",
  L: "#ffb65e",
  O: "#ffeb6f",
  S: "#6adf73",
  T: "#d57cff",
  Z: "#ff5f7a",
}

const scoreEl = document.getElementById("score")
const linesEl = document.getElementById("lines")
const levelEl = document.getElementById("level")
const statusEl = document.getElementById("status")
const restartButton = document.getElementById("restart")
const canvas = document.getElementById("board")
const context = canvas.getContext("2d")

const emptyLine = () => Array(boardWidth).fill(0)
const createBoard = () => Array.from({ length: boardHeight }, emptyLine)

const copyMatrix = (matrix) => matrix.map((row) => [...row])

const rotate = (matrix) => {
  const rows = matrix.length
  const cols = matrix[0].length
  const output = Array.from({ length: cols }, () => Array(rows).fill(0))

  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      output[x][rows - 1 - y] = value
    })
  })

  return output
}

const drawRect = (x, y, color) => {
  context.fillStyle = color
  context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
  context.strokeStyle = "rgba(255,255,255,0.12)"
  context.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize)
}

const createPiece = () => {
  const keys = Object.keys(pieces)
  const randomKey = keys[Math.floor(Math.random() * keys.length)]

  return {
    key: randomKey,
    matrix: copyMatrix(pieces[randomKey]),
    x: Math.floor((boardWidth - pieces[randomKey][0].length) / 2),
    y: -1,
  }
}

let board = createBoard()
let activePiece = createPiece()
let nextDrop = 0
let running = true
let lastTime = 0
let score = 0
let lines = 0
let level = 1
let dropFrame = 900

const getDropInterval = () => dropFrame

const canPlace = (piece, offsetX, offsetY) =>
  piece.matrix.every((row, dy) =>
    row.every((cell, dx) => {
      if (!cell) return true
      const x = piece.x + dx + offsetX
      const y = piece.y + dy + offsetY

      if (x < 0 || x >= boardWidth || y >= boardHeight) return false
      if (y < 0) return true

      return board[y][x] === 0
    }),
  )

const mergePiece = () => {
  activePiece.matrix.forEach((row, dy) => {
    row.forEach((cell, dx) => {
      if (!cell) return
      const y = activePiece.y + dy
      const x = activePiece.x + dx

      if (y >= 0) board[y][x] = activePiece.key
    })
  })
}

const clearCompletedLines = () => {
  const keep = board.filter((row) => row.some((cell) => cell === 0))
  const removed = board.length - keep.length

  if (!removed) return 0

  board = [
    ...Array.from({ length: removed }, emptyLine),
    ...keep,
  ]

  return removed
}

const lineScore = {
  1: 40,
  2: 120,
  3: 300,
  4: 1200,
}

const applyLineScore = (rows) => {
  if (!rows) return

  score += lineScore[rows] * level
  lines += rows
  level = Math.floor(lines / 10) + 1
  dropFrame = 900
  const clampedLevel = Math.max(1, Math.min(9, level))
  dropFrame -= (clampedLevel - 1) * 70
}

const updateUI = () => {
  scoreEl.textContent = String(score)
  linesEl.textContent = String(lines)
  levelEl.textContent = String(level)
}

const drawBoard = () => {
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#0c1a3f"
  context.fillRect(0, 0, canvas.width, canvas.height)

  board.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell) drawRect(x, y, palette[cell])
    })
  })

  activePiece.matrix.forEach((row, dy) => {
    row.forEach((cell, dx) => {
      if (!cell) return
      const x = activePiece.x + dx
      const y = activePiece.y + dy

      if (y >= 0) drawRect(x, y, palette[activePiece.key])
    })
  })

  for (let y = 1; y < boardHeight; y++) {
    context.fillStyle = "rgba(255,255,255,0.06)"
    context.fillRect(0, y * cellSize - 1, boardWidth * cellSize, 1)
  }
  for (let x = 1; x < boardWidth; x++) {
    context.fillStyle = "rgba(255,255,255,0.05)"
    context.fillRect(x * cellSize - 1, 0, 1, boardHeight * cellSize)
  }
}

const showGameOver = () => {
  running = false
  statusEl.classList.remove("hidden")
}

const spawnPiece = () => {
  activePiece = createPiece()

  if (!canPlace(activePiece, 0, 0)) {
    showGameOver()
  }
}

const stepDrop = () => {
  if (!running) return

  if (canPlace(activePiece, 0, 1)) {
    activePiece.y += 1
    return
  }

  mergePiece()
  const removed = clearCompletedLines()
  applyLineScore(removed)
  updateUI()
  spawnPiece()
}

const hardDrop = () => {
  if (!running) return

  while (canPlace(activePiece, 0, 1)) {
    activePiece.y += 1
  }
  stepDrop()
}

const movePiece = (distance) => {
  if (!running) return
  if (canPlace(activePiece, distance, 0)) activePiece.x += distance
}

const rotatePiece = () => {
  if (!running) return
  const rotated = rotate(activePiece.matrix)
  const originalMatrix = activePiece.matrix
  const originalX = activePiece.x

  if (canPlace({ ...activePiece, matrix: rotated }, 0, 0)) {
    activePiece.matrix = rotated
    return
  }

  activePiece.matrix = originalMatrix
  activePiece.x = originalX

  const wallKicks = [-1, 1, -2, 2]
  const canKick = wallKicks.some((kick) => {
    if (!canPlace({ ...activePiece, matrix: rotated }, kick, 0)) return false
    activePiece.x += kick
    return true
  })

  if (canKick) {
    activePiece.matrix = rotated
  }
}

const loop = (time) => {
  if (!running) {
    drawBoard()
    return
  }

  const delta = time - lastTime
  lastTime = time
  nextDrop += delta

  if (nextDrop > getDropInterval()) {
    stepDrop()
    nextDrop = 0
  }

  drawBoard()
  requestAnimationFrame(loop)
}

const resetGame = () => {
  board = createBoard()
  activePiece = createPiece()
  running = true
  score = 0
  lines = 0
  level = 1
  dropFrame = 900
  nextDrop = 0
  updateUI()
  statusEl.classList.add("hidden")
  lastTime = 0
  requestAnimationFrame(loop)
}

window.addEventListener("keydown", (event) => {
  if (!running && event.code !== "KeyR") return

  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    event.preventDefault()
    movePiece(-1)
    return
  }

  if (event.code === "ArrowRight" || event.code === "KeyD") {
    event.preventDefault()
    movePiece(1)
    return
  }

  if (event.code === "ArrowDown" || event.code === "KeyS") {
    event.preventDefault()
    stepDrop()
    return
  }

  if (event.code === "ArrowUp" || event.code === "KeyW") {
    event.preventDefault()
    rotatePiece()
    return
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
    return
  }

  if (event.code === "KeyR") {
    event.preventDefault()
    resetGame()
  }
})

restartButton.addEventListener("click", resetGame)

canvas.width = boardWidth * cellSize
canvas.height = boardHeight * cellSize

updateUI()
requestAnimationFrame(loop)
