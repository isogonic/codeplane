const COLS = 10
const ROWS = 20

const SHAPES = [
  { color: "#2dd9ff", cells: [[1, 1, 1, 1]] },
  { color: "#5588ff", cells: [[1, 0, 0], [1, 1, 1]] },
  { color: "#ff924d", cells: [[0, 0, 1], [1, 1, 1]] },
  { color: "#ffd14a", cells: [[1, 1], [1, 1]] },
  { color: "#4de38a", cells: [[0, 1, 1], [1, 1, 0]] },
  { color: "#bc7cff", cells: [[0, 1, 0], [1, 1, 1]] },
  { color: "#ff5f84", cells: [[1, 1, 0], [0, 1, 1]] },
]

const scoreNode = document.getElementById("score")
const levelNode = document.getElementById("level")
const linesNode = document.getElementById("lines")
const statusNode = document.getElementById("status")
const boardNode = document.getElementById("board")
const nextNode = document.getElementById("next")

const board = Array.from({ length: ROWS }, () => Array(COLS).fill(0))
const boardCells = Array.from({ length: ROWS * COLS }, () => {
  const cell = document.createElement("div")
  cell.className = "cell"
  boardNode.appendChild(cell)
  return cell
})

const nextCells = Array.from({ length: 12 }, () => {
  const cell = document.createElement("div")
  cell.className = "cell"
  nextNode.appendChild(cell)
  return cell
})

let pieceBag = []
let active = null
let running = false
let paused = false
let lastTime = 0
let timer = 0
let fallDelay = 700
let score = 0
let level = 1
let lines = 0

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5)
}

function ensureBag() {
  if (pieceBag.length === 0) {
    pieceBag = shuffle(SHAPES)
  }
}

function getNextShape() {
  ensureBag()
  return structuredClone(pieceBag.shift())
}

function createPiece() {
  if (pieceBag.length < 2) ensureBag()
  const shape = getNextShape()
  return {
    color: shape.color,
    cells: shape.cells,
    x: Math.floor((COLS - shape.cells[0].length) / 2),
    y: -2,
  }
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map(row => row[x]).reverse())
}

function collided(piece, ox = 0, oy = 0, cells = piece.cells) {
  return cells.some((row, y) =>
    row.some((cell, x) => {
      if (!cell) return false
      const nx = piece.x + x + ox
      const ny = piece.y + y + oy
      if (ny < 0) return false
      return nx < 0 || nx >= COLS || ny >= ROWS || board[ny][nx] !== 0
    }),
  )
}

function paint(cell, color, active = false) {
  cell.style.background = color || "transparent"
  cell.style.borderColor = color ? `${color}99` : "#12205a"
  cell.className = `cell${active ? " filled" : ""}`.trim()
}

function draw() {
  board.flat().forEach((color, idx) => paint(boardCells[idx], color))

  if (!active) return

  active.cells.forEach((row, py) =>
    row.forEach((cell, px) => {
      if (!cell) return
      const bx = active.x + px
      const by = active.y + py
      if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) {
        paint(boardCells[by * COLS + bx], active.color, true)
      }
    }),
  )
}

function drawNext() {
  nextCells.forEach(cell => paint(cell, ""))
  const next = pieceBag[0]
  if (!next) return

  next.cells.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (!cell) return
      const nx = 1 + x
      const ny = y
      if (ny < 3 && nx < 4) {
        paint(nextCells[ny * 4 + nx], next.color)
      }
    }),
  )
}

function mergeActive() {
  active.cells.forEach((row, py) =>
    row.forEach((cell, px) => {
      if (!cell) return
      const bx = active.x + px
      const by = active.y + py
      if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) {
        board[by][bx] = active.color
      }
    }),
  )
}

function clearFullRows() {
  let cleared = 0
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row].every(cell => cell !== 0)) {
      board.splice(row, 1)
      board.unshift(Array(COLS).fill(0))
      cleared++
      row++
    }
  }
  return cleared
}

function spawn() {
  active = createPiece()
  if (collided(active)) {
    running = false
    paused = false
    statusNode.textContent = "Game over — press R"
    active = null
  }
  drawNext()
  draw()
}

function lockPiece() {
  mergeActive()
  const cleared = clearFullRows()
  if (cleared > 0) {
    const scoreByLines = [0, 100, 300, 500, 800]
    score += scoreByLines[cleared] * level
    lines += cleared
    level = Math.floor(lines / 10) + 1
    fallDelay = Math.max(120, 700 - (level - 1) * 60)
  }
  scoreNode.textContent = String(score)
  levelNode.textContent = String(level)
  linesNode.textContent = String(lines)
  spawn()
}

function move(dx) {
  if (!active || !running || paused) return
  if (!collided(active, dx)) {
    active.x += dx
    draw()
  }
}

function rotateActive() {
  if (!active || !running || paused) return
  const rotated = rotate(active.cells)
  if (!collided({ ...active, cells: rotated })) {
    active.cells = rotated
    draw()
  }
}

function step() {
  if (!active || !running || paused) return
  if (collided(active, 0, 1)) {
    lockPiece()
    return
  }
  active.y += 1
  timer = 0
  draw()
}

function hardDrop() {
  if (!active || !running || paused) return
  while (!collided(active, 0, 1)) {
    active.y += 1
  }
  timer = 0
  lockPiece()
}

function tick(time) {
  if (!running) return

  if (!paused) {
    const delta = time - lastTime
    lastTime = time
    timer += delta
    if (timer >= fallDelay) {
      step()
    }
    draw()
  }

  requestAnimationFrame(tick)
}

function startGame() {
  if (running) return
  running = true
  paused = false
  statusNode.textContent = "Running"
  requestAnimationFrame(time => {
    lastTime = time
    requestAnimationFrame(tick)
  })
}

function pauseOrStart() {
  if (!running) {
    startGame()
    return
  }
  paused = !paused
  statusNode.textContent = paused ? "Paused" : "Running"
  if (!paused) {
    lastTime = performance.now()
    requestAnimationFrame(tick)
  }
}

function reset() {
  board.forEach(row => row.fill(0))
  pieceBag = []
  ensureBag()
  score = 0
  level = 1
  lines = 0
  fallDelay = 700
  timer = 0
  running = false
  paused = false
  active = null
  statusNode.textContent = "Press Enter to start"
  scoreNode.textContent = "0"
  levelNode.textContent = "1"
  linesNode.textContent = "0"
  drawNext()
  draw()
  spawn()
}

window.addEventListener("keydown", event => {
  if (event.key === "r" || event.key === "R") {
    reset()
    return
  }

  if (event.key === "Enter") {
    pauseOrStart()
    return
  }

  if (!running || paused) return
  if (event.key === "ArrowLeft") move(-1)
  if (event.key === "ArrowRight") move(1)
  if (event.key === "ArrowDown") step()
  if (event.key === "ArrowUp") rotateActive()
  if (event.key === " ") hardDrop()
})

function init() {
  reset()
}

init()
