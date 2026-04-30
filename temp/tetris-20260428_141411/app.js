const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const scoreElement = document.getElementById("score")
const linesElement = document.getElementById("lines")
const levelElement = document.getElementById("level")
const messageElement = document.getElementById("message")
const pauseButton = document.getElementById("pause")
const restartButton = document.getElementById("restart")

const CELL = 30
const COLUMNS = 10
const ROWS = 20
const DROP_BASE = 830
const SCORE_TABLE = [0, 40, 100, 300, 1200]

const nextContextScale = nextContext.canvas.width / 4

const shapes = [
  { id: 1, shape: [[1, 1, 1, 1]], color: "#65f5ff" },
  { id: 2, shape: [[0, 2, 0], [2, 2, 2]], color: "#6f82ff" },
  { id: 3, shape: [[3, 3, 3], [0, 3, 0]], color: "#ffcf60" },
  { id: 4, shape: [[4, 4], [4, 4]], color: "#ffe27a" },
  { id: 5, shape: [[0, 5, 5], [5, 5, 0]], color: "#65ff9f" },
  { id: 6, shape: [[6, 0, 0], [6, 6, 6]], color: "#ff6f8a" },
  { id: 7, shape: [[7, 7, 0], [0, 7, 7]], color: "#b57bff" }
]

const colorById = shapes.reduce((map, piece) => {
  map[piece.id] = piece.color
  return map
}, {})

let grid = Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => 0))
let piece
let nextPiece
let dropDelta = 0
let dropInterval = DROP_BASE
let lastTime = 0
let score = 0
let lines = 0
let level = 1
let paused = false
let gameOver = false

const cloneShape = (shape) => shape.map((row) => [...row])

const createEmptyGrid = () => Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => 0))

const randomPiece = () => {
  const picked = shapes[Math.floor(Math.random() * shapes.length)]
  const shape = cloneShape(picked.shape)
  return {
    shape,
    id: picked.id,
    x: Math.floor(COLUMNS / 2) - Math.floor(shape[0].length / 2),
    y: -shape.length
  }
}

const rotate = (shape) => {
  const next = []
  const rows = shape.length
  const cols = shape[0].length
  for (let x = 0; x < cols; x += 1) {
    next[x] = []
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      next[x][rows - 1 - y] = shape[y][x]
    }
  }

  return next
}

const collides = (candidate) => {
  for (let y = 0; y < candidate.shape.length; y += 1) {
    for (let x = 0; x < candidate.shape[y].length; x += 1) {
      if (!candidate.shape[y][x]) {
        continue
      }

      const px = candidate.x + x
      const py = candidate.y + y

      if (px < 0 || px >= COLUMNS || py >= ROWS) {
        return true
      }

      if (py < 0) {
        continue
      }

      if (grid[py][px]) {
        return true
      }
    }
  }

  return false
}

const drawCell = (context, x, y, color, scale) => {
  context.fillStyle = color
  context.fillRect(x * scale, y * scale, scale, scale)
  context.strokeStyle = "rgba(255, 255, 255, 0.12)"
  context.strokeRect(x * scale, y * scale, scale, scale)
}

const drawGrid = () => {
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)

  boardContext.fillStyle = "#090d27"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)
  nextContext.fillStyle = "#070a24"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  boardContext.strokeStyle = "rgba(153, 173, 255, 0.1)"
  for (let x = 0; x <= COLUMNS; x += 1) {
    boardContext.beginPath()
    boardContext.moveTo(x * CELL, 0)
    boardContext.lineTo(x * CELL, boardCanvas.height)
    boardContext.stroke()
  }
  for (let y = 0; y <= ROWS; y += 1) {
    boardContext.beginPath()
    boardContext.moveTo(0, y * CELL)
    boardContext.lineTo(boardCanvas.width, y * CELL)
    boardContext.stroke()
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const id = grid[row][col]
      if (id === 0) {
        continue
      }
      drawCell(boardContext, col, row, colorById[id], CELL)
    }
  }

  for (let y = 0; y < piece.shape.length; y += 1) {
    for (let x = 0; x < piece.shape[y].length; x += 1) {
      if (!piece.shape[y][x]) {
        continue
      }

      const px = piece.x + x
      const py = piece.y + y
      if (py < 0) {
        continue
      }
      drawCell(boardContext, px, py, colorById[piece.id], CELL)
    }
  }

  const next = cloneShape(nextPiece.shape)
  const nextHeight = next.length
  const nextWidth = next[0].length
  const offsetX = Math.floor((4 - nextWidth) / 2)
  const offsetY = Math.floor((4 - nextHeight) / 2)

  for (let y = 0; y < next.length; y += 1) {
    for (let x = 0; x < next[y].length; x += 1) {
      if (!next[y][x]) {
        continue
      }
      drawCell(nextContext, offsetX + x, offsetY + y, colorById[nextPiece.id], nextContextScale)
    }
  }
}

const clearLines = () => {
  let cleared = 0
  const nextGrid = []

  for (let row = 0; row < ROWS; row += 1) {
    const full = grid[row].every((cell) => cell !== 0)
    if (full) {
      cleared += 1
    } else {
      nextGrid.push(grid[row])
    }
  }

  while (nextGrid.length < ROWS) {
    nextGrid.unshift(Array.from({ length: COLUMNS }, () => 0))
  }

  if (cleared > 0) {
    grid = nextGrid
    lines += cleared
    score += SCORE_TABLE[cleared] * level
    level = Math.floor(lines / 10) + 1
    dropInterval = Math.max(120, DROP_BASE - (level - 1) * 75)
  }
}

const stampPiece = () => {
  for (let y = 0; y < piece.shape.length; y += 1) {
    for (let x = 0; x < piece.shape[y].length; x += 1) {
      if (!piece.shape[y][x]) {
        continue
      }

      const px = piece.x + x
      const py = piece.y + y
      if (py >= 0) {
        grid[py][px] = piece.id
      }
    }
  }
}

const updateHud = () => {
  scoreElement.textContent = String(score)
  linesElement.textContent = String(lines)
  levelElement.textContent = String(level)
  messageElement.textContent = gameOver ? "Game Over" : paused ? "Paused" : "Playing"
}

const settle = () => {
  stampPiece()
  clearLines()
  piece = nextPiece
  nextPiece = randomPiece()

  const failed = collides(piece)
  if (failed) {
    gameOver = true
    paused = true
    updateHud()
  }
}

const movePiece = (xDelta, yDelta) => {
  if (gameOver || paused) {
    return
  }

  const moved = { ...piece, x: piece.x + xDelta, y: piece.y + yDelta }
  const blocked = collides(moved)
  if (!blocked) {
    piece = moved
    return
  }

  if (yDelta === 1) {
    settle()
  }
}

const tryRotate = () => {
  if (gameOver || paused) {
    return
  }

  const rotated = rotate(piece.shape)
  const attempts = [
    { x: 0 },
    { x: -1 },
    { x: 1 },
    { x: -2 },
    { x: 2 }
  ]

  for (let i = 0; i < attempts.length; i += 1) {
    const test = { ...piece, shape: rotated, x: piece.x + attempts[i].x }
    if (!collides(test)) {
      piece = test
      return
    }
  }
}

const hardDrop = () => {
  if (gameOver || paused) {
    return
  }

  let distance = 0
  const dropped = { ...piece }

  while (true) {
    const probe = { ...dropped, y: dropped.y + 1 }
    if (collides(probe)) {
      break
    }

    dropped.y += 1
    distance += 1
  }

  piece = dropped
  score += distance * 2
  settle()
}

const restart = () => {
  dropDelta = 0
  lastTime = 0
  grid = createEmptyGrid()
  score = 0
  lines = 0
  level = 1
  dropInterval = DROP_BASE
  pauseButton.textContent = "Pause"
  gameOver = false
  paused = false
  piece = randomPiece()
  nextPiece = randomPiece()
  messageElement.textContent = "Ready"
  updateHud()
  drawGrid()
}

const update = (time) => {
  if (lastTime === 0) {
    lastTime = time
  }

  const delta = time - lastTime
  lastTime = time

  if (!paused && !gameOver) {
    dropDelta += delta
    if (dropDelta >= dropInterval) {
      dropDelta = 0
      movePiece(0, 1)
    }
  }

  drawGrid()
  updateHud()
  requestAnimationFrame(update)
}

window.addEventListener("keydown", (event) => {
  const key = event.key

  if (key === "p" || key === "P") {
    if (!gameOver) {
      paused = !paused
      pauseButton.textContent = paused ? "Resume" : "Pause"
      updateHud()
    }
    return
  }

  if (key === "r" || key === "R") {
    restart()
    return
  }

  if (paused || gameOver) {
    return
  }

  if (key === "ArrowLeft") {
    event.preventDefault()
    movePiece(-1, 0)
  }

  if (key === "ArrowRight") {
    event.preventDefault()
    movePiece(1, 0)
  }

  if (key === "ArrowDown") {
    event.preventDefault()
    movePiece(0, 1)
  }

  if (key === "ArrowUp") {
    event.preventDefault()
    tryRotate()
  }

  if (key === " ") {
    event.preventDefault()
    hardDrop()
  }
})

pauseButton.addEventListener("click", () => {
  if (gameOver) {
    return
  }
  paused = !paused
  pauseButton.textContent = paused ? "Resume" : "Pause"
})

restartButton.addEventListener("click", restart)

nextPiece = randomPiece()
piece = randomPiece()
requestAnimationFrame(update)
