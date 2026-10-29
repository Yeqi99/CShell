import { networkMetricsSchema } from '../../shared/network-metrics';
import { z } from 'zod';
import { localShellSchema } from '../../shared/local-terminal';
import { directoryPageOutput } from './directory-page';
import { serverSummary, serverPageOutput } from './server-pages';

const failure = z
  .object({
    code: z.string(),
    message: z.string(),
    nextAction: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const task = z
  .object({
    taskId: z.string().uuid(),
    target: z.string(),
    permission: z.string(),
    state: z.enum([
      'queued',
      'running',
      'cancel_requested',
      'succeeded',
      'failed',
      'cancelled',
      'unknown',
    ]),
    settled: z.boolean(),
    released: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
    persistence: z.literal('process-lifetime'),
    retentionMs: z.number().int().positive(),
    result: z
      .unknown()
      .optional()
      .describe(
        'Selected operation result; inspect its complete contract. Absent before completion or after release.',
      ),
    error: failure.optional(),
  })
  .strict();
export const metricsResult = z
  .object({
    network: networkMetricsSchema.optional(),
    cpuModel: z.string().nullable().optional(),
    cpu: z.number().nullable(),
    cpuCount: z.number().nullable(),
    memory: z.number().nullable(),
    memoryUsed: z.number().nullable(),
    memoryTotal: z.number().nullable(),
    disk: z.number().nullable(),
    diskUsed: z.number().nullable(),
    diskTotal: z.number().nullable(),
    physicalDisks: z.array(z.object({name: z.string(), size: z.number()}).strict()).optional(),
    disks: z.array(z.object({device: z.string(), mount: z.string(), total: z.number(), used: z.number(), percent: z.number()}).strict()).optional(),
    latency: z.number(),
    error: z.string().optional(),
  })
  .strict();
export const fileListResult = directoryPageOutput
  .pick({ path: true, entries: true })
  .extend({ entries: z.array(directoryPageOutput.shape.entries.element) });
export const baseResultSchemas: Record<string, z.ZodType> = {
  list_servers: z.array(serverSummary),
  list_servers_page: serverPageOutput,
  connect: z.object({ sessionId: z.string().uuid() }).strict(),
  disconnect: z.object({ closed: z.literal(true) }).strict(),
  list_local_targets: z.array(
    z
      .object({
        profileId: z.string().uuid(),
        shell: localShellSchema,
        name: z.string(),
        providerId: z.literal('cshell.local-terminal'),
        capabilities: z.array(z.enum(['terminal.read', 'terminal.input'])),
      })
      .strict(),
  ),
  list_files: fileListResult,
  monitor: metricsResult,
  execute_command: z.object({ output: z.string(), exitCode: z.number().int().optional() }).strict(),
  invoke_connection: z
    .string()
    .describe(
      'Result string from the selected provider tool. describe_connection supplies its content schema where the result is JSON.',
    ),
  describe_connection: z
    .object({
      terminalEnvironment: z.object({ parentSessionId: z.string().uuid(), conda: z.string(), prefix: z.string() }).strict().optional(),
      target: z
        .object({
          providerId: z.string(),
          resourceId: z.string(),
          identity: z.string(),
          label: z.string(),
        })
        .strict(),
      tools: z.array(
        z
          .object({
            name: z.string(),
            capability: z.string(),
            description: z.string(),
            inputSchema: z.record(z.string(), z.unknown()),
            outputSchema: z.record(z.string(), z.unknown()),
            result: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
  task_start: task,
  http_task_start: task,
  task_release: task,
  task_cancel: task.omit({ result: true, error: true }),
  task_read: task.extend({
    events: z
      .array(z.object({ sequence: z.number().int(), type: z.string(), data: z.unknown() }).strict())
      .max(100),
    gap: z.boolean(),
    nextCursor: z.number().int(),
    latestCursor: z.number().int(),
  }),
};
export const baseResultJson = Object.fromEntries(
  Object.entries(baseResultSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
);
