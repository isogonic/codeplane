const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const scoreElement = document.getElementById("score")
const levelElement = document.getElementById("level")
const linesElement = document.getElementById("lines")
const statusElement = document.getElementById("status")

const COLUMNS = 10
const ROWS = 20
const CELL_SIZE = 30
const NEXT_CELL_SIZE = 24

const colors = {
  0: "rgba(255,255,255,0.06)",
  1: "#00c8ff",
  2: "#f9df6d",
  3: "#00d084",
  4: "#ff5f65",
  5: "#2f95ff",
  6: "#ff8f4d",
  7: "#b36bff",
}

const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[2, 2], [2, 2]],
  T: [[0, 3, 0], [3, 3, 3]],
  S: [[0, 4, 4], [4, 4, 0]],
  Z: [[5, 5, 0], [0, 5, 5]],
  J: [[6, 0, 0], [6, 6, 6]],
  L: [[0, 0, 7], [7, 7, 7]],
}

const shapeKeys = Object.keys(SHAPES)

const makeRow = (value = 0) => Array.from({ length: COLUMNS }, () => value)
const makeBoard = () => Array.from({ length: ROWS }, () => makeRow())
const cloneMatrix = (matrix) => matrix.map((row) => row.slice())

const shuffle = (values) => {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = values[i]
    values[i] = values[j]
    values[j] = temp
  }
}

let board = makeBoard()
let running = false
let paused = false
let gameOver = false
let lastTime = 0
let dropCounter = 0
let dropDelay = 950
let score = 0
let level = 1
let lines = 0
let bag = []

let active = { matrix: randomShape(), x: 3, y: -1 }
let upcoming = randomShape()

function randomShape() {
  if (!bag.length) {
    bag = [...shapeKeys]
    shuffle(bag)
  }

  const piece = bag.pop()
  return cloneMatrix(SHAPES[piece])
}

function startMessage() {
  if (!running) statusElement.textContent = "Press any arrow key to start"
}

function setMessage(message) {
  statusElement.textContent = message
}

function matrixRotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function collide(matrix, x, y) {
  return matrix.some((row, rowIndex) =>
    row.some((value, colIndex) => {
      if (!value) return false

      const boardX = colIndex + x
      const boardY = rowIndex + y
      return (
        boardX < 0 ||
        boardX >= COLUMNS ||
        boardY >= ROWS ||
        (boardY >= 0 && board[boardY][boardX] !== 0)
      )
    }),
  )
}

function place() {
  active.matrix.forEach((row, rowIndex) =>
    row.forEach((value, colIndex) => {
      if (!value) return
      const boardX = colIndex + active.x
      const boardY = rowIndex + active.y
      if (boardY >= 0) board[boardY][boardX] = value
    }),
  )
}

function clearFullRows() {
  let cleared = 0
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row].every((cell) => cell !== 0)) {
      board.splice(row, 1)
      board.unshift(makeRow())
      cleared += 1
      row += 1
    }
  }

  if (!cleared) return

  lines += cleared
  linesElement.textContent = String(lines)

  const award = { 1: 40, 2: 100, 3: 300, 4: 1200 }
  score += (award[cleared] || 0) * level
  scoreElement.textContent = String(score)

  level = Math.floor(lines / 10) + 1
  levelElement.textContent = String(level)
  dropDelay = Math.max(120, 950 - level * 70)
}

function move(dx, dy) {
  const nextX = active.x + dx
  const nextY = active.y + dy
  if (!collide(active.matrix, nextX, nextY)) {
    active.x = nextX
    active.y = nextY
    return true
  }

  return false
}

function rotatePiece() {
  const nextMatrix = matrixRotate(active.matrix)
  if (!collide(nextMatrix, active.x, active.y)) {
    active.matrix = nextMatrix
    return
  }

  const wallKick = active.x > COLUMNS / 2 ? -1 : 1
  if (!collide(nextMatrix, active.x + wallKick, active.y)) {
    active.x += wallKick
    active.matrix = nextMatrix
  }
}

function spawnNext() {
  active = { matrix: upcoming, x: 3, y: -1 }
  upcoming = randomShape()

  if (collide(active.matrix, active.x, active.y)) {
    gameOver = true
    running = false
    setMessage("Game Over - press R to restart")
  }
}

function dropHard() {
  let moved = 0
  while (move(0, 1)) moved += 1
  score += moved * 2
  scoreElement.textContent = String(score)
  lock()
}

function lock() {
  place()
  clearFullRows()
  if (!gameOver) spawnNext()
}

function tickDown() {
  if (move(0, 1)) return
  lock()
}

function softDrop() {
  if (!running || paused) return
  tickDown()
  score += 1
  scoreElement.textContent = String(score)
}

function draw() {
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = "#090d1a"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  board.forEach((row, rowIndex) =>
    row.forEach((value, colIndex) => {
      boardContext.fillStyle = colors[value]
      boardContext.fillRect(colIndex * CELL_SIZE, rowIndex * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      boardContext.strokeStyle = value ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)"
      boardContext.strokeRect(colIndex * CELL_SIZE, rowIndex * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }),
  )

  active.matrix.forEach((row, rowIndex) =>
    row.forEach((value, colIndex) => {
      const x = colIndex + active.x
      const y = rowIndex + active.y
      if (!value || y < 0) return
      boardContext.fillStyle = colors[value]
      boardContext.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      boardContext.strokeStyle = "rgba(255,255,255,0.4)"
      boardContext.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }),
  )

  nextContext.fillStyle = "#090d1a"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  upcoming.forEach((row, rowIndex) =>
    row.forEach((value, colIndex) => {
      if (!value) return
      nextContext.fillStyle = colors[value]
      nextContext.fillRect((colIndex + 1) * NEXT_CELL_SIZE, (rowIndex + 1) * NEXT_CELL_SIZE, NEXT_CELL_SIZE, NEXT_CELL_SIZE)
      nextContext.strokeStyle = "rgba(255,255,255,0.22)"
      nextContext.strokeRect((colIndex + 1) * NEXT_CELL_SIZE, (rowIndex + 1) * NEXT_CELL_SIZE, NEXT_CELL_SIZE, NEXT_CELL_SIZE)
    }),
  )

  if (!running && !gameOver) {
    return
  }

  if (paused) {
    setMessage("Paused - press P to continue")
  }
}

function reset() {
  board = makeBoard()
  score = 0
  lines = 0
  level = 1
  dropDelay = 950
  dropCounter = 0
  running = true
  gameOver = false
  paused = false
  bag = []
  active = { matrix: randomShape(), x: 3, y: -1 }
  upcoming = randomShape()
  scoreElement.textContent = "0"
  linesElement.textContent = "0"
  levelElement.textContent = "1"
  setMessage("")
}

function update(time) {
  const delta = time - lastTime
  lastTime = time

  if (running && !paused && !gameOver) {
    dropCounter += delta
    if (dropCounter > dropDelay) {
      tickDown()
      dropCounter = 0
    }
  }

  draw()
  requestAnimationFrame(update)
}

document.addEventListener("keydown", (event) => {
  if (gameOver && (event.key !== "r" && event.key !== "R")) {
    event.preventDefault()
    return
  }

  if (event.key === "r" || event.key === "R") {
    reset()
    return
  }

  if (!running) {
    if (event.key.startsWith("Arrow")) {
      running = true
      setMessage("")
      event.preventDefault()
      return
    }
    return
  }

  if (event.key === "p" || event.key === "P") {
    paused = !paused
    setMessage(paused ? "Paused - press P to continue" : "")
    return
  }

  const actions = {
    ArrowLeft() {
      move(-1, 0)
    },
    ArrowRight() {
      move(1, 0)
    },
    ArrowDown() {
      softDrop()
    },
    ArrowUp() {
      rotatePiece()
    },
    " "() {
      dropHard()
    },
  }

  const action = actions[event.key]
  if (!action) return

  if (paused) return
  event.preventDefault()
  action()
})

startMessage()
requestAnimationFrame(update)
