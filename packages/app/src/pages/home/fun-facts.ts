import type { Totals } from "./stats"

export type FunFact = {
  key: string
  params: Record<string, string | number>
}

type Definition = {
  key: string
  available: (totals: Totals) => boolean
  build: (totals: Totals) => Record<string, string | number>
}

// Reference sizes for token comparisons. Rough word-count estimates × 1.33
// tokens-per-word, biased toward popular cultural touchstones rather than
// strict accuracy.
const TOKEN_REFERENCES = {
  novel: 100_000, // average paperback novel
  dune: 250_000, // Frank Herbert's Dune
  lotr: 600_000, // Lord of the Rings trilogy
  warAndPeace: 750_000, // Tolstoy's War and Peace
  bible: 1_000_000, // King James Bible
  shakespeare: 1_200_000, // Shakespeare's complete works
  harryPotter: 1_500_000, // Harry Potter complete series
}

// Devin Oldenburg's observed token consumption: ~2 billion tokens over 10 days
// of heavy daily usage = 200M tokens/day. Used as the upper-bound comparison
// point for "are you using as much as the most prolific user we've seen?"
const DEVIN_TOKENS_PER_DAY = 200_000_000

const DEFINITIONS: Definition[] = [
  // ---------------- Reference power user ----------------
  {
    key: "home.fact.devin.match",
    available: (t) =>
      t.tokens >= 10_000_000 && t.activeDays >= 5 && t.tokens / Math.max(t.activeDays, 1) >= DEVIN_TOKENS_PER_DAY * 0.5,
    build: (t) => ({
      percent: Math.round(((t.tokens / Math.max(t.activeDays, 1)) / DEVIN_TOKENS_PER_DAY) * 100),
    }),
  },
  {
    key: "home.fact.devin.behind",
    available: (t) =>
      t.tokens >= 1_000_000 && t.activeDays >= 5 && t.tokens / Math.max(t.activeDays, 1) < DEVIN_TOKENS_PER_DAY * 0.5,
    build: (t) => ({
      ratio: Math.max(2, Math.round(DEVIN_TOKENS_PER_DAY / Math.max(1, t.tokens / Math.max(t.activeDays, 1)))),
    }),
  },
  // ---------------- Token book comparisons ----------------
  {
    key: "home.fact.tokens.novel",
    available: (t) => t.tokens >= TOKEN_REFERENCES.novel,
    build: (t) => ({ count: Math.round(t.tokens / TOKEN_REFERENCES.novel) }),
  },
  {
    key: "home.fact.tokens.dune",
    available: (t) => t.tokens >= TOKEN_REFERENCES.dune,
    build: (t) => ({ count: Math.round(t.tokens / TOKEN_REFERENCES.dune) }),
  },
  {
    key: "home.fact.tokens.lotr",
    available: (t) => t.tokens >= TOKEN_REFERENCES.lotr,
    build: (t) => ({ count: Math.round(t.tokens / TOKEN_REFERENCES.lotr) }),
  },
  {
    key: "home.fact.tokens.warAndPeace",
    available: (t) => t.tokens >= TOKEN_REFERENCES.warAndPeace,
    build: (t) => ({ count: Math.round(t.tokens / TOKEN_REFERENCES.warAndPeace) }),
  },
  {
    key: "home.fact.tokens.bible",
    available: (t) => t.tokens >= TOKEN_REFERENCES.bible,
    build: (t) => ({ count: Math.round(t.tokens / TOKEN_REFERENCES.bible) }),
  },
  {
    key: "home.fact.tokens.shakespeare",
    available: (t) => t.tokens >= TOKEN_REFERENCES.shakespeare,
    build: (t) => ({ count: Math.round(t.tokens / TOKEN_REFERENCES.shakespeare) }),
  },
  {
    key: "home.fact.tokens.harryPotter",
    available: (t) => t.tokens >= TOKEN_REFERENCES.harryPotter,
    build: (t) => ({ count: Math.round(t.tokens / TOKEN_REFERENCES.harryPotter) }),
  },

  // ---------------- Tokens per message ----------------
  {
    key: "home.fact.tokens.perMessage",
    available: (t) => t.messages >= 20 && t.tokens >= 50_000,
    build: (t) => ({ count: Math.round(t.tokens / Math.max(t.messages, 1)) }),
  },

  // ---------------- Message volume ----------------
  {
    key: "home.fact.messages.perActiveDay",
    available: (t) => t.messages >= 50 && t.activeDays >= 3,
    build: (t) => ({ count: Math.round(t.messages / Math.max(t.activeDays, 1)) }),
  },
  {
    key: "home.fact.messages.thousand",
    available: (t) => t.messages >= 1_000,
    build: (t) => ({ count: Math.round(t.messages / 1_000) }),
  },
  {
    key: "home.fact.messages.total",
    available: (t) => t.messages >= 100,
    build: (t) => ({ count: t.messages }),
  },

  // ---------------- Streaks ----------------
  {
    key: "home.fact.streak.week",
    available: (t) => t.currentStreak >= 7 && t.currentStreak < 30,
    build: (t) => ({ count: t.currentStreak }),
  },
  {
    key: "home.fact.streak.month",
    available: (t) => t.currentStreak >= 30 && t.currentStreak < 100,
    build: (t) => ({ count: t.currentStreak }),
  },
  {
    key: "home.fact.streak.legendary",
    available: (t) => t.currentStreak >= 100,
    build: (t) => ({ count: t.currentStreak }),
  },
  {
    key: "home.fact.streak.bestEver",
    available: (t) => t.longestStreak >= 14 && t.longestStreak > t.currentStreak,
    build: (t) => ({ count: t.longestStreak }),
  },

  // ---------------- Active days ----------------
  {
    key: "home.fact.activeDays.percent",
    available: (t) => t.activeDays >= 30,
    build: (t) => ({
      count: t.activeDays,
      percent: Math.min(100, Math.round((t.activeDays / 365) * 100)),
    }),
  },
  {
    key: "home.fact.activeDays.workYear",
    available: (t) => t.activeDays >= 220,
    build: (t) => ({ count: t.activeDays }),
  },

  // ---------------- Sessions ----------------
  {
    key: "home.fact.sessions.perWeek",
    available: (t) => t.sessions >= 10 && t.activeDays >= 14,
    build: (t) => ({ count: Math.max(1, Math.round((t.sessions / Math.max(t.activeDays, 1)) * 7)) }),
  },
  {
    key: "home.fact.sessions.century",
    available: (t) => t.sessions >= 100,
    build: (t) => ({ count: t.sessions }),
  },
  {
    key: "home.fact.sessions.thousand",
    available: (t) => t.sessions >= 1_000,
    build: (t) => ({ count: Math.round(t.sessions / 1_000) }),
  },

  // ---------------- Peak hour ----------------
  {
    key: "home.fact.peakHour.midnight",
    available: (t) => t.peakHour !== undefined && (t.peakHour < 5 || t.peakHour === 23),
    build: (t) => ({ hour: t.peakHour ?? 0 }),
  },
  {
    key: "home.fact.peakHour.earlybird",
    available: (t) => t.peakHour !== undefined && t.peakHour >= 5 && t.peakHour <= 8,
    build: (t) => ({ hour: t.peakHour ?? 0 }),
  },
  {
    key: "home.fact.peakHour.midday",
    available: (t) => t.peakHour !== undefined && t.peakHour >= 11 && t.peakHour <= 14,
    build: (t) => ({ hour: t.peakHour ?? 0 }),
  },
  {
    key: "home.fact.peakHour.afternoon",
    available: (t) => t.peakHour !== undefined && t.peakHour >= 15 && t.peakHour <= 18,
    build: (t) => ({ hour: t.peakHour ?? 0 }),
  },
  {
    key: "home.fact.peakHour.evening",
    available: (t) => t.peakHour !== undefined && t.peakHour >= 19 && t.peakHour <= 22,
    build: (t) => ({ hour: t.peakHour ?? 0 }),
  },
]

const dayOfYear = (timestamp: number) => {
  const date = new Date(timestamp)
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
}

/**
 * Pick one of the fun facts that applies to the user's stats. Rotates daily so
 * the same user sees a different message on different days, but it stays
 * stable through a single session.
 */
export function pickFunFact(totals: Totals, now: number): FunFact | undefined {
  const available = DEFINITIONS.filter((definition) => definition.available(totals))
  if (available.length === 0) return undefined
  const index = dayOfYear(now) % available.length
  const definition = available[index]!
  return { key: definition.key, params: definition.build(totals) }
}

/**
 * For tests: enumerate every fact that applies right now, without rotation.
 */
export function listApplicableFacts(totals: Totals): FunFact[] {
  return DEFINITIONS.filter((d) => d.available(totals)).map((d) => ({ key: d.key, params: d.build(totals) }))
}
