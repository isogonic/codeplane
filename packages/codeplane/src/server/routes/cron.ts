import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { lazy } from "@/util/lazy"
import { Cron, CronScheduler } from "@/cron"
import { CronTaskID, CronRunID } from "@/cron/schema"
import { ProjectID } from "@/project/schema"
import { zodObject } from "@/util/effect-zod"
import { errors } from "../error"

const ScheduleInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cron"),
    expression: z.string(),
  }),
  z.object({
    kind: z.literal("interval"),
    intervalMs: z.number(),
  }),
])

const CreateInput = z.object({
  projectID: ProjectID.zod.optional(),
  directory: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
  agent: z.string().optional(),
  model: z.string().optional(),
  schedule: ScheduleInput,
  timezone: z.string().optional(),
  status: Cron.Status.zod.optional(),
  timeoutMs: z.number().optional(),
  maxRetries: z.number().optional(),
})

const cronRuntime = makeRuntime(Cron.Service, Cron.defaultLayer)
const cronSchedulerRuntime = makeRuntime(CronScheduler.Service, CronScheduler.defaultLayer)

export const CronRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List cron tasks",
        description: "List all cron tasks across all projects, optionally filtered by project or directory.",
        operationId: "cron.list",
        responses: {
          200: {
            description: "Cron tasks",
            content: {
              "application/json": {
                schema: resolver(Cron.Task.zod.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          projectID: ProjectID.zod.optional(),
          directory: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const tasks = await cronRuntime.runPromise((svc) =>
          svc.list({ projectID: query.projectID, directory: query.directory }),
        )
        return c.json(tasks)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create cron task",
        description: "Create a new cron task scoped to a project.",
        operationId: "cron.create",
        responses: {
          200: {
            description: "Created cron task",
            content: {
              "application/json": {
                schema: resolver(Cron.Task.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CreateInput),
      async (c) => {
        const body = c.req.valid("json")
        const task = await cronRuntime.runPromise((svc) => svc.create(body))
        return c.json(task)
      },
    )
    .get(
      "/:taskID",
      describeRoute({
        summary: "Get cron task",
        operationId: "cron.get",
        responses: {
          200: {
            description: "Cron task",
            content: { "application/json": { schema: resolver(Cron.Task.zod) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: CronTaskID.zod })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const task = await cronRuntime.runPromise((svc) => svc.get(taskID))
        return c.json(task)
      },
    )
    .patch(
      "/:taskID",
      describeRoute({
        summary: "Update cron task",
        operationId: "cron.update",
        responses: {
          200: {
            description: "Updated cron task",
            content: { "application/json": { schema: resolver(Cron.Task.zod) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: CronTaskID.zod })),
      validator("json", zodObject(Cron.UpdateInput).omit({ taskID: true })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const body = c.req.valid("json") as Omit<Cron.UpdateInput, "taskID">
        const task = await cronRuntime.runPromise((svc) => svc.update({ ...body, taskID } as Cron.UpdateInput))
        return c.json(task)
      },
    )
    .delete(
      "/:taskID",
      describeRoute({
        summary: "Delete cron task",
        operationId: "cron.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: CronTaskID.zod })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        await cronSchedulerRuntime.runPromise((svc) => svc.cancelTask(taskID)).catch(() => undefined)
        await cronRuntime.runPromise((svc) => svc.remove(taskID))
        return c.json(true)
      },
    )
    .post(
      "/:taskID/status",
      describeRoute({
        summary: "Set cron task status",
        operationId: "cron.setStatus",
        responses: {
          200: {
            description: "Updated cron task",
            content: { "application/json": { schema: resolver(Cron.Task.zod) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: CronTaskID.zod })),
      validator("json", z.object({ status: Cron.Status.zod })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const { status } = c.req.valid("json")
        const task = await cronRuntime.runPromise((svc) => svc.setStatus({ taskID, status }))
        return c.json(task)
      },
    )
    .post(
      "/:taskID/trigger",
      describeRoute({
        summary: "Trigger cron task now",
        description: "Queue an immediate run for this task, bypassing the schedule.",
        operationId: "cron.trigger",
        responses: {
          200: {
            description: "Queued run",
            content: { "application/json": { schema: resolver(Cron.Run.zod) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: CronTaskID.zod })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const run = await cronRuntime.runPromise(() =>
          Effect.gen(function* () {
            const svc = yield* Cron.Service
            const task = yield* svc.get(taskID)
            yield* svc.update({ taskID, status: task.status === "disabled" ? "active" : task.status })
            return yield* svc.trigger(taskID)
          }),
        )
        cronSchedulerRuntime.runPromise((svc) => svc.tick()).catch(() => undefined)
        return c.json(run)
      },
    )
    .get(
      "/:taskID/runs",
      describeRoute({
        summary: "List runs for a cron task",
        operationId: "cron.runs.list",
        responses: {
          200: {
            description: "Cron runs",
            content: { "application/json": { schema: resolver(Cron.Run.zod.array()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: CronTaskID.zod })),
      validator("query", z.object({ limit: z.coerce.number().optional() })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const { limit } = c.req.valid("query")
        const runs = await cronRuntime.runPromise((svc) => svc.listRuns(taskID, limit))
        return c.json(runs)
      },
    )
    .get(
      "/runs/:runID",
      describeRoute({
        summary: "Get cron run",
        operationId: "cron.runs.get",
        responses: {
          200: {
            description: "Cron run",
            content: { "application/json": { schema: resolver(Cron.Run.zod) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: CronRunID.zod })),
      async (c) => {
        const { runID } = c.req.valid("param")
        const run = await cronRuntime.runPromise((svc) => svc.getRun(runID))
        return c.json(run)
      },
    )
    .post(
      "/runs/:runID/cancel",
      describeRoute({
        summary: "Cancel a cron run",
        operationId: "cron.runs.cancel",
        responses: {
          200: {
            description: "Cancelled",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: CronRunID.zod })),
      async (c) => {
        const { runID } = c.req.valid("param")
        await cronSchedulerRuntime.runPromise((svc) => svc.cancelRun(runID))
        return c.json(true)
      },
    ),
)
