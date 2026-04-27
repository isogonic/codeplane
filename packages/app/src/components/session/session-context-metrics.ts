import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"

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

type Metrics = {
  totalCost: number
  averageTokensPerSecond: number | null
  context: Context | undefined
}

type CompletedAssistantMessage = AssistantMessage & {
  time: AssistantMessage["time"] & {
    completed: number
  }
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const generatedTokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.output + msg.tokens.reasoning
}

const completedAssistantWithDuration = (msg: Message): msg is CompletedAssistantMessage => {
  return msg.role === "assistant" && typeof msg.time.completed === "number" && msg.time.completed > msg.time.created
}

const averageTokensPerSecond = (messages: Message[]) => {
  const completed = messages.filter(completedAssistantWithDuration)
  const duration = completed.reduce((sum, msg) => sum + msg.time.completed - msg.time.created, 0)
  if (duration <= 0) return null
  return (completed.reduce((sum, msg) => sum + generatedTokenTotal(msg), 0) / duration) * 1000
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
  const speed = averageTokensPerSecond(messages)
  const message = lastAssistantWithTokens(messages)
  if (!message) return { totalCost, averageTokensPerSecond: speed, context: undefined }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    averageTokensPerSecond: speed,
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
