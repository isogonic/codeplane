const canvas = document.getElementById("board")
const context = canvas.getContext("2d")
const overlay = document.getElementById("overlay")
const scoreEl = document.getElementById("score")
const linesEl = document.getElementById("lines")
const levelEl = document.getElementById("level")
const restartButton = document.getElementById("restart")

const tile = 24
const cols = 10
const rows = 20
const colors = {
  I: "#4fd1ff",
  J: "#6075ff",
  L: "#ff9f43",
  O: "#ffd84f",
  S: "#47d96d",
  T: "#bd6dff",
  Z: "#ff5668",
}

const tetrominoes = {
  I: [[1, 1, 1, 1]],
  J: [
    [2, 0, 0],
    [2, 2, 2],
  ],
  L: [
    [0, 0, 3],
    [3, 3, 3],
  ],
  O: [
    [4, 4],
    [4, 4],
  ],
  S: [
    [0, 5, 5],
    [5, 5, 0],
  ],
  T: [
    [0, 6, 0],
    [6, 6, 6],
  ],
  Z: [
    [7, 7, 0],
    [0, 7, 7],
  ],
}

const keys = Object.keys(tetrominoes)
const blockValues = Object.values(colors)

context.scale(tile, tile)

let board
let player
let lastTime = 0
let dropCounter = 0
let dropInterval = 500
let level = 1
let score = 0
let lines = 0
let gameOver = false

function createBoard() {
  return Array.from({ length: rows }, () => Array(cols).fill(0))
}

function copyPiece(matrix) {
  return matrix.map((row) => [...row])
}

function randomPiece() {
  const name = keys[Math.floor(Math.random() * keys.length)]
  return {
    name,
    shape: copyPiece(tetrominoes[name]),
    x: Math.floor(cols / 2) - 1,
    y: -2,
  }
}

function newGame() {
  board = createBoard()
  player = {
    ...randomPiece(),
  }
  lastTime = 0
  dropCounter = 0
  dropInterval = 650
  level = 1
  score = 0
  lines = 0
  gameOver = false
  overlay.classList.add("hidden")
  updateHud()
  animate()
}

function collide() {
  return player.shape.some((row, y) =>
    row.some((value, x) => {
      if (!value) return false
      const boardX = player.x + x
      const boardY = player.y + y
      return boardY < 0 ? false : boardX < 0 || boardX >= cols || boardY >= rows || board[boardY][boardX] !== 0
    }),
  )
}

function merge() {
  player.shape.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value || player.y + y < 0) return
      board[player.y + y][player.x + x] = value
    }),
  )
}

function drop() {
  player.y += 1
  if (collide()) {
    player.y -= 1
    merge()
    sweep()
    player = randomPiece()
    if (collide()) {
      gameOver = true
      overlay.classList.remove("hidden")
      return
    }
  }
  dropCounter = 0
}

function move(offsetX) {
  player.x += offsetX
  if (collide()) player.x -= offsetX
}

function hardDrop() {
  let distance = 0
  while (true) {
    player.y += 1
    if (collide()) {
      player.y -= 1
      break
    }
    distance += 1
  }
  score += distance * 2
  merge()
  sweep()
  player = randomPiece()
  if (collide()) {
    gameOver = true
    overlay.classList.remove("hidden")
  }
  dropCounter = 0
  updateHud()
}

function rotate() {
  const rotated = player.shape[0].map((_, index) => player.shape.map((row) => row[index]).reverse())
  const previousShape = player.shape
  player.shape = rotated
  if (collide()) {
    player.shape = previousShape
    const wallKick = [1, -1, 2, -2]
    const reverted = wallKick.find((xShift) => {
      player.x += xShift
      const invalid = collide()
      if (!invalid) return true
      player.x -= xShift
      return false
    })
    if (reverted === undefined) player.shape = previousShape
  }
}

function sweep() {
  const removed = board.filter((row) => row.every((cell) => cell !== 0)).length
  if (removed > 0) {
    board = board.filter((row) => row.some((cell) => cell === 0))
    while (board.length < rows) {
      board.unshift(Array(cols).fill(0))
    }
  }
  if (!removed) return
  lines += removed
  score += [0, 100, 300, 500, 800][removed] * level
  level = 1 + Math.floor(lines / 10)
  dropInterval = Math.max(90, 650 - (level - 1) * 55)
  updateHud()
}

function updateHud() {
  scoreEl.textContent = String(score)
  linesEl.textContent = String(lines)
  levelEl.textContent = String(level)
}

function drawCell(x, y, value, color) {
  context.fillStyle = color
  context.fillRect(x, y, 1, 1)
  if (!value) return
  context.lineWidth = 0.08
  context.strokeStyle = "rgba(255,255,255,0.18)"
  context.strokeRect(x + 0.08, y + 0.08, 0.84, 0.84)
}

function draw() {
  context.fillStyle = "#09153b"
  context.fillRect(0, 0, cols, rows)

  board.forEach((row, y) =>
    row.forEach((value, x) => {
      const color = value ? blockValues[(value - 1) % blockValues.length] : "#132052"
      drawCell(x, y, value, color)
    }),
  )

  player.shape.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value || player.y + y < 0) return
      drawCell(player.x + x, player.y + y, value, colors[player.name])
    }),
  )
}

function animate(time = 0) {
  const delta = time - lastTime
  lastTime = time
  dropCounter += delta
  if (dropCounter > dropInterval) drop()
  draw()
  if (!gameOver) requestAnimationFrame(animate)
}

document.addEventListener("keydown", (event) => {
  if (gameOver) {
    if (event.code === "KeyR") newGame()
    return
  }

  if (event.code === "ArrowLeft") move(-1)
  if (event.code === "ArrowRight") move(1)
  if (event.code === "ArrowDown") {
    drop()
    score += 1
    updateHud()
  }
  if (event.code === "ArrowUp") rotate()
  if (event.code === "Space") {
    event.preventDefault()
    hardDrop()
  }
})

restartButton.addEventListener("click", () => newGame())

newGame()
