import type { AssistantMessage, Message } from "@codeplane-ai/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  usage: number | null
}

export type TurnSpeed = {
  id: string
  index: number
  tokens: number
  ms: number
  tps: number
}

export type SpeedMetrics = {
  lifetime: number | null
  recent: number | null
  peak: number | null
  current: number | null
  turns: TurnSpeed[]
}

type Metrics = {
  totalCost: number
  speed: SpeedMetrics
  context: Context | undefined
}

type CompletedAssistantMessage = AssistantMessage & {
  time: AssistantMessage["time"] & {
    completed: number
  }
}

const RECENT_WINDOW = 5
const MIN_TURN_MS = 250
const MIN_TURN_TOKENS = 4

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const generatedTokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.output + msg.tokens.reasoning
}

const completedAssistantWithDuration = (msg: Message): msg is CompletedAssistantMessage => {
  return msg.role === "assistant" && typeof msg.time.completed === "number" && msg.time.completed > msg.time.created
}

const collectTurnSpeeds = (messages: Message[]): TurnSpeed[] => {
  const result: TurnSpeed[] = []
  let index = 0
  for (const msg of messages) {
    if (!completedAssistantWithDuration(msg)) continue
    const tokens = generatedTokenTotal(msg)
    const ms = msg.time.completed - msg.time.created
    if (tokens < MIN_TURN_TOKENS || ms < MIN_TURN_MS) {
      index++
      continue
    }
    result.push({
      id: msg.id,
      index: index++,
      tokens,
      ms,
      tps: (tokens / ms) * 1000,
    })
  }
  return result
}

const weightedAverage = (turns: TurnSpeed[]): number | null => {
  if (turns.length === 0) return null
  let tokens = 0
  let ms = 0
  for (const turn of turns) {
    tokens += turn.tokens
    ms += turn.ms
  }
  if (ms <= 0) return null
  return (tokens / ms) * 1000
}

const buildSpeed = (messages: Message[]): SpeedMetrics => {
  const turns = collectTurnSpeeds(messages)
  if (turns.length === 0) {
    return { lifetime: null, recent: null, peak: null, current: null, turns }
  }
  const lifetime = weightedAverage(turns)
  const recent = weightedAverage(turns.slice(-RECENT_WINDOW))
  const peak = turns.reduce((max, turn) => (turn.tps > max ? turn.tps : max), 0)
  const current = turns[turns.length - 1]?.tps ?? null
  return { lifetime, recent, peak, current, turns }
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Metrics => {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const speed = buildSpeed(messages)
  const message = lastAssistantWithTokens(messages)
  if (!message) return { totalCost, speed, context: undefined }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    speed,
    context: {
      message,
      provider,
      model,
      providerLabel: provider?.name ?? message.providerID,
      modelLabel: model?.name ?? message.modelID,
      limit,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
      cacheWrite: message.tokens.cache.write,
      total,
      usage: limit ? Math.round((total / limit) * 100) : null,
    },
  }
}

export function getSessionContextMetrics(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}
