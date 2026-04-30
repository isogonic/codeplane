const COLS = 10
const ROWS = 20
const TILE = 30

const boardCanvas = document.getElementById("board")
const boardCtx = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextCtx = nextCanvas.getContext("2d")
const scoreEl = document.getElementById("score")
const linesEl = document.getElementById("lines")
const levelEl = document.getElementById("level")
const overlay = document.getElementById("overlay")
const restartButton = document.getElementById("restart")

boardCtx.setTransform(TILE, 0, 0, TILE, 0.5, 0.5)
nextCtx.setTransform(20, 0, 0, 20, 10, 10)

const colors = [
  "#000", // placeholder, index 0
  "#00a8ff",
  "#ffa500",
  "#9d3cff",
  "#35d0ba",
  "#ffe156",
  "#ff6384",
  "#7be28c",
]

const pieces = {
  I: [[1, 1, 1, 1]],
  J: [[3, 0, 0], [3, 3, 3]],
  L: [[0, 0, 4], [4, 4, 4]],
  O: [[5, 5], [5, 5]],
  S: [[0, 6, 6], [6, 6, 0]],
  T: [[0, 7, 0], [7, 7, 7]],
  Z: [[2, 2, 0], [0, 2, 2]],
}

const game = {
  board: createMatrix(COLS, ROWS),
  player: createPlayer(),
  next: randomPiece(),
  score: 0,
  lines: 0,
  level: 1,
  fallTime: 0,
  fallDelay: 900,
  last: 0,
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
  const types = Object.keys(pieces)
  return pieces[types[Math.floor(Math.random() * types.length)]]
    .map((row) => row.slice())
}

function clone(matrix) {
  return matrix.map((row) => row.slice())
}

function resetPlayer() {
  game.player.matrix = game.next
  game.player.pos.x = Math.floor((COLS - game.player.matrix[0].length) / 2)
  game.player.pos.y = 0
  game.next = randomPiece()

  if (collides(game.board, game.player)) {
    game.over = true
    overlay.hidden = false
  }
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function rotatePlayer() {
  const startX = game.player.pos.x
  let shift = 1
  game.player.matrix = rotate(game.player.matrix)

  while (collides(game.board, game.player)) {
    game.player.pos.x += shift
    shift = -shift - (shift > 0 ? 1 : -1)

    if (Math.abs(shift) > game.player.matrix[0].length) {
      game.player.matrix = rotate(rotate(rotate(game.player.matrix)))
      game.player.pos.x = startX
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
  let removed = 0

  for (let y = ROWS - 1; y >= 0; y--) {
    if (game.board[y].every((value) => value !== 0)) {
      game.board.splice(y, 1)
      game.board.unshift(new Array(COLS).fill(0))
      removed += 1
      y += 1
    }
  }

  if (removed > 0) {
    game.lines += removed
    game.score += [0, 100, 300, 500, 800][Math.min(removed, 4)] * game.level
    game.level = Math.floor(game.lines / 10) + 1
    game.fallDelay = Math.max(120, 900 - (game.level - 1) * 70)
  }
}

function draw(matrix, offset, tint) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return

      boardCtx.fillStyle = tint || colors[value]
      boardCtx.fillRect(x + offset.x, y + offset.y, 1, 1)
      boardCtx.strokeStyle = "rgba(255, 255, 255, 0.35)"
      boardCtx.lineWidth = 0.08
      boardCtx.strokeRect(x + offset.x, y + offset.y, 1, 1)
    })
  })
}

function drawNext() {
  nextCtx.clearRect(-10, -10, nextCanvas.width, nextCanvas.height)
  const ox = (4 - game.next[0].length) / 2
  const oy = (4 - game.next.length) / 2

  game.next.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return

      nextCtx.fillStyle = colors[value]
      nextCtx.fillRect(ox + x, oy + y, 1, 1)
      nextCtx.strokeStyle = "rgba(255, 255, 255, 0.35)"
      nextCtx.strokeRect(ox + x, oy + y, 1, 1)
    })
  })
}

function render() {
  boardCtx.clearRect(0, 0, boardCanvas.width / TILE, boardCanvas.height / TILE)
  draw(game.board, { x: 0, y: 0 })
  draw(game.player.matrix, game.player.pos)

  nextCtx.clearRect(0, 0, 6, 6)
  drawNext()
}

function softDrop() {
  game.player.pos.y += 1

  if (collides(game.board, game.player)) {
    game.player.pos.y -= 1
    merge(game.board, game.player)
    clearLines()
    resetPlayer()
    updatePanel()
  }

  game.fallTime = 0
}

function hardDrop() {
  while (!collides(game.board, {
    ...game.player,
    pos: { ...game.player.pos, y: game.player.pos.y + 1 },
  })) {
    game.player.pos.y += 1
  }

  game.score += 2
  merge(game.board, game.player)
  clearLines()
  resetPlayer()
  updatePanel()
  game.fallTime = 0
}

function move(dir) {
  game.player.pos.x += dir

  if (collides(game.board, game.player)) {
    game.player.pos.x -= dir
  }
}

function update(time = 0) {
  const dt = time - game.last
  game.last = time
  game.fallTime += dt

  if (game.fallTime >= game.fallDelay) {
    softDrop()
  }

  render()

  if (!game.over) {
    requestAnimationFrame(update)
  }
}

function updatePanel() {
  scoreEl.textContent = game.score
  linesEl.textContent = game.lines
  levelEl.textContent = game.level
}

function start() {
  game.board = createMatrix(COLS, ROWS)
  game.player = createPlayer()
  game.next = randomPiece()
  game.score = 0
  game.lines = 0
  game.level = 1
  game.fallDelay = 900
  game.fallTime = 0
  game.last = 0
  game.over = false
  overlay.hidden = true

  resetPlayer()
  updatePanel()
  render()

  requestAnimationFrame(update)
}

document.addEventListener("keydown", (event) => {
  if (game.over) {
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
