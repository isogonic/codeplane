import z from "zod"

export const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  return value
}, z.boolean())
