import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Profile } from '../../shared/contracts';
import { desktopCaptureInput, screenshotOutput } from '../../shared/visual-tools';
import type { ManagedProvider } from './manager';
import type { ProviderConnection } from './contracts';
import { rdpProfileSchema } from '../rdp';

export const rdpIdentity = (p: Profile) =>
  JSON.stringify([p.host.toLowerCase(), p.port, p.username]);
const inputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('text'),
      text: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[^\x00-\x1f\x7f\uD800-\uDFFF]+$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('click'),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      button: z.enum(['left', 'right', 'middle']).default('left'),
    })
    .strict(),
  z
    .object({
      action: z.literal('key'),
      scanCode: z.number().int().min(1).max(127),
      extended: z.boolean().default(false),
      modifiers: z
        .array(z.enum(['ctrl', 'alt', 'shift', 'win']))
        .max(4)
        .default([]),
    })
    .strict(),
]);

export class RdpConnectionProvider implements ManagedProvider {
  readonly id = 'cshell.rdp';
  readonly version = '1.0.0';
  readonly capabilities = ['desktop.view', 'desktop.control'];
  readonly configuration = rdpProfileSchema;
  private sessions = new Map<string, { connection: ProviderConnection; close(): void }>();
  constructor(
    private executable: string,
    private onClosed: (id: string) => void,
  ) {}
  resolve(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw Error('RDP session closed');
    return session.connection;
  }
  disconnect(id: string) {
    this.sessions.get(id)?.close();
  }
  async connect(
    config: unknown,
    credentials: unknown,
    signal: AbortSignal,
    ready?: (id: string) => void,
  ) {
    const p = rdpProfileSchema.parse(config);
    const { password } = z.object({ password: z.string().min(1).max(16000) }).parse(credentials);
    signal.throwIfAborted();
    if (this.sessions.size >= 8) throw Error('RDP session limit reached');
    const id = randomUUID();
    const child = spawn(
      this.executable,
      ['-I', '-B', join(dirname(this.executable), 'session.py')],
      { windowsHide: true, stdio: 'pipe' },
    );
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    let pending: { resolve(v: unknown): void; reject(e: Error): void } | undefined;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.sessions.delete(id);
      child.kill();
      pending?.reject(Error('RDP session closed'));
      this.onClosed(id);
    };
    lines.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        if (response.error) {
          pending?.reject(Error(String(response.error)));
          close();
        } else pending?.resolve(response);
      } catch {
        close();
      }
    });
    child.once('close', close);
    child.once('error', close);
    child.stdin.on('error', close);
    const request = async (value: unknown, abort: AbortSignal) => {
      abort.throwIfAborted();
      if (closed || pending) throw Error('RDP session closed or busy');
      const timer = setTimeout(close, 45_000);
      abort.addEventListener('abort', close, { once: true });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          pending = { resolve, reject };
          child.stdin.write(JSON.stringify(value) + '\n');
        });
      } finally {
        clearTimeout(timer);
        abort.removeEventListener('abort', close);
        pending = undefined;
      }
    };
    const connection: ProviderConnection = {
      target: { providerId: this.id, resourceId: p.id, label: p.name, identity: rdpIdentity(p) },
      tools: [
        {
          name: 'desktop_screenshot',
          capability: 'desktop.view',
          description: 'Capture a JPEG from this authenticated background RDP session.',
          input: desktopCaptureInput,
          jsonOutput: screenshotOutput,
          needsReview: () => false,
          invoke: async (input, abort, _out, guard) => {
            guard?.();
            const frame = await request(
              { action: 'capture', ...desktopCaptureInput.parse(input) },
              abort,
            );
            guard?.();
            return JSON.stringify(screenshotOutput.parse(frame));
          },
        },
        {
          name: 'desktop_interact',
          capability: 'desktop.control',
          description:
            'Send single-line BMP text, click normalized x/y coordinates, or send a scan code with optional modifiers to this RDP session.',
          input: inputSchema,
          needsReview: () => true,
          conflictDomain: () => 'desktop',
          invoke: async (input, abort, _out, guard) => {
            guard?.();
            return JSON.stringify(await request(inputSchema.parse(input), abort));
          },
        },
      ],
    };
    this.sessions.set(id, { connection, close });
    try {
      z.object({ ready: z.literal(true) }).parse(
        await request(
          { id: p.id, host: p.host, port: p.port, username: p.username, password },
          signal,
        ),
      );
      ready?.(id);
      return id;
    } catch (error) {
      close();
      throw error;
    }
  }
}
