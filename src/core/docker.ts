import { Agent, request } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { SshService } from './ssh';
import type {
  DockerAction,
  DockerDetails,
  DockerResult,
  DockerSnapshot,
  DockerStats,
  PortMapping,
} from '../shared/docker';

type Json = Record<string, any>;
export function portBindings(ports: PortMapping[]) {
  const result: Record<string, { HostIp: string; HostPort: string }[]> = {};
  for (const port of ports)
    (result[`${port.containerPort}/${port.protocol}`] ??= []).push({
      HostIp: port.host,
      HostPort: String(port.hostPort),
    });
  return result;
}
export function parseDockerStats(value: Json): DockerStats {
  const cpu = value.cpu_stats?.cpu_usage?.total_usage - value.precpu_stats?.cpu_usage?.total_usage;
  const system = value.cpu_stats?.system_cpu_usage - value.precpu_stats?.system_cpu_usage;
  const cores =
    value.cpu_stats?.online_cpus || value.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  const memory = value.memory_stats || {};
  const cache = memory.stats?.total_inactive_file ?? memory.stats?.inactive_file ?? 0;
  const networks = Object.values(value.networks || {}) as Json[];
  return {
    cpu: Number.isFinite(cpu) && system > 0 && cpu >= 0 ? (cpu / system) * cores * 100 : null,
    memory: Math.max(0, (memory.usage || 0) - cache),
    memoryLimit: memory.limit || 0,
    rx: networks.reduce((n, v) => n + (v.rx_bytes || 0), 0),
    tx: networks.reduce((n, v) => n + (v.tx_bytes || 0), 0),
    pids: value.pids_stats?.current ?? null,
  };
}

/** Docker Engine HTTP stays inside the authenticated SSH connection. No exposed TCP daemon. */
export class DockerService {
  private mutations = new Set<string>();
  private paths = new Map<string, string>();
  constructor(
    private ssh: SshService,
    private socket: () => string,
  ) {}
  async api(
    session: string,
    method: string,
    path: string,
    body?: unknown,
    timeout = 20000,
  ): Promise<any> {
    const client = this.ssh.get(session).client;
    const socketPath = this.paths.get(session) || this.socket();
    const agent = new Agent({ keepAlive: false });
    let cancelled = false;
    agent.createConnection = (_options, callback) => {
      client.openssh_forwardOutStreamLocal(socketPath, (error, stream) => {
        if (cancelled) {
          stream?.destroy();
          return;
        }
        callback!(error || null, stream as unknown as Socket);
      });
      return undefined as unknown as Socket;
    };
    const data = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: 'docker',
          path,
          method,
          agent,
          headers: {
            Connection: 'close',
            ...(data
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
              : {}),
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          let length = 0;
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 8_000_000) req.destroy(new Error('Docker response limit exceeded'));
            else parts.push(chunk);
          });
          res.on('error', reject);
          res.on('aborted', () => reject(new Error('Docker response interrupted')));
          res.on('end', () => {
            try {
              const raw = Buffer.concat(parts).toString('utf8');
              const value = raw ? JSON.parse(raw) : {};
              if ((res.statusCode || 500) >= 400)
                throw new Error(value.message || `Docker HTTP ${res.statusCode}`);
              resolve(value);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error('Docker request timed out; refresh to check the result')),
        timeout,
      );
      req.on('error', reject);
      req.on('close', () => {
        clearTimeout(timer);
        cancelled = true;
        agent.destroy();
      });
      req.end(data);
    });
  }
  async snapshot(session: string): Promise<DockerSnapshot> {
    const [containers, images] = await Promise.all([
      this.api(session, 'GET', '/containers/json?all=true'),
      this.api(session, 'GET', '/images/json'),
    ]);
    if (
      !Array.isArray(containers) ||
      !Array.isArray(images) ||
      containers.length > 10000 ||
      images.length > 10000
    )
      throw new Error('Invalid Docker inventory');
    const imageNames = new Map(images.map((image) => [image.Id, image.RepoTags?.[0]]));
    return {
      containers: containers.map((c) => ({
        id: c.Id,
        name: c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12),
        image: imageNames.get(c.Image) || c.Image,
        state: c.State,
        status: c.Status,
        ports: (c.Ports || [])
          .map((p: Json) =>
            p.PublicPort
              ? `${p.IP || '0.0.0.0'}:${p.PublicPort} → ${p.PrivatePort}/${p.Type}`
              : `${p.PrivatePort}/${p.Type}`,
          )
          .join(', '),
        project: c.Labels?.['com.docker.compose.project'] || '',
      })),
      images: images.map((i) => ({
        id: i.Id,
        tags: i.RepoTags || [],
        size: i.Size,
        created: i.Created,
      })),
    };
  }
  async stats(session: string, id: string) {
    return parseDockerStats(await this.api(session, 'GET', `/containers/${id}/stats?stream=false`));
  }
  async details(session: string, id: string): Promise<DockerDetails> {
    const value = await this.api(session, 'GET', `/containers/${id}/json`);
    const ports: PortMapping[] = [];
    for (const [key, bindings] of Object.entries(value.HostConfig?.PortBindings || {})) {
      const [port, protocol] = key.split('/');
      for (const binding of (bindings || []) as Json[])
        ports.push({
          host: binding.HostIp || '0.0.0.0',
          hostPort: Number(binding.HostPort),
          containerPort: Number(port),
          protocol: protocol as 'tcp' | 'udp',
        });
    }
    return {
      ports,
      restart: value.HostConfig?.RestartPolicy?.Name || 'no',
      managed: !!(
        value.Config?.Labels?.['com.docker.compose.project'] ||
        value.Config?.Labels?.['com.docker.swarm.service.id']
      ),
    };
  }
  async action(session: string, action: DockerAction): Promise<DockerResult> {
    if (this.mutations.has(session)) throw new Error('Docker operation already running');
    this.paths.set(session, this.socket());
    this.mutations.add(session);
    try {
      if (action.type === 'ports') return await this.recreate(session, action.id, action.ports);
      if (action.type === 'create') {
        const bindings = portBindings(action.ports);
        const created = await this.api(
          session,
          'POST',
          `/containers/create?name=${encodeURIComponent(action.name)}`,
          {
            Image: action.image,
            ExposedPorts: Object.fromEntries(Object.keys(bindings).map((k) => [k, {}])),
            HostConfig: { PortBindings: bindings, RestartPolicy: { Name: action.restart } },
          },
        );
        if (action.start) {
          try {
            await this.api(session, 'POST', `/containers/${created.Id}/start`);
          } catch (e) {
            throw new Error(
              `Container created (${created.Id.slice(0, 12)}), but start failed: ${(e as Error).message}`,
            );
          }
        }
        return { id: created.Id };
      }
      if (action.type === 'removeImage') {
        await this.api(session, 'DELETE', `/images/${encodeURIComponent(action.id)}?force=false`);
        return {};
      }
      if (action.type === 'remove') {
        // Never force-delete running containers or remove volumes implicitly.
        await this.api(session, 'DELETE', `/containers/${action.id}?force=false&v=false`);
        return {};
      }
      await this.api(
        session,
        'POST',
        `/containers/${action.id}/${action.type}${action.type === 'stop' || action.type === 'restart' ? '?t=10' : ''}`,
        undefined,
        45000,
      );
      return {};
    } finally {
      this.mutations.delete(session);
      this.paths.delete(session);
    }
  }
  private async recreate(session: string, id: string, ports: PortMapping[]): Promise<DockerResult> {
    const original = await this.api(session, 'GET', `/containers/${id}/json`);
    const config = original.Config,
      host = original.HostConfig;
    if (!config || !host) throw new Error('Invalid container configuration');
    if (
      config.Labels?.['com.docker.compose.project'] ||
      config.Labels?.['com.docker.swarm.service.id']
    )
      throw new Error('Managed container: change ports in its Compose / Swarm definition');
    if (
      host.AutoRemove ||
      original.State?.Paused ||
      original.State?.Restarting ||
      !['running', 'exited', 'created'].includes(original.State?.Status)
    )
      throw new Error('Container state does not support safe recreation');
    if (
      host.NetworkMode === 'host' ||
      host.NetworkMode === 'none' ||
      host.NetworkMode?.startsWith('container:')
    )
      throw new Error('This network mode does not support published ports');
    const name = original.Name.replace(/^\//, ''),
      suffix = randomUUID().slice(0, 8);
    const backup = `${name}-cshell-backup-${suffix}`;
    // Snapshot the writable layer; mounted volumes stay mounted and are never deleted.
    let snapshot: { Id: string } | undefined;
    const bindings = portBindings(ports);
    const endpoints: Json = {};
    for (const [network, endpoint] of Object.entries(original.NetworkSettings?.Networks || {})) {
      const e = endpoint as Json;
      endpoints[network] = {
        ...(e.IPAMConfig ? { IPAMConfig: e.IPAMConfig } : {}),
        ...(e.Aliases
          ? {
              Aliases: e.Aliases.filter(
                (alias: string) => alias !== id.slice(0, 12) && alias !== id,
              ),
            }
          : {}),
        ...(e.DriverOpts ? { DriverOpts: e.DriverOpts } : {}),
      };
    }
    const mounts = [...(host.Mounts || [])];
    const boundTargets = new Set([
      ...(host.Binds || []).map((b: string) => b.split(':')[1]),
      ...mounts.map((m: Json) => m.Target),
    ]);
    for (const m of original.Mounts || [])
      if (m.Type === 'volume' && !boundTargets.has(m.Destination))
        mounts.push({ Type: 'volume', Source: m.Name, Target: m.Destination, ReadOnly: !m.RW });
    let renamed = false,
      stopped = false,
      changedPolicy = false,
      newId = '';
    try {
      if (original.State.Running) {
        stopped = true;
        await this.api(session, 'POST', `/containers/${id}/stop?t=10`, undefined, 45000);
      }
      snapshot = await this.api(
        session,
        'POST',
        `/commit?container=${id}&pause=true&repo=cshell-backup&tag=${suffix}`,
        config,
        120000,
      );
      renamed = true;
      await this.api(
        session,
        'POST',
        `/containers/${id}/rename?name=${encodeURIComponent(backup)}`,
      );
      changedPolicy = true;
      await this.api(session, 'POST', `/containers/${id}/update`, {
        RestartPolicy: { Name: 'no' },
      });
      const next = await this.api(
        session,
        'POST',
        `/containers/create?name=${encodeURIComponent(name)}`,
        {
          ...config,
          Image: snapshot!.Id,
          ExposedPorts: {
            ...config.ExposedPorts,
            ...Object.fromEntries(Object.keys(bindings).map((k) => [k, {}])),
          },
          HostConfig: { ...host, Mounts: mounts, PortBindings: bindings, PublishAllPorts: false },
          NetworkingConfig: { EndpointsConfig: endpoints },
        },
      );
      newId = next.Id;
      if (original.State.Running) await this.api(session, 'POST', `/containers/${newId}/start`);
      return { id: newId, backup, snapshot: snapshot!.Id };
    } catch (error) {
      const recovery: string[] = [];
      const restore = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (e) {
          recovery.push((e as Error).message);
        }
      };
      if (newId)
        await restore(() => this.api(session, 'DELETE', `/containers/${newId}?force=true&v=false`));
      if (renamed)
        await restore(() =>
          this.api(session, 'POST', `/containers/${id}/rename?name=${encodeURIComponent(name)}`),
        );
      if (changedPolicy)
        await restore(() =>
          this.api(session, 'POST', `/containers/${id}/update`, {
            RestartPolicy: host.RestartPolicy,
          }),
        );
      if (stopped) await restore(() => this.api(session, 'POST', `/containers/${id}/start`));
      throw new Error(
        `${(error as Error).message}. ${recovery.length ? 'Recovery incomplete: ' + recovery.join('; ') : 'Original container restored'}. Snapshot: ${snapshot?.Id || 'unavailable'}`,
      );
    }
  }
}
