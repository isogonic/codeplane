import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

export const Event = {
  Connected: BusEvent.define("server.connected", Schema.Struct({})),
  Dropped: BusEvent.define("server.dropped", Schema.Struct({})),
  Heartbeat: BusEvent.define("server.heartbeat", Schema.Struct({})),
  ResumeFailed: BusEvent.define(
    "server.resume_failed",
    Schema.Struct({
      lastEventID: Schema.optional(Schema.Number),
    }),
  ),
  Disposed: BusEvent.define("global.disposed", Schema.Struct({})),
}
