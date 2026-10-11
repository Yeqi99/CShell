import { createServer, type Server as HttpServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFile, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { Store } from './store';
import { SshService } from './ssh';
import { mcpSettingsSchema, type McpSettings, type McpStatus } from '../shared/contracts';

export class McpService {
  private http?: HttpServer;
  private token = '';
  private error?: string;
  private requests = 0;
  private pending = 0;
  private connecting = 0;
  private generation = 0;
  private auditWrites = Promise.resolve();
  private connections = new Map<string, string>();
  private ssh: SshService;
  constructor(
    private store: Store,
    private directory: string,
    private confirm: (name: string, command: string) => Promise<boolean>,
  ) {
    this.ssh = new SshService(
      (event) => {
        if (event.type === 'data') this.ssh.acknowledge(event.sessionId, event.data.length);
        if (event.type === 'closed') this.connections.delete(event.sessionId);
      },
      async (profile, fingerprint) =>
        this.store.host(`${profile.host.toLowerCase()}:${profile.port}`) === fingerprint,
    );
  }
  status(): McpStatus {
    return {
      settings: this.store.mcpSettings(),
      running: !!this.http?.listening,
      error: this.error,
      requests: this.requests,
    };
  }
  async accessToken() {
    let token = await this.store.mcpToken();
    if (!token) {
      token = randomBytes(32).toString('base64url');
      await this.store.setMcpToken(token);
    }
    return token;
  }
  async rotateToken() {
    await this.store.setMcpToken(randomBytes(32).toString('base64url'));
    await this.start();
  }
  async configure(input: McpSettings) {
    await this.store.setMcpSettings(mcpSettingsSchema.parse(input));
    await this.start();
    return this.status();
  }
  async stop() {
    this.generation++;
    this.ssh.dispose();
    this.connections.clear();
    const http = this.http;
    this.http = undefined;
    if (http) {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  }
  async start() {
    await this.stop();
    this.error = undefined;
    const settings = this.store.mcpSettings();
    if (!settings.enabled) return;
    try {
      this.token = await this.accessToken();
      const http = createServer((req, res) => {
        void (async () => {
          if (req.url !== '/mcp') {
            res.writeHead(404).end();
            return;
          }
          // Reject browser origins and DNS rebinding, even when an attacker knows the port.
          if (
            req.headers.origin ||
            ![`127.0.0.1:${settings.port}`, `localhost:${settings.port}`].includes(
              req.headers.host || '',
            )
          ) {
            res.writeHead(403).end();
            return;
          }
          const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
          const expected = Buffer.from(this.token);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            res.writeHead(401).end();
            return;
          }
          if (req.method !== 'POST') {
            res.writeHead(405).end();
            return;
          }
          if (this.pending >= 8) {
            res.writeHead(429).end();
            return;
          }
          this.pending++;
          this.requests++;
          try {
            let size = 0;
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 65536) {
                res.writeHead(413).end();
                return;
              }
              chunks.push(Buffer.from(chunk));
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const server = this.server();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
              enableJsonResponse: true,
            });
            res.once('close', () => {
              void transport.close();
              void server.close();
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
          } finally {
            this.pending--;
          }
        })().catch(() => {
          if (!res.headersSent) res.writeHead(400);
          res.end();
        });
      });
      http.requestTimeout = 15000;
      http.headersTimeout = 10000;
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(settings.port, '127.0.0.1', () => {
          http.removeListener('error', reject);
          resolve();
        });
      });
      this.http = http;
      http.on('error', (error) => {
        this.error = error.message;
      });
    } catch (error) {
      this.error = (error as Error).message;
    }
  }
  private allowed(profileId: string) {
    if (
      !this.store.mcpSettings().enabled ||
      !this.store.mcpSettings().allowedProfiles.includes(profileId)
    )
      throw new Error('Profile is not authorized for MCP');
    return this.store.profile(profileId);
  }
  private session(id: string) {
    const profileId = this.connections.get(id);
    if (!profileId) throw new Error('Unknown MCP session');
    this.allowed(profileId);
    return this.ssh.get(id);
  }
  private audit(tool: string, ok: boolean) {
    this.auditWrites = this.auditWrites
      .catch(() => {})
      .then(async () => {
        const path = join(this.directory, 'mcp-audit.jsonl');
        if ((await stat(path).catch(() => null))?.size! > 1_000_000)
          await rename(path, `${path}.previous`).catch(() => {});
        await appendFile(
          path,
          JSON.stringify({ time: new Date().toISOString(), tool, ok }) + '\n',
          { mode: 0o600 },
        );
      });
    void this.auditWrites.catch(() => {});
  }
  private server() {
    const server = new McpServer({ name: 'CShell', version: '0.1.3' });
    const run = async (tool: string, fn: () => Promise<unknown> | unknown) => {
      try {
        const result = await fn();
        this.audit(tool, true);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        this.audit(tool, false);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: (error as Error).message }],
        };
      }
    };
    server.registerTool(
      'list_servers',
      {
        description:
          'List saved servers explicitly authorized in CShell. No credentials are returned.',
        annotations: { readOnlyHint: true },
      },
      async () =>
        run('list_servers', () =>
          this.store
            .snapshot()
            .profiles.filter((p) => this.store.mcpSettings().allowedProfiles.includes(p.id))
            .map(({ id, name, host, port, username }) => ({ id, name, host, port, username })),
        ),
    );
    server.registerTool(
      'connect',
      {
        description:
          'Connect an authorized saved server using locally stored credentials and an already trusted host key.',
        inputSchema: { profileId: z.string().uuid() },
      },
      async ({ profileId }) =>
        run('connect', async () => {
          const profile = this.allowed(profileId),
            generation = this.generation;
          if (this.connections.size + this.connecting >= 8)
            throw new Error('Maximum 8 MCP connections');
          this.connecting++;
          let result: { sessionId: string };
          try {
            const secret = await this.store.secret(profileId);
            if (!secret) throw new Error('Save credentials in CShell first');
            if (generation !== this.generation) throw new Error('MCP configuration changed');
            result = await this.ssh.connect(profile, secret);
          } finally {
            this.connecting--;
          }
          if (generation !== this.generation) {
            this.ssh.disconnect(result.sessionId);
            throw new Error('MCP configuration changed');
          }
          this.allowed(profileId);
          this.connections.set(result.sessionId, profileId);
          return result;
        }),
    );
    server.registerTool(
      'disconnect',
      {
        description: 'Close an MCP-owned connection.',
        inputSchema: { sessionId: z.string().uuid() },
      },
      async ({ sessionId }) =>
        run('disconnect', () => {
          this.session(sessionId);
          this.ssh.disconnect(sessionId);
          this.connections.delete(sessionId);
          return { closed: true };
        }),
    );
    server.registerTool(
      'list_files',
      {
        description: 'List files on an authorized MCP connection.',
        inputSchema: { sessionId: z.string().uuid(), path: z.string().min(1).max(4096) },
        annotations: { readOnlyHint: true },
      },
      async ({ sessionId, path }) =>
        run('list_files', () => {
          this.session(sessionId);
          return this.ssh.list(sessionId, path);
        }),
    );
    server.registerTool(
      'monitor',
      {
        description: 'Read Linux resource metrics on an authorized MCP connection.',
        inputSchema: { sessionId: z.string().uuid() },
        annotations: { readOnlyHint: true },
      },
      async ({ sessionId }) =>
        run('monitor', () => {
          this.session(sessionId);
          return this.ssh.monitor(sessionId);
        }),
    );
    if (this.store.mcpSettings().allowCommands)
      server.registerTool(
        'execute_command',
        {
          description:
            'Execute a shell command only after the user approves it in CShell. Output is limited to 256 KiB and duration to 30 seconds.',
          inputSchema: { sessionId: z.string().uuid(), command: z.string().min(1).max(8192) },
          annotations: { destructiveHint: true },
        },
        async ({ sessionId, command }) =>
          run('execute_command', async () => {
            this.session(sessionId);
            const profileId = this.connections.get(sessionId)!;
            if (!(await this.confirm(this.allowed(profileId).name, command)))
              throw new Error('User declined the command');
            if (!this.store.mcpSettings().allowCommands)
              throw new Error('Command permission revoked');
            const session = this.session(sessionId);
            return new Promise((resolve, reject) => {
              let channel: import('ssh2').ClientChannel | undefined,
                finished = false;
              const chunks: Buffer[] = [];
              let size = 0;
              const finish = (error?: Error, code?: number | null) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                channel?.destroy();
                error
                  ? reject(error)
                  : resolve({ exitCode: code, output: Buffer.concat(chunks).toString('utf8') });
              };
              const timer = setTimeout(
                () => finish(new Error('Command timed out after 30 seconds')),
                30000,
              );
              session.client.exec(command, (error, stream) => {
                if (finished) {
                  stream?.destroy();
                  return;
                }
                if (error) {
                  finish(error);
                  return;
                }
                channel = stream;
                const data = (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > 262144) finish(new Error('Output exceeds 256 KiB'));
                  else chunks.push(Buffer.from(chunk));
                };
                stream.on('data', data);
                stream.stderr.on('data', data);
                stream.on('error', finish);
                stream.on('close', (code: number | null) => finish(undefined, code));
              });
            });
          }),
      );
    return server;
  }
}
