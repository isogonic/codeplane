export * from "./client.js"
export * from "./server.js"

import { createCodeplaneClient } from "./client.js"
import { createCodeplaneServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createCodeplane(options?: ServerOptions) {
  const server = await createCodeplaneServer({
    ...options,
  })

  const client = createCodeplaneClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
