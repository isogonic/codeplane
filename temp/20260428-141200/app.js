const gridWidth = 10
const gridHeight = 20
const tileSize = 30

const canvas = document.getElementById("game")
const context = canvas.getContext("2d")
const scoreEl = document.getElementById("score")
const linesEl = document.getElementById("lines")
const levelEl = document.getElementById("level")
const status = document.getElementById("status")
const restartButton = document.getElementById("restart")

const colors = [
  "#000000",
  "#00d2ff",
  "#ff8a00",
  "#7d4bff",
  "#2ec4b6",
  "#ffe156",
  "#ff6d91",
  "#7cff73",
]

const tetrominoes = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1]],
  L: [[0, 0, 0], [2, 2, 2], [2, 0, 0]],
  J: [[0, 0, 0], [3, 3, 3], [0, 0, 3]],
  O: [[4, 4], [4, 4]],
  S: [[0, 5, 5], [5, 5, 0]],
  T: [[0, 6, 0], [6, 6, 6]],
  Z: [[7, 7, 0], [0, 7, 7]],
}

const state = {
  arena: createMatrix(gridWidth, gridHeight),
  player: createPlayer(),
  score: 0,
  lines: 0,
  level: 1,
  dropAccumulator: 0,
  dropInterval: 900,
  lastTime: 0,
  gameOver: false,
}

function createMatrix(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => 0))
}

function createPlayer() {
  return {
    pos: { x: 3, y: 0 },
    matrix: pickShape(),
  }
}

function clone(matrix) {
  return matrix.map((row) => row.slice())
}

function pickShape() {
  const keys = Object.keys(tetrominoes)
  const shape = keys[Math.floor(Math.random() * keys.length)]

  return clone(tetrominoes[shape])
}

function drawMatrix(matrix, offset, tint) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) {
        return
      }

      context.fillStyle = tint || colors[value]
      context.fillRect((x + offset.x) * tileSize, (y + offset.y) * tileSize, tileSize, tileSize)

      context.strokeStyle = "rgba(255, 255, 255, 0.35)"
      context.lineWidth = 2
      context.strokeRect((x + offset.x) * tileSize, (y + offset.y) * tileSize, tileSize, tileSize)
    })
  })
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height)
  drawMatrix(state.arena, { x: 0, y: 0 })
  drawMatrix(state.player.matrix, state.player.pos)
}

function collide(arena, piece) {
  return piece.matrix.some((row, y) =>
    row.some((value, x) => {
      if (!value) {
        return false
      }

      const nx = x + piece.pos.x
      const ny = y + piece.pos.y

      if (nx < 0 || nx >= gridWidth || ny >= gridHeight) {
        return true
      }

      if (ny < 0) {
        return false
      }

      return arena[ny][nx] !== 0
    }),
  )
}

function merge(arena, piece) {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        arena[y + piece.pos.y][x + piece.pos.x] = value
      }
    })
  })
}

function clearLines() {
  let cleared = 0

  for (let y = gridHeight - 1; y >= 0; y -= 1) {
    if (state.arena[y].every((value) => value !== 0)) {
      cleared += 1
      state.arena.splice(y, 1)
      state.arena.unshift(new Array(gridWidth).fill(0))
      y += 1
    }
  }

  if (cleared > 0) {
    state.lines += cleared
    state.score += [0, 100, 300, 500, 800][Math.min(cleared, 4)] * state.level
    state.level = Math.floor(state.lines / 10) + 1
    state.dropInterval = Math.max(120, 900 - (state.level - 1) * 70)
  }
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse())
}

function playerRotate() {
  const startX = state.player.pos.x
  let offset = 1

  state.player.matrix = rotate(state.player.matrix)

  while (collide(state.arena, state.player)) {
    state.player.pos.x += offset
    offset = offset > 0 ? -(offset + 1) : -(offset - 1)

    if (offset * -1 > state.player.matrix[0].length) {
      state.player.matrix = rotate(state.player.matrix)
      state.player.matrix = rotate(state.player.matrix)
      state.player.matrix = rotate(state.player.matrix)
      state.player.pos.x = startX
      return
    }
  }
}

function playerMove(direction) {
  state.player.pos.x += direction

  if (collide(state.arena, state.player)) {
    state.player.pos.x -= direction
  }
}

function playerDrop() {
  state.player.pos.y += 1

  if (collide(state.arena, state.player)) {
    state.player.pos.y -= 1
    merge(state.arena, state.player)
    clearLines()
    resetPlayer()
    updateHUD()
  }

  state.dropAccumulator = 0
}

function playerHardDrop() {
  while (!collide(state.arena, {
    matrix: state.player.matrix,
    pos: {
      x: state.player.pos.x,
      y: state.player.pos.y + 1,
    },
  })) {
    state.player.pos.y += 1
  }

  merge(state.arena, state.player)
  clearLines()
  resetPlayer()
  updateHUD()
  state.dropAccumulator = 0
}

function resetPlayer() {
  state.player.matrix = pickShape()
  state.player.pos.x = 3
  state.player.pos.y = 0

  if (collide(state.arena, state.player)) {
    state.gameOver = true
    status.hidden = false
  }
}

function updateHUD() {
  scoreEl.textContent = `Score: ${state.score}`
  linesEl.textContent = `Lines: ${state.lines}`
  levelEl.textContent = `Level: ${state.level}`
}

function update(time = 0) {
  const delta = time - state.lastTime
  state.lastTime = time
  state.dropAccumulator += delta

  if (state.dropAccumulator > state.dropInterval) {
    playerDrop()
  }

  draw()

  if (!state.gameOver) {
    requestAnimationFrame(update)
  }
}

function init() {
  context.setTransform(tileSize, 0, 0, tileSize, 0.5, 0.5)

  state.arena = createMatrix(gridWidth, gridHeight)
  state.score = 0
  state.lines = 0
  state.level = 1
  state.dropInterval = 900
  state.dropAccumulator = 0
  state.lastTime = 0
  state.gameOver = false
  status.hidden = true

  resetPlayer()
  updateHUD()
  draw()

  requestAnimationFrame(update)
}

document.addEventListener("keydown", (event) => {
  if (state.gameOver) {
    if (event.key === "r") {
      event.preventDefault()
      init()
    }

    return
  }

  if (["ArrowLeft", "a", "A"].includes(event.key)) {
    event.preventDefault()
    playerMove(-1)
  }

  if (["ArrowRight", "d", "D"].includes(event.key)) {
    event.preventDefault()
    playerMove(1)
  }

  if (["ArrowDown", "s", "S"].includes(event.key)) {
    event.preventDefault()
    playerDrop()
  }

  if (["ArrowUp", "w", "W"].includes(event.key)) {
    event.preventDefault()
    playerRotate()
  }

  if (event.key === " " && !state.gameOver) {
    event.preventDefault()
    playerHardDrop()
  }
})

restartButton.addEventListener("click", init)

init()
