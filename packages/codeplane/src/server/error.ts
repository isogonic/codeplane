import { resolver } from "hono-openapi"
import z from "zod"
import { NotFoundError } from "../storage"

export const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              name: z.string(),
              data: z.any(),
            })
            .meta({
              ref: "BadRequestError",
            }),
        ),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(NotFoundError.Schema),
      },
    },
  },
  500: {
    description: "Internal server error",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              name: z.literal("UnknownError"),
              data: z.object({ message: z.string() }),
            })
            .meta({
              ref: "InternalServerError",
            }),
        ),
      },
    },
  },
} as const

export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}
