const boardCanvas = document.getElementById("board")
const boardContext = boardCanvas.getContext("2d")
const nextCanvas = document.getElementById("next")
const nextContext = nextCanvas.getContext("2d")
const scoreElement = document.getElementById("score")
const linesElement = document.getElementById("lines")
const levelElement = document.getElementById("level")
const restartButton = document.getElementById("restart")

const width = 10
const height = 20
const cell = 30
const dropSpeeds = [1000, 800, 700, 600, 520, 450, 390, 340, 300, 260, 230]

const tetrominoes = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
}

const colors = {
  I: "#67e8f9",
  J: "#38bdf8",
  L: "#fb923c",
  O: "#fcd34d",
  S: "#4ade80",
  T: "#d8b4fe",
  Z: "#fb7185",
}

const emptyBoard = () =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => null))

let board = emptyBoard()
let piece = null
let nextPiece = null
let dropTimer = 0
let dropDelay = 800
let lastTime = 0
let runningFrame = null
let score = 0
let lines = 0
let level = 1
let bag = []
let paused = false
let gameOver = false

const cloneMatrix = (matrix) => matrix.map((row) => [...row])

function shuffle(list) {
  const source = [...list]
  const result = []
  while (source.length) {
    const index = Math.floor(Math.random() * source.length)
    result.push(source[index])
    source.splice(index, 1)
  }
  return result
}

function pickFromBag() {
  if (!bag.length) bag = shuffle(Object.keys(tetrominoes))
  return bag.shift()
}

function makePiece(id) {
  return {
    id,
    matrix: cloneMatrix(tetrominoes[id]),
    color: colors[id],
    x: Math.floor(width / 2) - Math.ceil(tetrominoes[id][0].length / 2),
    y: 0,
  }
}

function rotateMatrix(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]).reverse())
}

function isBlocked(matrix, x, y) {
  for (let row = 0; row < matrix.length; row++) {
    for (let column = 0; column < matrix[row].length; column++) {
      if (!matrix[row][column]) continue
      const boardX = x + column
      const boardY = y + row

      if (boardX < 0 || boardX >= width || boardY >= height) return true
      if (boardY < 0) continue
      if (board[boardY][boardX]) return true
    }
  }
  return false
}

function projectGhostY() {
  let ghostY = piece.y
  while (!isBlocked(piece.matrix, piece.x, ghostY + 1)) ghostY += 1
  return ghostY
}

function settlePiece() {
  piece.matrix.forEach((row, rowIndex) => {
    row.forEach((cellValue, column) => {
      if (!cellValue) return
      if (piece.y + rowIndex < 0) return
      board[piece.y + rowIndex][piece.x + column] = piece.color
    })
  })
}

function clearCompletedLines() {
  let cleared = 0

  for (let row = height - 1; row >= 0; ) {
    if (board[row].every(Boolean)) {
      board.splice(row, 1)
      board.unshift(Array.from({ length: width }, () => null))
      cleared += 1
      continue
    }
    row -= 1
  }

  if (!cleared) return

  lines += cleared
  score += [0, 40, 100, 300, 1200][cleared] * level
  level = Math.floor(lines / 10) + 1
  dropDelay = Math.max(120, dropSpeeds[(level - 1) % dropSpeeds.length])
  scoreElement.textContent = score
  linesElement.textContent = lines
  levelElement.textContent = level
}

function spawnNextPiece() {
  if (!nextPiece) nextPiece = makePiece(pickFromBag())
  piece = nextPiece
  piece.x = Math.floor(width / 2) - Math.ceil(piece.matrix[0].length / 2)
  piece.y = 0
  nextPiece = makePiece(pickFromBag())

  if (isBlocked(piece.matrix, piece.x, piece.y)) {
    gameOver = true
    cancelAnimationFrame(runningFrame)
  }
}

function shiftPiece(deltaX, deltaY) {
  const targetX = piece.x + deltaX
  const targetY = piece.y + deltaY
  if (!isBlocked(piece.matrix, targetX, targetY)) {
    piece.x = targetX
    piece.y = targetY
    return true
  }
  return false
}

function softDrop() {
  if (!shiftPiece(0, 1)) {
    settlePiece()
    clearCompletedLines()
    spawnNextPiece()
  }
}

function hardDrop() {
  let distance = 0
  while (shiftPiece(0, 1)) distance += 1
  score += distance
  scoreElement.textContent = score
  softDrop()
}

function rotatePiece() {
  const rotated = rotateMatrix(piece.matrix)
  const originalMatrix = piece.matrix
  const originalX = piece.x

  piece.matrix = rotated

  if (!isBlocked(piece.matrix, piece.x, piece.y)) return

  let attempts = 1
  while (isBlocked(piece.matrix, piece.x + attempts, piece.y)) {
    attempts = attempts > 0 ? -(attempts + 1) : -(attempts - 1)
    if (Math.abs(attempts) > piece.matrix[0].length) {
      piece.matrix = originalMatrix
      piece.x = originalX
      return
    }
  }

  piece.x += attempts
}

function drawCell(context, x, y, color, ghost = false) {
  const left = x * cell
  const top = y * cell
  context.fillStyle = ghost ? `${color}44` : color
  context.fillRect(left, top, cell, cell)
  context.fillStyle = ghost ? "transparent" : "rgba(255,255,255,0.2)"
  context.fillRect(left + 4, top + 4, cell - 8, 6)
  context.strokeStyle = ghost ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.16)"
  context.strokeRect(left + 1, top + 1, cell - 2, cell - 2)
}

function drawBoard() {
  boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  boardContext.fillStyle = "#030712"
  boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  board.forEach((row, rowIndex) => {
    row.forEach((cellColor, columnIndex) => {
      if (!cellColor) return
      drawCell(boardContext, columnIndex, rowIndex, cellColor)
    })
  })

  if (gameOver || !piece) return

  const ghostY = projectGhostY()
  for (let rowIndex = 0; rowIndex < piece.matrix.length; rowIndex++) {
    for (let columnIndex = 0; columnIndex < piece.matrix[rowIndex].length; columnIndex++) {
      if (!piece.matrix[rowIndex][columnIndex]) continue
      const x = piece.x + columnIndex
      const y = piece.y + rowIndex
      if (y >= 0) drawCell(boardContext, x, y, "#d1d5db", true)

      const landY = ghostY + rowIndex
      if (landY >= 0) drawCell(boardContext, x, landY, piece.color, true)
    }
  }

  piece.matrix.forEach((row, rowIndex) => {
    row.forEach((cellValue, columnIndex) => {
      if (!cellValue) return
      const x = piece.x + columnIndex
      const y = piece.y + rowIndex
      if (y >= 0) drawCell(boardContext, x, y, piece.color)
    })
  })
}

function drawNextPiece() {
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  nextContext.fillStyle = "#050a17"
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height)

  const preview = nextPiece
  const offsetX = Math.floor((4 - preview.matrix[0].length) / 2)
  const offsetY = Math.floor((4 - preview.matrix.length) / 2)

  preview.matrix.forEach((row, rowIndex) => {
    row.forEach((cellValue, columnIndex) => {
      if (!cellValue) return
      drawCell(
        nextContext,
        offsetX + columnIndex,
        offsetY + rowIndex,
        preview.color,
      )
    })
  })
}

function render() {
  drawBoard()
  drawNextPiece()

  if (paused && !gameOver) {
    boardContext.fillStyle = "rgba(5, 13, 34, 0.8)"
    boardContext.fillRect(0, boardCanvas.height / 2 - 52, boardCanvas.width, 104)
    boardContext.fillStyle = "#f8fafc"
    boardContext.textAlign = "center"
    boardContext.font = "28px Trebuchet MS"
    boardContext.fillText("PAUSED", boardCanvas.width / 2, boardCanvas.height / 2)
    boardContext.font = "14px Trebuchet MS"
    boardContext.fillText("Press P to continue", boardCanvas.width / 2, boardCanvas.height / 2 + 28)
    return
  }

  if (!gameOver) return

  boardContext.fillStyle = "rgba(5, 13, 34, 0.8)"
  boardContext.fillRect(0, boardCanvas.height / 2 - 52, boardCanvas.width, 104)
  boardContext.fillStyle = "#f8fafc"
  boardContext.textAlign = "center"
  boardContext.font = "28px Trebuchet MS"
  boardContext.fillText("GAME OVER", boardCanvas.width / 2, boardCanvas.height / 2)
  boardContext.font = "14px Trebuchet MS"
  boardContext.fillText("Press R to restart", boardCanvas.width / 2, boardCanvas.height / 2 + 28)
}

function tick(time = 0) {
  const delta = time - lastTime
  lastTime = time
  if (!paused && !gameOver) {
    dropTimer += delta
    if (dropTimer > dropDelay) {
      softDrop()
      dropTimer = 0
    }
  }

  render()
  runningFrame = requestAnimationFrame(tick)
}

function restartGame() {
  cancelAnimationFrame(runningFrame)
  board = emptyBoard()
  score = 0
  lines = 0
  level = 1
  dropDelay = 800
  dropTimer = 0
  lastTime = 0
  paused = false
  gameOver = false
  bag = []
  nextPiece = null

  scoreElement.textContent = score
  linesElement.textContent = lines
  levelElement.textContent = level

  spawnNextPiece()
  spawnNextPiece()
  runningFrame = requestAnimationFrame(tick)
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyP") {
    if (gameOver) return
    paused = !paused
    return
  }

  if (event.code === "KeyR") {
    restartGame()
    return
  }

  if (gameOver || paused) return

  if (event.code === "ArrowLeft") shiftPiece(-1, 0)
  if (event.code === "ArrowRight") shiftPiece(1, 0)
  if (event.code === "ArrowDown") {
    score += 1
    scoreElement.textContent = score
    softDrop()
  }
  if (event.code === "ArrowUp") rotatePiece()
  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

restartButton.addEventListener("click", restartGame)

spawnNextPiece()
spawnNextPiece()
runningFrame = requestAnimationFrame(tick)
