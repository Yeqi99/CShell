import { z } from 'zod';

const cursor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const submission = z.literal('local-provider-submission-only');
export const terminalResultSchemas: Record<string, z.ZodType> = {
  terminal_state: z
    .object({
      sessionId: z.string().uuid(),
      nextSequence: cursor.describe(
        'Required expectedSequence for a new action, never permission to replay uncertain input.',
      ),
      scope: z.literal('live-session'),
      acknowledgement: submission,
    })
    .strict(),
  terminal_input: z
    .object({
      sessionId: z.string().uuid(),
      accepted: z
        .literal(true)
        .describe(
          'Submitted to the local provider; remote handling and command success are not confirmed.',
        ),
      nextSequence: cursor,
      acknowledgement: submission,
    })
    .strict(),
  terminal_read: z
    .object({
      sessionId: z.string().uuid(),
      persistence: z.literal('live-session'),
      encoding: z.literal('base64'),
      textEncoding: z.literal('utf-8'),
      data: z
        .string()
        .describe(
          'Base64 bytes. A page can split a UTF-8 character; use a streaming decoder and reset it after a gap.',
        ),
      offset: cursor.describe(
        'Actual first byte position returned, advanced past evicted bytes if necessary.',
      ),
      nextCursor: cursor.describe('Use as after for the next read of this same session.'),
      latestCursor: cursor.describe('End of output observed at this read.'),
      firstCursor: cursor.describe('Oldest byte still retained.'),
      gap: z
        .boolean()
        .describe('Requested bytes were evicted; this log cannot reconstruct a complete screen.'),
      lostBytes: cursor,
      retainedBytes: z.number().int().min(0).max(262144),
    })
    .strict(),
};

terminalResultSchemas.terminal_resize = terminalResultSchemas.terminal_input;
// JSON schema generation is independent of caller identity; visibility remains caller-filtered.
export const terminalResultJson = Object.fromEntries(
  Object.entries(terminalResultSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
);
const exampleSession = '00000000-0000-4000-8000-000000000001';
export const terminalExamples: Record<
  string,
  { input: Record<string, unknown>; explanation: string }[]
> = {
  terminal_resize: [
    {
      input: { sessionId: exampleSession, expectedSequence: 0, cols: 120, rows: 40 },
      explanation:
        'Use the current sequence from terminal_state. Resize and input share the same sequence; never reuse it after submission.',
    },
  ],
  terminal_state: [
    {
      input: { sessionId: exampleSession },
      explanation:
        'Replace sessionId with your connect result. Read nextSequence before deciding a new input action.',
    },
  ],
  terminal_input: [
    {
      input: { sessionId: exampleSession, expectedSequence: 0, data: '\u0003' },
      explanation:
        'Request the terminal’s interrupt action only if state currently reports sequence 0. This is not a guarantee that a remote process stopped.',
    },
  ],
  terminal_read: [
    {
      input: { sessionId: exampleSession, after: 0, limitBytes: 16384 },
      explanation:
        'Read retained output; continue with nextCursor for this session. Decode base64, then stream UTF-8. Handle gap explicitly.',
    },
  ],
};
