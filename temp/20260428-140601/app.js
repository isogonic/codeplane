const board = document.getElementById("board")
const boardCtx = board.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextCtx = nextCanvas.getContext("2d")
const scoreNode = document.getElementById("score")
const linesNode = document.getElementById("lines")
const levelNode = document.getElementById("level")
const restartButton = document.getElementById("restart")

const COLS = 10
const ROWS = 20
const CELL = 30
const BASE_INTERVAL = 850

const SHAPES = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
}

const COLORS = {
  I: "#38bdf8",
  J: "#60a5fa",
  L: "#fb923c",
  O: "#facc15",
  S: "#22c55e",
  T: "#c084fc",
  Z: "#f43f5e",
}

let field
let piece
let queue
let score
let lines
let level
let dropMs
let gameOver
let paused
let raf
let accumulator
let lastTime

const blankRow = () => Array.from({ length: COLS }, () => 0)
const cloneMatrix = (matrix) => matrix.map((row) => [...row])

const makeField = () => Array.from({ length: ROWS }, blankRow)

const randomPiece = () => {
  const names = Object.keys(SHAPES)
  const next = names[Math.floor(Math.random() * names.length)]
  return {
    name: next,
    matrix: cloneMatrix(SHAPES[next]),
    color: COLORS[next],
  }
}

const rotate = (matrix) => matrix[0].map((_, col) => matrix.map((row) => row[col]).reverse())

const collides = (x, y, matrix = piece.matrix) => {
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row].length; col++) {
      if (!matrix[row][col]) continue

      const px = x + col
      const py = y + row

      if (px < 0 || px >= COLS || py >= ROWS) return true
      if (py < 0) continue
      if (field[py][px]) return true
    }
  }

  return false
}

const lockPiece = () => {
  piece.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell || piece.y + y < 0) return
      field[piece.y + y][piece.x + x] = piece.color
    })
  })
}

const clearLines = () => {
  let removed = 0

  for (let row = ROWS - 1; row >= 0; ) {
    const isFull = field[row].every(Boolean)

    if (!isFull) {
      row--
      continue
    }

    field.splice(row, 1)
    field.unshift(blankRow())
    removed++
  }

  if (!removed) return

  const scoreTable = [0, 100, 300, 500, 800]
  score += scoreTable[Math.min(removed, scoreTable.length - 1)] * level
  lines += removed
  level = Math.floor(lines / 10) + 1
  dropMs = Math.max(130, BASE_INTERVAL - (level - 1) * 65)

  scoreNode.textContent = `${score}`
  linesNode.textContent = `${lines}`
  levelNode.textContent = `${level}`
}

const ghostY = () => {
  let ghost = piece.y

  while (!collides(piece.x, ghost + 1, piece.matrix)) {
    ghost += 1
  }

  return ghost
}

const move = (dx, dy) => {
  if (gameOver || paused) return

  const targetX = piece.x + dx
  const targetY = piece.y + dy

  if (!collides(targetX, targetY)) {
    piece.x = targetX
    piece.y = targetY
    return true
  }

  if (!dy) return false

  lockPiece()
  clearLines()
  spawnPiece()

  return false
}

const rotateCurrent = () => {
  if (gameOver || paused) return

  const original = piece.matrix
  const rotated = rotate(original)
  const startX = piece.x
  const shifts = [0, -1, 1, -2, 2]
  piece.matrix = rotated

  const canUse = shifts.some((dx) => {
    const nextX = startX + dx
    if (collides(nextX, piece.y, rotated)) {
      return false
    }

    piece.x = nextX
    return true
  })

  if (!canUse) {
    piece.matrix = original
    piece.x = startX
  }
}

const hardDrop = () => {
  if (gameOver || paused) return

  while (!collides(piece.x, piece.y + 1)) {
    piece.y += 1
    score += 2
  }

  scoreNode.textContent = `${score}`
  move(0, 1)
}

const spawnPiece = () => {
  if (!queue) queue = randomPiece()

  piece = {
    x: Math.floor(COLS / 2) - Math.ceil(queue.matrix[0].length / 2),
    y: 0,
    matrix: queue.matrix,
    color: queue.color,
    name: queue.name,
  }

  queue = randomPiece()
  drawQueue()

  if (collides(piece.x, piece.y)) {
    gameOver = true
    paused = true
  }
}

const drawCell = (x, y, color, ctx, shadow = false) => {
  const px = x * CELL
  const py = y * CELL

  ctx.fillStyle = color
  ctx.fillRect(px, py, CELL, CELL)

  if (shadow) {
    ctx.globalAlpha = 0.4
    ctx.fillRect(px, py, CELL, CELL)
    ctx.globalAlpha = 1
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.2)"
    ctx.fillRect(px + 4, py + 4, CELL - 8, 3)
    ctx.strokeStyle = "rgba(255,255,255,0.12)"
    ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2)
  }
}

const drawBoard = () => {
  boardCtx.fillStyle = "#020617"
  boardCtx.fillRect(0, 0, board.width, board.height)

  field.forEach((row, y) => {
    row.forEach((color, x) => {
      if (color) drawCell(x, y, color, boardCtx)
    })
  })

  const shadowY = ghostY()
  piece.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return

      const px = piece.x + x
      const py = shadowY + y
      if (py >= 0 && py < ROWS) drawCell(px, py, piece.color, boardCtx, true)
    })
  })

  piece.matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return

      const px = piece.x + x
      const py = piece.y + y
      if (py < 0) return
      drawCell(px, py, piece.color, boardCtx)
    })
  })

  if (gameOver) {
    boardCtx.fillStyle = "rgba(2, 6, 23, 0.84)"
    boardCtx.fillRect(0, 220, board.width, 160)
    boardCtx.fillStyle = "#f8fafc"
    boardCtx.textAlign = "center"
    boardCtx.font = "bold 30px sans-serif"
    boardCtx.fillText("GAME OVER", board.width / 2, 290)
    boardCtx.font = "15px sans-serif"
    boardCtx.fillText("Press R to restart", board.width / 2, 320)
  }
  if (paused && !gameOver) {
    boardCtx.fillStyle = "rgba(2, 6, 23, 0.6)"
    boardCtx.fillRect(0, 250, board.width, 100)
    boardCtx.fillStyle = "#f8fafc"
    boardCtx.textAlign = "center"
    boardCtx.font = "bold 28px sans-serif"
    boardCtx.fillText("PAUSED", board.width / 2, 308)
  }
}

const drawQueue = () => {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextCtx.fillStyle = "rgba(2,6,23,0.7)"
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  if (!queue) return

  const cell = 24
  const ox = 12
  const oy = 12

  queue.matrix.forEach((row, y) => {
    row.forEach((cellValue, x) => {
      if (!cellValue) return

      const px = x * cell + ox
      const py = y * cell + oy
      nextCtx.fillStyle = queue.color
      nextCtx.fillRect(px, py, cell, cell)
      nextCtx.fillStyle = "rgba(255,255,255,0.2)"
      nextCtx.fillRect(px + 4, py + 4, cell - 8, 3)
    })
  })
}

const gameLoop = (time = 0) => {
  const delta = time - lastTime
  lastTime = time
  accumulator += delta

  if (!gameOver && !paused && accumulator >= dropMs) {
    move(0, 1)
    accumulator = 0
  }

  drawBoard()
  raf = requestAnimationFrame(gameLoop)
}

const reset = () => {
  field = makeField()
  queue = null
  score = 0
  lines = 0
  level = 1
  dropMs = BASE_INTERVAL
  gameOver = false
  paused = false
  accumulator = 0
  lastTime = 0

  scoreNode.textContent = "0"
  linesNode.textContent = "0"
  levelNode.textContent = "1"

  spawnPiece()
  cancelAnimationFrame(raf)
  requestAnimationFrame(gameLoop)
}

const handleKey = (event) => {
  if (gameOver && event.code !== "KeyR") return

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
    score += 1
    move(0, 1)
    scoreNode.textContent = `${score}`
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
    return
  }

  if (event.code === "KeyP") {
    event.preventDefault()
    if (!gameOver) paused = !paused
    return
  }

  if (event.code === "KeyR") {
    reset()
  }
}

document.addEventListener("keydown", handleKey)
restartButton.addEventListener("click", reset)

field = makeField()
reset()
