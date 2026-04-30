const gameCanvas = document.getElementById('gameCanvas')
const nextCanvas = document.getElementById('nextCanvas')
const ctx = gameCanvas.getContext('2d')
const nextCtx = nextCanvas.getContext('2d')
const scoreEl = document.getElementById('score')
const linesEl = document.getElementById('lines')
const levelEl = document.getElementById('level')
const statusEl = document.getElementById('status')

const columns = 10
const rows = 20
const block = 30

const palette = ['#0b1022', '#00d2ff', '#f6a200', '#9d4edd', '#3dd598', '#ff4d6d', '#4cc9f0', '#ffd166']

const tetrominoes = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
  [[0, 1, 1], [1, 1, 0]],
]

const lineScore = [0, 40, 100, 300, 1200]

let board = createBoard()
let piece = null
let nextPiece = null
let gameState = 'ready'
let dropAccumulator = 0
let dropSpeed = 900
let last = 0
let score = 0
let lines = 0
let level = 1

ctx.scale(block, block)
nextCtx.scale(24, 24)

function createBoard() {
  return Array.from({ length: rows }, () => Array(columns).fill(0))
}

function randomPiece() {
  const index = Math.floor(Math.random() * tetrominoes.length)
  const shape = tetrominoes[index].map((row) => row.slice())
  return {
    matrix: shape,
    color: index + 1,
    x: Math.floor((columns - shape[0].length) / 2),
    y: -2,
  }
}

function resetGame() {
  board = createBoard()
  score = 0
  lines = 0
  level = 1
  dropAccumulator = 0
  dropSpeed = 900
  nextPiece = randomPiece()
  gameState = 'running'
  spawnPiece()
  updateStatus('Playing')
  updateStats()
  draw()
}

function updateStats() {
  scoreEl.textContent = score
  linesEl.textContent = lines
  levelEl.textContent = level
}

function updateStatus(text) {
  statusEl.textContent = text
}

function spawnPiece() {
  piece = nextPiece || randomPiece()
  nextPiece = randomPiece()

  if (collides(piece, 0, 0, piece.matrix)) {
    gameState = 'over'
    piece = null
    updateStatus('Game over. Press R to restart.')
    return
  }

  piece.x = Math.floor((columns - piece.matrix[0].length) / 2)
  piece.y = -2
}

function lockPiece() {
  piece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) {
        return
      }

      const boardX = piece.x + x
      const boardY = piece.y + y

      if (boardY >= 0) {
        board[boardY][boardX] = piece.color
      }
    }),
  )
}

function clearLines() {
  let removed = 0

  for (let y = rows - 1; y >= 0; y--) {
    if (board[y].every((cell) => cell !== 0)) {
      board.splice(y, 1)
      board.unshift(Array(columns).fill(0))
      removed++
      y++
    }
  }

  if (!removed) {
    return
  }

  score += lineScore[removed] * level
  lines += removed
  level = Math.floor(lines / 10) + 1
  dropSpeed = Math.max(120, 900 - (level - 1) * 75)
  updateStats()
}

function hardDrop() {
  let distance = 0
  while (!collides(piece, 0, 1, piece.matrix)) {
    piece.y++
    distance++
  }

  score += distance * 2
  updateStats()
  stepPiece()
}

function rotate() {
  const rotated = piece.matrix[0].map((_, x) => piece.matrix.map((row) => row[x]).reverse())
  const kicks = [0, -1, 1, -2, 2]

  for (const xOffset of kicks) {
    if (!collides(piece, xOffset, 0, rotated)) {
      piece.matrix = rotated
      piece.x += xOffset
      break
    }
  }
}

function move(dx) {
  if (collides(piece, dx, 0, piece.matrix)) {
    return
  }
  piece.x += dx
}

function stepPiece() {
  if (gameState !== 'running') {
    return
  }

  if (!piece) {
    return
  }

  if (collides(piece, 0, 1, piece.matrix)) {
    lockPiece()
    clearLines()
    spawnPiece()
    return
  }

  piece.y += 1
}

function collides(target, offsetX, offsetY, matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) {
        continue
      }

      const boardX = target.x + x + offsetX
      const boardY = target.y + y + offsetY

      if (boardX < 0 || boardX >= columns || boardY >= rows) {
        return true
      }

      if (boardY < 0) {
        continue
      }

      if (board[boardY][boardX]) {
        return true
      }
    }
  }

  return false
}

function drawCell(context, x, y, color) {
  const bg = palette[color]
  context.fillStyle = bg
  context.fillRect(x, y, 1, 1)

  context.fillStyle = 'rgba(255,255,255,0.28)'
  context.fillRect(x, y, 1, 0.14)

  context.fillStyle = 'rgba(0,0,0,0.23)'
  context.fillRect(x, y + 0.86, 1, 0.14)
}

function drawBoard() {
  board.forEach((row, y) =>
    row.forEach((color, x) => {
      if (!color) {
        return
      }
      drawCell(ctx, x, y, color)
    }),
  )
}

function drawPiece() {
  if (!piece) {
    return
  }

  piece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) {
        return
      }

      if (piece.y + y >= 0) {
        drawCell(ctx, piece.x + x, piece.y + y, piece.color)
      }
    }),
  )
}

function drawGhost() {
  if (!piece) {
    return
  }

  let ghostY = piece.y
  while (!collides(piece, 0, ghostY - piece.y + 1, piece.matrix)) {
    ghostY++
  }

  piece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) {
        return
      }

      const px = piece.x + x
      const py = ghostY + y

      if (py < 0) {
        return
      }

      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.fillRect(px, py, 1, 1)
    }),
  )
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  for (let x = 0; x <= columns; x++) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, rows)
    ctx.stroke()
  }

  for (let y = 0; y <= rows; y++) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(columns, y)
    ctx.stroke()
  }
}

function drawNext() {
  nextCtx.setTransform(1, 0, 0, 1, 0, 0)
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextCtx.fillStyle = 'rgba(3,7,17,0.9)'
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  const nx = 1
  const ny = 1
  nextPiece.matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) {
        return
      }
      drawCell(nextCtx, nx + x, ny + y, nextPiece.color)
    }),
  )
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height)
  ctx.setTransform(block, 0, 0, block, 0, 0)

  ctx.fillStyle = '#070e1e'
  ctx.fillRect(0, 0, columns, rows)

  drawGrid()
  drawBoard()
  drawGhost()
  drawPiece()

  if (nextPiece) {
    drawNext()
  }
}

function animate(time = 0) {
  const delta = time - last
  last = time

  if (gameState === 'running') {
    dropAccumulator += delta
    if (dropAccumulator >= dropSpeed) {
      stepPiece()
      dropAccumulator = 0
    }
  }

  draw()
  requestAnimationFrame(animate)
}

function handleAction(action) {
  if (gameState === 'over' && action !== 'reset') {
    return
  }

  if (action === 'toggle') {
    if (gameState === 'ready' || gameState === 'over') {
      resetGame()
      return
    }
    gameState = gameState === 'paused' ? 'running' : 'paused'
    updateStatus(gameState === 'paused' ? 'Paused' : 'Playing')
    return
  }

  if (gameState !== 'running') {
    return
  }

  if (action === 'left') {
    move(-1)
  }

  if (action === 'right') {
    move(1)
  }

  if (action === 'down') {
    if (!collides(piece, 0, 1, piece.matrix)) {
      piece.y += 1
      score += 1
      updateStats()
    }
  }

  if (action === 'rotate') {
    rotate()
  }

  if (action === 'hardDrop') {
    hardDrop()
  }
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault()
    if (gameState === 'ready' || gameState === 'over') {
      resetGame()
      return
    }

    handleAction('hardDrop')
    return
  }

  if (event.code === 'Enter') {
    event.preventDefault()
    handleAction('toggle')
    return
  }

  if (event.code === 'KeyR') {
    event.preventDefault()
    resetGame()
    return
  }

  if (event.code === 'ArrowLeft') {
    event.preventDefault()
    handleAction('left')
    return
  }

  if (event.code === 'ArrowRight') {
    event.preventDefault()
    handleAction('right')
    return
  }

  if (event.code === 'ArrowDown') {
    event.preventDefault()
    handleAction('down')
    return
  }

  if (event.code === 'ArrowUp') {
    event.preventDefault()
    handleAction('rotate')
  }
})

document.querySelector('.mobile-controls').addEventListener('click', (event) => {
  const action = event.target.getAttribute('data-action')
  if (!action) {
    return
  }

  if (action === 'left') {
    handleAction('left')
  }

  if (action === 'right') {
    handleAction('right')
  }

  if (action === 'down') {
    handleAction('down')
  }

  if (action === 'rotate') {
    handleAction('rotate')
  }

  if (action === 'hardDrop') {
    if (gameState === 'ready' || gameState === 'over') {
      resetGame()
      return
    }

    handleAction('hardDrop')
    return
  }

  event.preventDefault()
})

resetGame()
gameState = 'ready'
updateStatus('Press Space or Enter to start')
requestAnimationFrame(animate)
