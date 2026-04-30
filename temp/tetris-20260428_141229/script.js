const canvas = document.getElementById('gameCanvas')
const context = canvas.getContext('2d')

const scoreDisplay = document.getElementById('score')
const linesDisplay = document.getElementById('lines')
const levelDisplay = document.getElementById('level')
const statusDisplay = document.getElementById('status')

const columns = 10
const rows = 20
const blockSize = 28

const colors = [
  '#000000',
  '#00f0f0',
  '#f0f000',
  '#a000f0',
  '#00f000',
  '#f00000',
  '#0000f0',
  '#f0a000',
]

const shapes = [
  [
    [1, 1, 1, 1],
  ],
  [
    [1, 1],
    [1, 1],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 0],
  ],
  [
    [1, 1, 0],
    [0, 1, 1],
  ],
  [
    [1, 0, 0],
    [1, 1, 1],
  ],
  [
    [0, 0, 1],
    [1, 1, 1],
  ],
]

const scoreTable = [0, 100, 300, 500, 800]

context.scale(blockSize, blockSize)

let board = createBoard()
let activePiece = null
let isPlaying = false
let isPaused = false
let isGameOver = false
let score = 0
let lines = 0
let level = 1
let dropCounter = 0
let dropInterval = 900
let lastFrameTime = 0

function createBoard() {
  return Array.from({ length: rows }, () => Array(columns).fill(0))
}

function randomPiece() {
  const index = Math.floor(Math.random() * shapes.length)
  const matrix = shapes[index].map((row) => row.slice())
  return {
    matrix,
    color: index + 1,
    x: Math.floor((columns - matrix[0].length) / 2),
    y: 0,
  }
}

function resetGame() {
  board = createBoard()
  score = 0
  lines = 0
  level = 1
  dropInterval = 900
  dropCounter = 0
  isGameOver = false
  isPaused = false
  isPlaying = true
  spawnPiece()
  syncStats()
  setStatus('Playing')
}

function syncStats() {
  scoreDisplay.textContent = score
  linesDisplay.textContent = lines
  levelDisplay.textContent = level
}

function setStatus(message) {
  statusDisplay.textContent = message
}

function spawnPiece() {
  activePiece = randomPiece()
  if (collides(activePiece, 0, 0, activePiece.matrix)) {
    activePiece = null
    isGameOver = true
    isPlaying = false
    setStatus('Game over. Press R to restart')
  }
}

function mergePiece() {
  activePiece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (value) {
        board[activePiece.y + y][activePiece.x + x] = activePiece.color
      }
    }),
  )
}

function clearLines() {
  let cleared = 0

  for (let y = rows - 1; y >= 0; y--) {
    if (board[y].every((cell) => cell !== 0)) {
      board.splice(y, 1)
      board.unshift(Array(columns).fill(0))
      cleared++
      y++
    }
  }

  if (cleared > 0) {
    score += scoreTable[cleared] * level
    lines += cleared
    level = Math.floor(lines / 10) + 1
    dropInterval = Math.max(80, 900 - (level - 1) * 70)
  }

  if (cleared > 0) {
    syncStats()
  }
}

function drop() {
  if (collides(activePiece, 0, 1, activePiece.matrix)) {
    mergePiece()
    clearLines()
    spawnPiece()
    if (!isGameOver) {
      syncStats()
    }
    return
  }

  activePiece.y += 1
}

function hardDrop() {
  let distance = 0
  while (!collides(activePiece, 0, 1, activePiece.matrix)) {
    activePiece.y += 1
    distance += 1
  }
  score += distance * 2
  syncStats()
  drop()
}

function move(direction) {
  if (!isPlaying || isPaused || isGameOver) return

  if (!collides(activePiece, direction, 0, activePiece.matrix)) {
    activePiece.x += direction
    draw()
  }
}

function rotate() {
  if (!isPlaying || isPaused || isGameOver) return

  const rotated = activePiece.matrix[0].map((_, x) =>
    activePiece.matrix.map((row) => row[x]).reverse(),
  )
  const kickOffsets = [0, 1, -1, 2, -2]

  for (const offset of kickOffsets) {
    if (!collides(activePiece, offset, 0, rotated)) {
      activePiece.matrix = rotated
      activePiece.x += offset
      draw()
      return
    }
  }
}

function collides(piece, offsetX, offsetY, matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) {
        continue
      }

      const boardX = piece.x + x + offsetX
      const boardY = piece.y + y + offsetY

      if (
        boardX < 0 ||
        boardX >= columns ||
        boardY < 0 ||
        boardY >= rows
      ) {
        return true
      }

      if (board[boardY]?.[boardX]) {
        return true
      }
    }
  }

  return false
}

function drawCell(x, y, color) {
  context.fillStyle = colors[color]
  context.fillRect(x, y, 1, 1)

  context.fillStyle = 'rgba(255,255,255,0.16)'
  context.fillRect(x, y, 1, 0.16)
  context.fillStyle = 'rgba(0,0,0,0.25)'
  context.fillRect(x, y + 0.84, 1, 0.16)
}

function draw() {
  context.fillStyle = '#051127'
  context.fillRect(0, 0, columns, rows)

  board.forEach((row, y) =>
    row.forEach((color, x) => {
      if (color) {
        drawCell(x, y, color)
      }
    }),
  )

  if (activePiece) {
    activePiece.matrix.forEach((row, y) =>
      row.forEach((value, x) => {
        if (value) {
          drawCell(activePiece.x + x, activePiece.y + y, activePiece.color)
        }
      }),
    )
  }
}

function update(time = 0) {
  const delta = time - lastFrameTime
  lastFrameTime = time

  if (isPlaying && !isPaused && !isGameOver) {
    dropCounter += delta
    if (dropCounter > dropInterval) {
      drop()
      dropCounter = 0
    }
  }

  draw()
  requestAnimationFrame(update)
}

resetGame()
isPlaying = false
setStatus('Press Enter or Space to start')
draw()

window.addEventListener('keydown', (event) => {
  if (isGameOver && event.code !== 'KeyR') {
    if (event.code !== 'Enter' && event.code !== 'Space') {
      return
    }
  }

  if (event.code === 'ArrowLeft') {
    event.preventDefault()
    move(-1)
  }

  if (event.code === 'ArrowRight') {
    event.preventDefault()
    move(1)
  }

  if (event.code === 'ArrowDown') {
    event.preventDefault()
    if (isPlaying && !isPaused && !isGameOver && !collides(activePiece, 0, 1, activePiece.matrix)) {
      activePiece.y += 1
      score += 1
      syncStats()
      draw()
    }
  }

  if (event.code === 'ArrowUp') {
    event.preventDefault()
    rotate()
  }

  if (event.code === 'Space') {
    event.preventDefault()
    if (!isPlaying || isGameOver) {
      resetGame()
      return
    }
    hardDrop()
  }

  if (event.code === 'Enter') {
    event.preventDefault()
    if (!isPlaying || isGameOver) {
      resetGame()
    } else {
      isPaused = !isPaused
      setStatus(isPaused ? 'Paused' : 'Playing')
    }
  }

  if (event.code === 'KeyP') {
    event.preventDefault()
    if (isPlaying && !isGameOver) {
      isPaused = !isPaused
      setStatus(isPaused ? 'Paused' : 'Playing')
    }
  }

  if (event.code === 'KeyR') {
    event.preventDefault()
    resetGame()
  }
})

requestAnimationFrame(update)
