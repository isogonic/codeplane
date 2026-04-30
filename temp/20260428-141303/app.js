const boardWidth = 10
const boardHeight = 20
const cellSize = 30

const canvas = document.getElementById("playfield")
const context = canvas.getContext("2d")
const pointsEl = document.getElementById("points")
const linesEl = document.getElementById("lines")
const levelEl = document.getElementById("level")
const statusEl = document.getElementById("status")
const restartButton = document.getElementById("restart")

const shapeLibrary = [
  { name: "I", matrix: [[1, 1, 1, 1]], color: "#66d9ff" },
  { name: "J", matrix: [[1, 0, 0], [1, 1, 1]], color: "#5477ff" },
  { name: "L", matrix: [[0, 0, 1], [1, 1, 1]], color: "#ff9f2f" },
  { name: "O", matrix: [[1, 1], [1, 1]], color: "#ffe75f" },
  { name: "S", matrix: [[0, 1, 1], [1, 1, 0]], color: "#45d18f" },
  { name: "T", matrix: [[0, 1, 0], [1, 1, 1]], color: "#bb57ff" },
  { name: "Z", matrix: [[1, 1, 0], [0, 1, 1]], color: "#ff5a6f" }
]

const scoreByLines = {
  1: 40,
  2: 100,
  3: 300,
  4: 1200
}

let board
let piece
let nextPiece
let lastTime
let dropTimer
let dropInterval
let isRunning
let stats

const clearBoard = () =>
  Array.from({ length: boardHeight }, () => Array(boardWidth).fill(0))

const randomPiece = () => {
  const pick = shapeLibrary[Math.floor(Math.random() * shapeLibrary.length)]
  const matrix = pick.matrix.map((row) => row.slice())
  return {
    matrix,
    x: Math.floor(boardWidth / 2) - Math.ceil(matrix[0].length / 2),
    y: 0,
    color: pick.color
  }
}

const rotate = (matrix) =>
  matrix[0].map((_, i) => matrix.map((row) => row[i]).reverse())

const collides = (x, y, matrix) => {
  return matrix.some((row, dy) =>
    row.some((cell, dx) => {
      if (!cell) return false
      const nx = x + dx
      const ny = y + dy

      return nx < 0 || nx >= boardWidth || ny >= boardHeight || (ny >= 0 && board[ny][nx])
    })
  )
}

const drawBoard = () => {
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#0a1222"
  context.fillRect(0, 0, canvas.width, canvas.height)
  board.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      drawCell(x, y, value)
    })
  )

  piece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return
      drawCell(piece.x + x, piece.y + y, piece.color)
    })
  )
}

const drawCell = (x, y, color) => {
  const px = x * cellSize
  const py = y * cellSize

  context.fillStyle = color
  context.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2)
  context.strokeStyle = "rgba(255,255,255,0.2)"
  context.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2)
}

const merge = () => {
  piece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (value) board[piece.y + y][piece.x + x] = piece.color
    })
  )
}

const clearLines = () => {
  const cleared = board.reduce((total, row, index) => {
    const full = row.every(Boolean)
    if (!full) return total

    board.splice(index, 1)
    board.unshift(Array(boardWidth).fill(0))
    return total + 1
  }, 0)

  if (!cleared) return

  stats.lines += cleared
  stats.score += (scoreByLines[cleared] || 0) * stats.level
  stats.level = Math.floor(stats.lines / 10) + 1
  dropInterval = Math.max(100, 800 - (stats.level - 1) * 70)
  updateStats()
}

const updateStats = () => {
  pointsEl.textContent = stats.score.toString()
  linesEl.textContent = String(stats.lines)
  levelEl.textContent = String(stats.level)
}

const lockPiece = () => {
  merge()
  clearLines()
  piece = nextPiece || randomPiece()
  nextPiece = randomPiece()

  if (collides(piece.x, piece.y, piece.matrix)) {
    isRunning = false
    statusEl.textContent = "Game over"
    return
  }

  statusEl.textContent = ""
}

const tryMove = (dx, dy) => {
  if (collides(piece.x + dx, piece.y + dy, piece.matrix)) return false
  piece.x += dx
  piece.y += dy
  return true
}

const hardDrop = () => {
  let distance = 0
  while (tryMove(0, 1)) distance += 1

  stats.score += distance * 2
  lockPiece()
  updateStats()
}

const rotatePiece = () => {
  const rotated = rotate(piece.matrix)
  const originalX = piece.x
  const kicks = [0, -1, 1, -2, 2]

  for (const k of kicks) {
    if (!collides(originalX + k, piece.y, rotated)) {
      piece.matrix = rotated
      piece.x += k
      return
    }
  }
}

const drop = () => {
  if (tryMove(0, 1)) return

  lockPiece()
}

const tick = (time = 0) => {
  if (!isRunning) return
  if (!lastTime) lastTime = time
  const elapsed = time - lastTime
  lastTime = time
  dropTimer += elapsed

  if (dropTimer >= dropInterval) {
    drop()
    dropTimer = 0
  }

  drawBoard()
  requestAnimationFrame(tick)
}

const start = () => {
  board = clearBoard()
  stats = {
    score: 0,
    lines: 0,
    level: 1
  }

  piece = randomPiece()
  nextPiece = randomPiece()
  isRunning = true
  dropTimer = 0
  dropInterval = 800
  lastTime = 0
  statusEl.textContent = ""
  updateStats()
  requestAnimationFrame(tick)
}

document.addEventListener("keydown", (event) => {
  if (!isRunning) return

  const moveActions = {
    ArrowLeft: () => tryMove(-1, 0),
    KeyA: () => tryMove(-1, 0),
    ArrowRight: () => tryMove(1, 0),
    KeyD: () => tryMove(1, 0),
    ArrowDown: () => {
      if (tryMove(0, 1)) {
        stats.score += 1
        updateStats()
      }
    },
    ArrowUp: rotatePiece,
    KeyW: rotatePiece,
    KeyX: rotatePiece,
    Space: hardDrop
  }

  const action = moveActions[event.code]
  if (!action) return

  event.preventDefault()
  action()
})

restartButton.addEventListener("click", () => {
  isRunning = false
  start()
})

start()
