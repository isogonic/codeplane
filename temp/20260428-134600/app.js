const COLS = 10
const ROWS = 20
const SHAPES = [
  { name: "I", color: "#30d5ff", cells: [[1, 1, 1, 1]] },
  { name: "J", color: "#5ca9ff", cells: [[1, 0, 0], [1, 1, 1]] },
  { name: "L", color: "#ff8f59", cells: [[0, 0, 1], [1, 1, 1]] },
  { name: "O", color: "#ffd95a", cells: [[1, 1], [1, 1]] },
  { name: "S", color: "#51db9f", cells: [[0, 1, 1], [1, 1, 0]] },
  { name: "T", color: "#ba82ff", cells: [[0, 1, 0], [1, 1, 1]] },
  { name: "Z", color: "#ff5f87", cells: [[1, 1, 0], [0, 1, 1]] }
]

const scoreNode = document.getElementById("score")
const levelNode = document.getElementById("level")
const linesNode = document.getElementById("lines")
const statusNode = document.getElementById("status")
const boardNode = document.getElementById("board")
const nextNode = document.getElementById("next")

const board = Array.from({ length: ROWS }, () => Array(COLS).fill(0))
const cells = Array.from({ length: ROWS * COLS }, () => {
  const c = document.createElement("div")
  c.className = "cell"
  boardNode.appendChild(c)
  return c
})

const nextCells = Array.from({ length: 12 }, (_, i) => {
  const c = document.createElement("div")
  c.className = "cell"
  nextNode.appendChild(c)
  return c
})

let queue = pickSequence()
let active = null
let running = false
let paused = false
let timer = 0
let lastTick = 0
let baseDelay = 700
let score = 0
let lines = 0
let level = 1

function pickSequence() {
  return [...SHAPES].sort(() => Math.random() - 0.5)
}

function randomPiece() {
  if (queue.length === 0) queue = pickSequence()
  const shape = queue.shift()
  if (queue.length === 0) queue = pickSequence()
  return structuredClone(shape)
}

function createPlayer() {
  const shape = randomPiece()
  return {
    shape: shape.cells,
    color: shape.color,
    x: Math.floor((COLS - shape.cells[0].length) / 2),
    y: -2
  }
}

function rotateShape(shape) {
  return shape[0].map((_, x) => shape.map(row => row[x]).reverse())
}

function cellIndex(x, y) {
  return y * COLS + x
}

function insideGrid(x, y) {
  return x >= 0 && x < COLS && y < ROWS
}

function collides(piece, ox = 0, oy = 0, shape = piece.shape) {
  return shape.some((row, y) =>
    row.some((cell, x) => {
      if (cell === 0) return false
      const nx = piece.x + x + ox
      const ny = piece.y + y + oy
      if (ny < 0) return false
      return !insideGrid(nx, ny) || (ny >= 0 && board[ny][nx] !== 0)
    })
  )
}

function lockPiece() {
  active.shape.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell !== 0) {
        const boardY = active.y + y
        const boardX = active.x + x
        if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
          board[boardY][boardX] = active.color
        }
      }
    })
  })

  const cleared = clearFullRows()
  if (cleared > 0) {
    score += [0, 100, 300, 500, 800][cleared] * level
    lines += cleared
    level = Math.floor(lines / 10) + 1
    baseDelay = Math.max(120, 700 - (level - 1) * 60)
  }

  spawnPiece()
  render()
  scoreNode.textContent = String(score)
  levelNode.textContent = String(level)
  linesNode.textContent = String(lines)
}

function clearFullRows() {
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

function start() {
  if (running) return
  running = true
  paused = false
  statusNode.textContent = "Game started"
  requestAnimationFrame((time) => {
    lastTick = time
    loop(time)
  })
}

function spawnPiece() {
  active = createPlayer()
  if (collides(active)) {
    running = false
    paused = false
    statusNode.textContent = "Game over - press R to restart"
  }
  renderNext()
}

function renderCell(cell, color, className = "") {
  const style = cell.style
  style.background = color || "transparent"
  cell.style.borderColor = color ? `${color}80` : "#0b1945"
  cell.className = `cell ${className}`.trim()
}

function render() {
  const flat = board.flat()
  flat.forEach((color, i) => {
    renderCell(cells[i], color)
  })

  if (active) {
    active.shape.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell !== 0) {
          const ny = active.y + y
          const nx = active.x + x
          if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
            renderCell(cells[cellIndex(nx, ny)], active.color, "filled")
          }
        }
      })
    })
  }
}

function renderNext() {
  nextCells.forEach(cell => renderCell(cell, ""))
  const piece = queue[0]
  if (!piece) return

  const pieceX = 2
  const pieceY = 0
  piece.cells.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell !== 0) {
        const nx = pieceX + x
        const ny = pieceY + y
        if (ny >= 0 && ny < 3 && nx >= 0 && nx < 4) {
          renderCell(nextCells[ny * 4 + nx], piece.color)
        }
      }
    })
  })
}

function hardDrop() {
  if (!active || paused || !running) return
  while (!collides(active, 0, 1)) active.y += 1
  timer = 0
  lockPiece()
}

function move(dx) {
  if (!active || paused || !running) return
  if (!collides(active, dx, 0)) {
    active.x += dx
    render()
  }
}

function rotate() {
  if (!active || paused || !running) return
  const rotated = rotateShape(active.shape)
  if (!collides({ ...active, shape: rotated })) {
    active.shape = rotated
    render()
  }
}

function drop() {
  if (!active || paused || !running) return
  if (collides(active, 0, 1)) {
    lockPiece()
    return
  }
  active.y += 1
  timer = 0
  render()
}

function reset() {
  board.forEach(row => row.fill(0))
  queue = pickSequence()
  score = 0
  lines = 0
  level = 1
  baseDelay = 700
  running = false
  paused = false
  timer = 0
  scoreNode.textContent = "0"
  linesNode.textContent = "0"
  levelNode.textContent = "1"
  statusNode.textContent = "Press Enter to begin"
  active = null
  spawnPiece()
  render()
}

function loop(time) {
  if (!running) return
  if (paused) {
    requestAnimationFrame(loop)
    return
  }

  const delta = time - lastTick
  lastTick = time
  timer += delta

  if (timer >= baseDelay) {
    drop()
    timer = 0
  }

  render()
  requestAnimationFrame(loop)
}

function togglePause() {
  if (!running) {
    start()
    return
  }
  paused = !paused
  statusNode.textContent = paused ? "Paused" : "Game resumed"
}

window.addEventListener("keydown", (event) => {
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
  if (event.key === "ArrowDown") {
    drop()
  }
  if (event.key === "ArrowUp") rotate()
  if (event.key === " ") hardDrop()
})

function init() {
  reset()
  renderNext()
}

init()
