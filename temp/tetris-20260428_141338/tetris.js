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

const pieces = [
  [[1, 1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 1], [1, 1, 0]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
]

const colorsByIndex = ["I", "J", "L", "O", "S", "T", "Z"]
const lineRewards = [0, 100, 300, 500, 800]

let board = []
let activePiece
let nextPiece
let bag = []
let score = 0
let lines = 0
let level = 1
let dropSpeed = 900
let dropAccumulator = 0
let gameOver = false
let paused = false
let lastTime = 0

function createBoard() {
  return Array.from({ length: rows }, () => Array(columns).fill(0))
}

function cloneShape(shape) {
  return shape.map((row) => [...row])
}

function pickFromBag() {
  if (bag.length === 0) {
    bag = [...colorsByIndex]
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const swapAt = Math.floor(Math.random() * (i + 1))
      const value = bag[i]
      bag[i] = bag[swapAt]
      bag[swapAt] = value
    }
  }

  const color = bag.pop()
  const index = colorsByIndex.indexOf(color)

  return {
    shape: cloneShape(pieces[index]),
    color,
    x: Math.floor((columns - pieces[index][0].length) / 2),
    y: 0,
  }
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function collides(piece, deltaX = 0, deltaY = 0, candidate = piece.shape) {
  return candidate.some((row, y) =>
    row.some((filled, x) => {
      if (!filled) {
        return false
      }

      const nextX = piece.x + x + deltaX
      const nextY = piece.y + y + deltaY

      if (nextX < 0 || nextX >= columns || nextY >= rows) {
        return true
      }

      return nextY >= 0 && board[nextY][nextX]
    }),
  )
}

function lockPiece() {
  activePiece.shape.forEach((row, y) =>
    row.forEach((filled, x) => {
      if (filled) {
        board[activePiece.y + y][activePiece.x + x] = activePiece.color
      }
    }),
  )
}

function clearRows() {
  let cleared = 0
  for (let y = rows - 1; y >= 0; y -= 1) {
    if (!board[y].every((cell) => cell)) {
      continue
    }

    board.splice(y, 1)
    board.unshift(Array(columns).fill(0))
    cleared += 1
    y += 1
  }
  return cleared
}

function spawnPiece() {
  activePiece = nextPiece || pickFromBag()
  nextPiece = pickFromBag()
  activePiece.x = Math.floor((columns - activePiece.shape[0].length) / 2)
  activePiece.y = 0

  if (collides(activePiece)) {
    gameOver = true
    overlay.textContent = "Game Over"
    overlay.classList.remove("hidden")
    return false
  }

  return true
}

function applyScoreForDrop(linesCleared) {
  lines += linesCleared
  score += lineRewards[linesCleared] * level
  level = 1 + Math.floor(lines / 10)
  dropSpeed = Math.max(110, 900 - (level - 1) * 70)
}

function settlePiece() {
  lockPiece()
  const linesCleared = clearRows()
  if (linesCleared > 0) {
    applyScoreForDrop(linesCleared)
  }
  spawnPiece()
}

function movePiece(dx, dy) {
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

function softDrop() {
  if (!movePiece(0, 1)) {
    settlePiece()
  }
}

function hardDrop() {
  while (!collides(activePiece, 0, 1)) {
    activePiece.y += 1
    score += 2
  }
  settlePiece()
}

function rotateActive() {
  const rotated = rotate(activePiece.shape)
  if (!collides(activePiece, 0, 0, rotated)) {
    activePiece.shape = rotated
  }
}

function drawCell(context, x, y, color) {
  context.fillStyle = colors[color]
  context.fillRect(x * block, y * block, block, block)
  context.strokeStyle = "rgba(255, 255, 255, 0.18)"
  context.strokeRect(x * block + 1, y * block + 1, block - 2, block - 2)
}

function renderBoard() {
  boardContext.setTransform(1, 0, 0, 1, 0, 0)
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = "#090d23"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  board.forEach((row, y) =>
    row.forEach((color, x) => {
      if (color) {
        drawCell(boardContext, x, y, color)
      }
    }),
  )

  activePiece.shape.forEach((row, y) =>
    row.forEach((filled, x) => {
      if (filled) {
        drawCell(boardContext, activePiece.x + x, activePiece.y + y, activePiece.color)
      }
    }),
  )

  if (gameOver) {
    boardContext.fillStyle = "rgba(0, 0, 0, 0.52)"
    boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)
  }
}

function renderNext() {
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextContext.fillStyle = "#0d1330"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  const offsetX = Math.max(0, 2 - nextPiece.shape[0].length / 2)
  nextPiece.shape.forEach((row, y) =>
    row.forEach((filled, x) => {
      if (filled) {
        nextContext.fillStyle = colors[nextPiece.color]
        nextContext.fillRect((x + 1 - offsetX) * block, (y + 1) * block, block, block)
        nextContext.strokeStyle = "rgba(255, 255, 255, 0.18)"
        nextContext.strokeRect((x + 1 - offsetX) * block + 1, (y + 1) * block + 1, block - 2, block - 2)
      }
    }),
  )
}

function updateStats() {
  scoreElement.textContent = String(score)
  linesElement.textContent = String(lines)
  levelElement.textContent = String(level)
}

function render() {
  renderBoard()
  renderNext()
  updateStats()

  if (paused) {
    overlay.textContent = "Paused"
    overlay.classList.remove("hidden")
    return
  }

  if (!gameOver) {
    overlay.classList.add("hidden")
  }
}

function animate(time = 0) {
  const delta = time - lastTime
  lastTime = time

  if (!gameOver && !paused) {
    dropAccumulator += delta
    if (dropAccumulator >= dropSpeed) {
      dropAccumulator = 0
      softDrop()
    }
  }

  render()
  requestAnimationFrame(animate)
}

function start() {
  board = createBoard()
  score = 0
  lines = 0
  level = 1
  dropSpeed = 900
  dropAccumulator = 0
  gameOver = false
  paused = false
  lastTime = 0
  bag = []
  nextPiece = pickFromBag()
  spawnPiece()
  overlay.classList.add("hidden")
  updateStats()
}

document.addEventListener("keydown", (event) => {
  if (gameOver && event.code !== "KeyR" && event.code !== "Enter") {
    return
  }

  if (event.code === "KeyP") {
    if (gameOver) {
      return
    }

    paused = !paused
    if (!paused) {
      overlay.classList.add("hidden")
    }
    return
  }

  if (paused) {
    return
  }

  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    event.preventDefault()
    movePiece(-1, 0)
  }

  if (event.code === "ArrowRight" || event.code === "KeyD") {
    event.preventDefault()
    movePiece(1, 0)
  }

  if (event.code === "ArrowDown" || event.code === "KeyS") {
    event.preventDefault()
    score += 1
    softDrop()
  }

  if (event.code === "ArrowUp" || event.code === "KeyW") {
    event.preventDefault()
    rotateActive()
  }

  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }

  if (event.code === "KeyR" || event.code === "Enter") {
    start()
  }
})

resetButton.addEventListener("click", start)

start()
requestAnimationFrame(animate)
