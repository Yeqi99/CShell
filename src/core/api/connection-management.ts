import { randomUUID, createHash } from 'node:crypto';
import ssh2 from 'ssh2';
const { Client } = ssh2;
import { z } from 'zod';
import { profileSchema, type Profile } from '../../shared/contracts';
import { Store } from '../store';

const secretSchema = z
  .object({
    password: z.string().max(16000).optional(),
    privateKey: z.string().max(262144).optional(),
    passphrase: z.string().max(16000).optional(),
  })
  .strict();
const editable = z.object(profileSchema.shape).omit({ id: true }).strict().partial();
export const connectionManagementSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z
    .object({
      action: z.literal('create'),
      profile: z.object(profileSchema.shape).omit({ id: true }).strict(),
      secret: secretSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      id: z.uuid(),
      revision: z.string().length(64),
      patch: editable,
    })
    .strict(),
  z
    .object({
      action: z.literal('credentials'),
      id: z.uuid(),
      revision: z.string().length(64),
      secret: secretSchema.nullable(),
    })
    .strict(),
  z.object({ action: z.literal('probe'), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('accept'),
      challenge: z.uuid(),
      fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
    })
    .strict(),
]);
export type ConnectionManagementContext = {
  owner: string;
  accountKey: string;
  authorize: (action: string, profile?: Profile) => void;
  signal?: AbortSignal;
  review?: (action: string, profile: Profile, detail: Record<string, unknown>) => Promise<void>;
};
export function sshEndpoint(profile: Profile) {
  return `${profile.host.toLowerCase()}:${profile.port}`;
}
/** Captures a key then rejects the handshake. Never authenticates or starts a shell. */
export function probeSshHost(
  profile: Profile,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  if (!['ssh', 'sftp'].includes(profile.protocol ?? 'ssh'))
    return Promise.reject(new Error('SSH_PROFILE_REQUIRED'));
  if (profile.jumpProfileId)
    return Promise.reject(new Error('JUMP_PROBE_REQUIRES_EXPLICIT_TRANSPORT'));
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let observed: string | undefined;
    const finish = (error?: Error, key?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      client.destroy();
      if (error) reject(error);
      else resolve(key!);
    };
    const abort = () => finish(new Error('CANCELLED'));
    const timer = setTimeout(
      () => finish(new Error('HOST_PROBE_TIMEOUT')),
      Math.max(100, Math.min(10000, options.timeoutMs ?? 5000)),
    );
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    client
      .on('error', () =>
        observed ? finish(undefined, observed) : finish(new Error('HOST_PROBE_FAILED')),
      )
      .on('close', () => finish(new Error('HOST_PROBE_CLOSED')));
    try {
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        readyTimeout: 10000,
        hostVerifier: (key: Buffer) => {
          const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          observed = fingerprint;
          queueMicrotask(() => finish(undefined, fingerprint));
          return false;
        },
        authHandler: () => false,
      });
    } catch {
      finish(new Error('HOST_PROBE_FAILED'));
    }
  });
}
export type PairedEndpointAccess = {
  get(id:string): {host:string;port:number}|undefined;
  update(id:string,endpoint:{host:string;port:number}):Promise<void>;
};
export class ConnectionManagement {
  private challenges = new Map<
    string,
    {
      owner: string;
      account: string;
      id: string;
      revision: string;
      fingerprint: string;
      expires: number;
      previous?: string;
    }
  >();
  constructor(
    private store: Store,
    private account: () => string,
    private probe: typeof probeSshHost = probeSshHost,
    private paired?:PairedEndpointAccess,
  ) {}
  private result(profile: Profile) {
    return {
      profile,
      revision: this.store.connectionRevision(profile.id),
      credentialConfigured: this.store.credentialConfigured(profile.id),
    };
  }
  async call(raw: unknown, context: ConnectionManagementContext) {
    const input = connectionManagementSchema.parse(raw);
    const guard = (profile?: Profile) => {
      if (context.signal?.aborted) throw new Error('CANCELLED');
      if (context.accountKey !== this.account()) throw new Error('ACCOUNT_CHANGED');
      context.authorize(input.action, profile);
    };
    guard();
    if (input.action === 'list')
      return {
        connections: this.store
          .snapshot()
          .profiles.filter((p) => {
            try {
              guard(p);
              return true;
            } catch {
              return false;
            }
          })
          .map((p) => this.result(p)),
      };
    if (input.action === 'accept') {
      const entry = this.challenges.get(input.challenge);

      if (
        !entry ||
        entry.expires < Date.now() ||
        entry.owner !== context.owner ||
        entry.account !== context.accountKey ||
        entry.fingerprint !== input.fingerprint
      )
        throw new Error('HOST_CHALLENGE_INVALID');
      this.challenges.delete(input.challenge);
      const profile = this.store.profile(entry.id);
      guard(profile);
      // Do not silently replace an existing, different trust pin.
      if (entry.previous && entry.previous !== entry.fingerprint)
        throw new Error('HOST_KEY_CHANGED');
      await context.review?.(input.action, profile, {
        profileId: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        fingerprint: entry.fingerprint,
      });
      const acceptGuard = () => {
        guard(profile);
        if (entry.expires < Date.now()) throw new Error('HOST_CHALLENGE_INVALID');
      };
      acceptGuard();
      await this.store.saveConnection(profile, entry.revision, acceptGuard, undefined, {
        endpoint: sshEndpoint(profile),
        fingerprint: entry.fingerprint,
        previous: entry.previous,
      });
      return { ...this.result(profile), trusted: true };
    }
    const profile =
      input.action === 'create'
        ? profileSchema.parse({ ...input.profile, id: randomUUID() })
        : this.store.profile(input.id);
    guard(profile);
    const pairedUpdate=profile.protocol==='client'&&input.action==='update'&&this.paired?.get(profile.id);
    if(profile.protocol==='client'&&pairedUpdate&&input.action==='update'&&Object.keys(input.patch).some(k=>!['name','group','favorite','host','port'].includes(k)))throw Error('PAIRED_CONNECTION_PATCH_UNSUPPORTED');
    if (!pairedUpdate&&!['ssh', 'sftp', 'ftp', 'ftps', 'rdp'].includes(profile.protocol ?? 'ssh'))
      throw new Error('USE_PROTOCOL_PAIRING_WORKFLOW');
    if (input.action === 'probe') {
      const revision = this.store.connectionRevision(profile.id),
        previous = this.store.host(sshEndpoint(profile));
      await context.review?.(input.action, profile, {
        profileId: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
      });
      guard(profile);
      if (this.store.connectionRevision(profile.id) !== revision)
        throw new Error('CONNECTION_CHANGED');
      const fingerprint = await this.probe(profile, { signal: context.signal });
      guard(profile);
      if (this.store.connectionRevision(profile.id) !== revision)
        throw new Error('CONNECTION_CHANGED');
      for (const [key, value] of this.challenges)
        if (value.expires < Date.now()) this.challenges.delete(key);
      if (this.challenges.size >= 64) throw new Error('TOO_MANY_HOST_CHALLENGES');
      const challenge = randomUUID();
      this.challenges.set(challenge, {
        owner: context.owner,
        account: context.accountKey,
        id: profile.id,
        revision,
        fingerprint,
        previous,
        expires: Date.now() + 60000,
      });
      return {
        id: profile.id,
        endpoint: sshEndpoint(profile),
        fingerprint,
        challenge,
        expiresInSeconds: 60,
        trusted: previous === fingerprint,
        changed: Boolean(previous && previous !== fingerprint),
      };
    }
    const next =
      input.action === 'update' ? profileSchema.parse({ ...profile, ...input.patch }) : profile;
    if ((next.protocol ?? 'ssh') !== (profile.protocol ?? 'ssh'))
      throw new Error('PROTOCOL_CHANGE_REQUIRES_NEW_CONNECTION');
    guard(next);
    const secret =
      input.action === 'create' || input.action === 'credentials' ? input.secret : undefined;
    if (
      secret &&
      ((next.auth === 'password' &&
        (secret.privateKey !== undefined || secret.passphrase !== undefined)) ||
        (next.auth === 'key' && secret.password !== undefined))
    )
      throw new Error('CREDENTIAL_AUTH_MISMATCH');
    await context.review?.(input.action, profile, {
      profileId: next.id,
      name: next.name,
      host: next.host,
      port: next.port,
      username: next.username,
      protocol: next.protocol ?? 'ssh',
      group: next.group,
      auth: next.auth,
      credentialsIncluded: secret !== undefined,
      credentialsCleared: secret === null,
    });
    guard(profile);
    guard(next);
    const previous=pairedUpdate?this.paired!.get(profile.id):undefined;
    if(previous){
      if(this.store.connectionRevision(profile.id)!==(input as {revision:string}).revision)throw Error('CONNECTION_CHANGED');
      await this.paired!.update(profile.id,{host:next.host,port:next.port});
    }
    try {await this.store.saveConnection(
      next,
      input.action === 'create' ? this.store.connectionRevision(profile.id) : input.revision,
      () => {
        guard(profile);
        guard(next);
      },
      secret,
    );
    }catch(error){
      const current=this.paired?.get(profile.id);
      if(previous&&current?.host===next.host&&current.port===next.port)await this.paired!.update(profile.id,previous).catch(()=>{});
      throw error;
    }
    return this.result(next);
  }
}
