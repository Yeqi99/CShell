import { z } from 'zod';
import { applicationId } from '../../shared/plugins';
import { portMappingSchema } from '../../shared/docker';
import type { ConnectionTool } from '../connections/contracts';

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const notebookStatus = z
  .object({ running: z.boolean(), port: z.number().int().min(1024).max(65535).optional() })
  .strict();
const job = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    label: z.string(),
    state: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
    output: z.string().describe('Bounded job output tail; not a complete transcript.'),
    started: z.number().describe('Unix epoch milliseconds.'),
  })
  .strict();

export const extensionResults: Readonly<Record<string, z.ZodType>> = {
  environment_jupyter_status: notebookStatus,
  environment_jupyter_start: notebookStatus,
  environment_jupyter_stop: notebookStatus,
  docker_snapshot: z
    .object({
      containers: z.array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            image: z.string(),
            state: z.string(),
            status: z.string(),
            ports: z.string(),
            project: z.string(),
          })
          .strict(),
      ),
      images: z.array(
        z
          .object({
            id: z.string(),
            tags: z.array(z.string()),
            size: z.number(),
            created: z.number(),
          })
          .strict(),
      ),
    })
    .strict(),
  docker_stats: z
    .object({
      cpu: z.number().nullable(),
      memory: z.number(),
      memoryLimit: z.number(),
      rx: z.number(),
      tx: z.number(),
      pids: z.number().nullable(),
    })
    .strict(),
  docker_details: z
    .object({ ports: z.array(portMappingSchema), restart: z.string(), managed: z.boolean() })
    .strict(),
  docker_action: z
    .object({
      id: z.string().optional(),
      backup: z.string().optional(),
      snapshot: z.string().optional(),
    })
    .strict(),
  python_file_read: z.object({ code: z.string(), revision }).strict(),
  python_file_save: z.object({ revision }).strict(),
  python_analyze: z
    .object({
      completions: z
        .array(z.object({ label: z.string(), detail: z.string(), type: z.string() }).strict())
        .max(100),
      signatures: z.array(z.string()).max(100),
      diagnostics: z
        .array(
          z
            .object({
              line: z.number(),
              column: z.number(),
              endLine: z.number(),
              endColumn: z.number(),
              message: z.string(),
            })
            .strict(),
        )
        .max(1000),
    })
    .strict(),
  environments_list: z
    .object({
      conda: z.string().nullable(),
      python: z.string().nullable(),
      environments: z.array(
        z.object({ prefix: z.string(), python: z.string(), name: z.string() }).strict(),
      ),
    })
    .strict(),
  environment_packages: z
    .array(z.object({ name: z.string(), version: z.string() }).strict())
    .max(10000),
  environment_action: job,
  applications_list: z.array(
    z.object({ id: applicationId, name: z.string(), description: z.string() }).strict(),
  ),
  application_plan: z
    .object({
      id: z.string().uuid(),
      sessionId: z.string().uuid(),
      app: applicationId,
      label: z.string(),
      command: z.string(),
      expires: z.number().describe('Unix epoch milliseconds; plans expire after fifteen minutes.'),
    })
    .strict(),
  application_install: job,
};

export const extensionExamples: Readonly<Record<string, ConnectionTool['examples']>> = {
  environment_jupyter_status: [
    {
      input: { python: '/usr/bin/python3' },
      explanation:
        'Use the actual interpreter selected from environments_list on this session. An external notebook is never adopted.',
    },
  ],
  environment_jupyter_start: [
    {
      input: { python: '/usr/bin/python3', port: 8888 },
      explanation:
        'Select an installed interpreter with jupyterlab and a free remote loopback port. Start as an idempotent task. Tokens remain in the backend; this API does not return browser credentials.',
    },
  ],
  environment_jupyter_stop: [
    {
      input: { python: '/usr/bin/python3' },
      explanation:
        'Stop the notebook belonging to this exact API session and interpreter. Use task cancellation for a queued or starting request.',
    },
  ],
  docker_snapshot: [
    {
      input: {},
      explanation:
        'Read the actual containers and images from this target’s configured Unix socket.',
    },
  ],
  docker_stats: [
    {
      input: { id: 'a'.repeat(64) },
      explanation: 'Replace the sample ID with a container ID from docker_snapshot on this target.',
    },
  ],
  docker_details: [
    {
      input: { id: 'a'.repeat(64) },
      explanation: 'Inspect the selected actual container before considering a change.',
    },
  ],
  docker_action: [
    {
      input: { type: 'stop', id: 'a'.repeat(64) },
      explanation:
        'Replace the sample ID with the selected container ID and explicitly approve stopping it. Use task_start with an idempotency key.',
    },
  ],
  python_file_read: [
    {
      input: { path: './main.py' },
      explanation: 'Read source and retain its content revision for python_file_save.',
    },
  ],
  python_file_save: [
    {
      input: {
        path: './main.py',
        code: 'print("hello")\n',
        revision: '0'.repeat(64),
        acceptNonAtomic: true,
      },
      explanation:
        'Replace the example revision with python_file_read.revision. Review the complete replacement source before saving.',
    },
  ],
  python_analyze: [
    {
      input: { python: '/usr/bin/python3', code: 'import os\nos.pa', line: 2, column: 5 },
      explanation:
        'Use an interpreter returned by environments_list with Jedi installed; the path shown is an example, not an assumed target environment.',
    },
  ],
  environments_list: [
    {
      input: {},
      explanation: 'Inspect actual interpreters before selecting one for packages or analysis.',
    },
  ],
  environment_packages: [
    {
      input: { python: '/usr/bin/python3' },
      explanation:
        'Replace the example with the selected actual interpreter from environments_list.',
    },
  ],
  environment_action: [
    {
      input: {
        type: 'create',
        conda: '/opt/conda/bin/conda',
        name: 'cshell-work',
        version: '3.12',
      },
      explanation:
        'Use the actual conda path from environments_list and a new name. Submit through task_start with an idempotency key; inspect the resulting job state.',
    },
  ],
  applications_list: [
    {
      input: {},
      explanation: 'Choose a supported recipe, then call application_plan against this target.',
    },
  ],
  application_plan: [
    {
      input: { app: 'jedi', python: '/usr/bin/python3' },
      explanation:
        'Use the actual selected interpreter, then review the returned target-bound command before installation.',
    },
  ],
  application_install: [
    {
      input: { planId: '00000000-0000-4000-8000-000000000001' },
      explanation:
        'Replace with an unexpired application_plan.id from this exact session. Use task_start and retain the idempotency key; succeeded/failed/cancelled describe the job result.',
    },
  ],
};
