import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as Tool from "./tool"
import DESCRIPTION from "./websearch.txt"

const ENDPOINT = "https://api.exa.ai/search"
const DEFAULT_NUM_RESULTS = 8
const DEFAULT_CONTEXT_MAX_CHARACTERS = 10_000
const REQUEST_TIMEOUT = "25 seconds"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

const ExaResult = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  publishedDate: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.NullOr(Schema.String)),
  text: Schema.optional(Schema.NullOr(Schema.String)),
})

const ExaSearchResponse = Schema.Struct({
  results: Schema.Array(ExaResult),
})

function formatResults(results: ReadonlyArray<Schema.Schema.Type<typeof ExaResult>>, maxChars: number): string {
  if (results.length === 0) return "No search results found. Please try a different query."

  const blocks: string[] = []
  let used = 0
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i]
    const header = `## ${i + 1}. ${r.title ?? r.url}\nURL: ${r.url}` +
      (r.publishedDate ? `\nPublished: ${r.publishedDate}` : "") +
      (r.author ? `\nAuthor: ${r.author}` : "")
    const remainingForBody = Math.max(0, maxChars - used - header.length - 4)
    const body = r.text
      ? r.text.length > remainingForBody
        ? // slice by code points so a surrogate pair (emoji/astral char) at the
          // boundary isn't split into an orphaned surrogate (→ U+FFFD on encode)
          [...r.text].slice(0, remainingForBody).join("").trimEnd() + "…"
        : r.text
      : ""
    const block = body ? `${header}\n\n${body}` : header
    blocks.push(block)
    used += block.length + 2
    if (used >= maxChars) break
  }
  return blocks.join("\n\n")
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
            },
          })

          const apiKey = process.env.EXA_API_KEY
          if (!apiKey) {
            return {
              output:
                "Web search is unavailable: set EXA_API_KEY in the codeplane environment to enable the native websearch tool.",
              title: `Web search: ${params.query}`,
              metadata: {},
            }
          }

          const numResults = params.numResults ?? DEFAULT_NUM_RESULTS
          const contextMaxCharacters = params.contextMaxCharacters ?? DEFAULT_CONTEXT_MAX_CHARACTERS

          const body = {
            query: params.query,
            type: params.type ?? "auto",
            numResults,
            livecrawl: params.livecrawl ?? "fallback",
            contents: {
              text: { maxCharacters: Math.max(500, Math.floor(contextMaxCharacters / Math.max(1, numResults))) },
            },
          }

          const request = HttpClientRequest.post(ENDPOINT).pipe(
            HttpClientRequest.setHeaders({
              "Content-Type": "application/json",
              Accept: "application/json",
              "x-api-key": apiKey,
              "User-Agent": "codeplane-websearch",
            }),
            HttpClientRequest.bodyText(JSON.stringify(body), "application/json"),
          )

          const response = yield* httpOk
            .execute(request)
            .pipe(
              Effect.timeoutOrElse({
                duration: REQUEST_TIMEOUT,
                orElse: () => Effect.die(new Error("Web search request timed out")),
              }),
            )

          const data = yield* HttpClientResponse.schemaBodyJson(ExaSearchResponse)(response)

          return {
            output: formatResults(data.results, contextMaxCharacters),
            title: `Web search: ${params.query}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
