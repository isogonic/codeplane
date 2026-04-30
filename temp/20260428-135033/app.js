const COLS = 10
const ROWS = 20

const SHAPES = [
  { color: "#2dd9ff", cells: [[1, 1, 1, 1]] },
  { color: "#5588ff", cells: [[1, 0, 0], [1, 1, 1]] },
  { color: "#ff924d", cells: [[0, 0, 1], [1, 1, 1]] },
  { color: "#ffd14a", cells: [[1, 1], [1, 1]] },
  { color: "#4de38a", cells: [[0, 1, 1], [1, 1, 0]] },
  { color: "#bc7cff", cells: [[0, 1, 0], [1, 1, 1]] },
  { color: "#ff5f84", cells: [[1, 1, 0], [0, 1, 1]] }
]

const scoreNode = document.getElementById("score")
const levelNode = document.getElementById("level")
const linesNode = document.getElementById("lines")
const statusNode = document.getElementById("status")
const boardNode = document.getElementById("board")
const nextNode = document.getElementById("next")

const board = Array.from({ length: ROWS }, () => Array(COLS).fill(0))
const cells = Array.from({ length: ROWS * COLS }, () => {
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

let bag = []
let player = null
let running = false
let paused = false
let timer = 0
let last = 0
let baseDelay = 700
let score = 0
let level = 1
let lines = 0

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5)
}

function refillBag() {
  bag = shuffle(SHAPES)
}

function nextShape() {
  if (bag.length === 0) refillBag()
  return structuredClone(bag.shift())
}

function newPiece() {
  if (bag.length < 2) refillBag()
  const shape = nextShape()
  return {
    shape: shape.cells,
    color: shape.color,
    x: Math.floor((COLS - shape.cells[0].length) / 2),
    y: -2
  }
}

function rotate(shape) {
  return shape[0].map((_, x) => shape.map(row => row[x]).reverse())
}

function collides(piece, ox = 0, oy = 0, shape = piece.shape) {
  return shape.some((row, y) =>
    row.some((cell, x) => {
      if (cell === 0) return false
      const nx = piece.x + x + ox
      const ny = piece.y + y + oy
      if (ny < 0) return false
      return nx < 0 || nx >= COLS || ny >= ROWS || board[ny][nx] !== 0
    })
  )
}

function drawCell(cell, color, active = false) {
  cell.style.background = color || "transparent"
  cell.style.borderColor = color ? `${color}99` : "#0e1d4c"
  cell.className = `cell${active ? " filled" : ""}`.trim()
}

function render() {
  board.flat().forEach((color, i) => drawCell(cells[i], color))

  if (!player) return

  player.shape.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (!cell) return
      const boardX = player.x + x
      const boardY = player.y + y
      if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
        drawCell(cells[boardY * COLS + boardX], player.color, true)
      }
    })
  )
}

function renderNext() {
  nextCells.forEach(cell => drawCell(cell, ""))
  const piece = bag[0]
  if (!piece) return

  piece.cells.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (!cell) return
      const nx = 1 + x
      const ny = y
      if (ny < 3 && nx < 4) {
        drawCell(nextCells[ny * 4 + nx], piece.color)
      }
    })
  )
}

function mergePiece() {
  player.shape.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (!cell) return
      const ny = player.y + y
      const nx = player.x + x
      if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
        board[ny][nx] = player.color
      }
    })
  )
}

function clearLines() {
  let count = 0
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row].every(cell => cell !== 0)) {
      board.splice(row, 1)
      board.unshift(Array(COLS).fill(0))
      count++
      row++
    }
  }
  return count
}

function spawn() {
  player = newPiece()
  if (collides(player)) {
    running = false
    paused = false
    statusNode.textContent = "Game over - press R"
  }
  renderNext()
  render()
}

function lock() {
  mergePiece()
  const cleared = clearLines()

  if (cleared > 0) {
    const points = [0, 100, 300, 500, 800][cleared]
    score += points * level
    lines += cleared
    level = Math.floor(lines / 10) + 1
    baseDelay = Math.max(120, 700 - (level - 1) * 60)
  }

  scoreNode.textContent = String(score)
  levelNode.textContent = String(level)
  linesNode.textContent = String(lines)
  spawn()
}

function move(dx) {
  if (!player || paused || !running) return
  if (!collides(player, dx, 0)) {
    player.x += dx
    render()
  }
}

function rotatePiece() {
  if (!player || paused || !running) return
  const rotated = rotate(player.shape)
  if (!collides({ ...player, shape: rotated })) {
    player.shape = rotated
    render()
  }
}

function softDrop() {
  if (!player || paused || !running) return
  if (collides(player, 0, 1)) {
    lock()
    return
  }
  player.y++
  timer = 0
  render()
}

function hardDrop() {
  if (!player || paused || !running) return
  while (!collides(player, 0, 1)) {
    player.y++
  }
  timer = 0
  lock()
}

function update(time) {
  if (!running) return
  if (!paused) {
    const delta = time - last
    last = time
    timer += delta

    if (timer >= baseDelay) {
      softDrop()
      timer = 0
    }

    render()
  }

  requestAnimationFrame(update)
}

function start() {
  if (running) return
  running = true
  paused = false
  statusNode.textContent = "Game started"
  requestAnimationFrame(time => {
    last = time
    update(time)
  })
}

function togglePause() {
  if (!running) {
    start()
    return
  }

  paused = !paused
  statusNode.textContent = paused ? "Paused" : "Game resumed"
  if (!paused) {
    last = performance.now()
    requestAnimationFrame(update)
  }
}

function reset() {
  board.forEach(row => row.fill(0))
  score = 0
  level = 1
  lines = 0
  baseDelay = 700
  running = false
  paused = false
  timer = 0
  refillBag()
  scoreNode.textContent = "0"
  levelNode.textContent = "1"
  linesNode.textContent = "0"
  statusNode.textContent = "Press Enter to start"
  player = null
  spawn()
}

window.addEventListener("keydown", event => {
  if (event.key === "r" || event.key === "R") {
    reset()
    return
  }

  if (event.key === "Enter") {
    togglePause()
    return
  }

  if (!running || paused) return
  if (event.key === "ArrowLeft") move(-1)
  if (event.key === "ArrowRight") move(1)
  if (event.key === "ArrowDown") softDrop()
  if (event.key === "ArrowUp") rotatePiece()
  if (event.key === " ") hardDrop()
})

function init() {
  reset()
}

init()
