const COLS = 10
const ROWS = 20
const SIZE = 30

const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const scoreElement = document.getElementById("score")
const linesElement = document.getElementById("lines")
const levelElement = document.getElementById("level")
const overlayElement = document.getElementById("overlay")
const restartButton = document.getElementById("restart")

boardContext.setTransform(SIZE, 0, 0, SIZE, 0.5, 0.5)
nextContext.setTransform(20, 0, 0, 20, 10, 10)

const pieces = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1]],
  J: [[2, 0, 0], [2, 2, 2]],
  L: [[0, 0, 3], [3, 3, 3]],
  O: [[4, 4], [4, 4]],
  S: [[0, 5, 5], [5, 5, 0]],
  T: [[0, 6, 0], [6, 6, 6]],
  Z: [[7, 7, 0], [0, 7, 7]],
}

const colors = [
  "#000",
  "#3abff8",
  "#ffd166",
  "#f15bb5",
  "#4cc9f0",
  "#2ec4b6",
  "#ff9f1c",
  "#8cff8c",
]

const state = {
  board: createMatrix(COLS, ROWS),
  player: createPlayer(),
  next: randomPiece(),
  score: 0,
  lines: 0,
  level: 1,
  dropAccumulator: 0,
  dropDelay: 900,
  lastFrame: 0,
  over: false,
}

function createMatrix(width, height) {
  return new Array(height).fill(0).map(() => new Array(width).fill(0))
}

function createPlayer() {
  return {
    pos: { x: 0, y: 0 },
    matrix: randomPiece(),
  }
}

function randomPiece() {
  const keys = Object.keys(pieces)
  const key = keys[Math.floor(Math.random() * keys.length)]
  return pieces[key].map((row) => row.slice())
}

function resetPlayer() {
  state.player.matrix = state.next
  state.player.pos.x = Math.floor((COLS - state.player.matrix[0].length) / 2)
  state.player.pos.y = 0
  state.next = randomPiece()

  if (collides(state.board, state.player)) {
    state.over = true
    overlayElement.hidden = false
  }
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function rotatePlayer() {
  const startX = state.player.pos.x
  let offset = 1
  state.player.matrix = rotate(state.player.matrix)

  while (collides(state.board, state.player)) {
    state.player.pos.x += offset
    offset = -offset - (offset > 0 ? 1 : -1)

    if (Math.abs(offset) > state.player.matrix[0].length) {
      state.player.matrix = rotate(rotate(rotate(state.player.matrix)))
      state.player.pos.x = startX
      return
    }
  }
}

function collides(board, player) {
  return player.matrix.some((row, y) =>
    row.some((value, x) => {
      if (!value) return false

      const bx = x + player.pos.x
      const by = y + player.pos.y

      if (bx < 0 || bx >= COLS || by >= ROWS) return true
      if (by < 0) return false

      return board[by][bx] !== 0
    }),
  )
}

function merge(board, player) {
  player.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        board[y + player.pos.y][x + player.pos.x] = value
      }
    })
  })
}

function clearLines() {
  let cleared = 0

  for (let y = ROWS - 1; y >= 0; y--) {
    if (state.board[y].every((value) => value !== 0)) {
      state.board.splice(y, 1)
      state.board.unshift(new Array(COLS).fill(0))
      cleared += 1
      y += 1
    }
  }

  if (cleared === 0) return

  state.lines += cleared
  state.score += [0, 100, 300, 500, 800][Math.min(cleared, 4)] * state.level
  state.level = Math.floor(state.lines / 10) + 1
  state.dropDelay = Math.max(140, 900 - (state.level - 1) * 75)
}

function draw(matrix, offset, tint) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return

      boardContext.fillStyle = tint || colors[value]
      boardContext.fillRect(x + offset.x, y + offset.y, 1, 1)
      boardContext.strokeStyle = "rgba(255, 255, 255, 0.32)"
      boardContext.lineWidth = 0.08
      boardContext.strokeRect(x + offset.x, y + offset.y, 1, 1)
    })
  })
}

function drawNext() {
  nextContext.clearRect(-10, -10, nextCanvas.width, nextCanvas.height)

  const ox = (4 - state.next[0].length) / 2
  const oy = (4 - state.next.length) / 2

  state.next.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return

      nextContext.fillStyle = colors[value]
      nextContext.fillRect(ox + x, oy + y, 1, 1)
      nextContext.strokeStyle = "rgba(255, 255, 255, 0.38)"
      nextContext.strokeRect(ox + x, oy + y, 1, 1)
    })
  })
}

function drawBoard() {
  boardContext.clearRect(0, 0, boardCanvas.width / SIZE, boardCanvas.height / SIZE)
  draw(state.board, { x: 0, y: 0 })
  draw(state.player.matrix, state.player.pos)
  drawNext()
}

function softDrop() {
  state.player.pos.y += 1

  if (collides(state.board, state.player)) {
    state.player.pos.y -= 1
    merge(state.board, state.player)
    clearLines()
    resetPlayer()
    updateHud()
  }

  state.dropAccumulator = 0
}

function hardDrop() {
  while (!collides(state.board, {
    ...state.player,
    pos: { ...state.player.pos, y: state.player.pos.y + 1 },
  })) {
    state.player.pos.y += 1
  }

  state.score += 2
  merge(state.board, state.player)
  clearLines()
  resetPlayer()
  updateHud()
  state.dropAccumulator = 0
}

function move(direction) {
  state.player.pos.x += direction
  if (collides(state.board, state.player)) {
    state.player.pos.x -= direction
  }
}

function updateHud() {
  scoreElement.textContent = state.score
  linesElement.textContent = state.lines
  levelElement.textContent = state.level
}

function step(time = 0) {
  const dt = time - state.lastFrame
  state.lastFrame = time
  state.dropAccumulator += dt

  if (state.dropAccumulator >= state.dropDelay) {
    softDrop()
  }

  drawBoard()

  if (!state.over) {
    requestAnimationFrame(step)
  }
}

function start() {
  state.board = createMatrix(COLS, ROWS)
  state.player = createPlayer()
  state.next = randomPiece()
  state.score = 0
  state.lines = 0
  state.level = 1
  state.dropDelay = 900
  state.dropAccumulator = 0
  state.lastFrame = 0
  state.over = false
  overlayElement.hidden = true

  resetPlayer()
  updateHud()
  drawBoard()
  requestAnimationFrame(step)
}

document.addEventListener("keydown", (event) => {
  if (state.over) {
    if (event.key === "r" || event.key === "R") {
      start()
    }
    return
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault()
    move(-1)
  }

  if (event.key === "ArrowRight") {
    event.preventDefault()
    move(1)
  }

  if (event.key === "ArrowDown") {
    event.preventDefault()
    softDrop()
  }

  if (event.key === "ArrowUp") {
    event.preventDefault()
    rotatePlayer()
  }

  if (event.key === " ") {
    event.preventDefault()
    hardDrop()
  }

  if (event.key === "r" || event.key === "R") {
    start()
  }
})

restartButton.addEventListener("click", start)

start()
