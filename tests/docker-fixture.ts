import { createServer } from 'node:http';
import type { Connection } from 'ssh2';

export function dockerFixture() {
  const id = 'a'.repeat(64),
    stoppedId = 'b'.repeat(64),
    image = 'sha256:' + 'c'.repeat(64);
  const calls: { method: string; path: string; body: any }[] = [];
  const containers = new Map<string, any>();
  let count = 10,
    failStart = false;
  const make = (id: string, name: string, running: boolean) => ({
    Id: id,
    Name: '/' + name,
    State: { Status: running ? 'running' : 'exited', Running: running, Paused: false },
    Config: {
      Image: 'nginx:latest',
      Env: ['EXAMPLE=retained'],
      Labels: {},
      Cmd: ['nginx', '-g', 'daemon off;'],
    },
    HostConfig: {
      PortBindings: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }] },
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: 'bridge',
      Binds: ['/srv/site:/usr/share/nginx/html:ro'],
    },
    Mounts: [
      { Type: 'bind', Source: '/srv/site', Destination: '/usr/share/nginx/html', RW: false },
      { Type: 'volume', Name: 'retained-data', Destination: '/var/cache', RW: true },
    ],
    NetworkSettings: { Networks: { bridge: {} } },
  });
  containers.set(id, make(id, 'web-app', true));
  containers.set(stoppedId, make(stoppedId, 'worker', false));
  const images = new Map<string, any>([
    [image, { Id: image, RepoTags: ['nginx:latest'], Size: 100_000_000, Created: 1700000000 }],
  ]);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(req.url!, 'http://docker');
    calls.push({ method: req.method!, path: req.url!, body });
    const send = (status: number, value: unknown = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/containers/json')
      return send(
        200,
        [...containers.values()].map((c) => ({
          Id: c.Id,
          Names: [c.Name],
          Image: c.Config.Image,
          State: c.State.Status,
          Status: c.State.Running ? 'Up 2 minutes' : 'Exited (0)',
          Labels: c.Config.Labels,
          Ports: Object.entries(c.HostConfig.PortBindings || {}).flatMap(([key, values]) =>
            (values as any[]).map((p) => ({
              IP: p.HostIp,
              PublicPort: Number(p.HostPort),
              PrivatePort: Number(key.split('/')[0]),
              Type: key.split('/')[1],
            })),
          ),
        })),
      );
    if (url.pathname === '/images/json') return send(200, [...images.values()]);
    if (url.pathname.startsWith('/images/') && req.method === 'DELETE') {
      images.delete(decodeURIComponent(url.pathname.slice(8)));
      return send(200, []);
    }
    if (url.pathname === '/commit') {
      const next = 'sha256:' + (++count).toString(16).padStart(64, '0');
      images.set(next, {
        Id: next,
        RepoTags: ['cshell-backup:test'],
        Size: 100,
        Created: 1700000000,
      });
      return send(201, { Id: next });
    }
    if (url.pathname === '/containers/create') {
      const next = (++count).toString(16).padStart(64, '0');
      const c = make(next, url.searchParams.get('name')!, false);
      const config = { ...body };
      delete config.HostConfig;
      delete config.NetworkingConfig;
      c.Config = config;
      c.HostConfig = body.HostConfig;
      containers.set(next, c);
      return send(201, { Id: next });
    }
    const match = url.pathname.match(/^\/containers\/([a-f0-9]+)(?:\/(\w+))?$/);
    if (!match || !containers.has(match[1])) return send(404, { message: 'No such container' });
    const c = containers.get(match[1]);
    if (match[2] === 'json') return send(200, c);
    if (match[2] === 'stats')
      return send(200, {
        cpu_stats: { cpu_usage: { total_usage: 150 }, system_cpu_usage: 1000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
        memory_stats: { usage: 52428800, limit: 1073741824, stats: { inactive_file: 10485760 } },
        networks: { eth0: { rx_bytes: 1048576, tx_bytes: 2097152 } },
        pids_stats: { current: 6 },
      });
    if (match[2] === 'start' && failStart) {
      failStart = false;
      return send(500, { message: 'Port is already allocated' });
    }
    if (['start', 'restart', 'unpause'].includes(match[2])) {
      c.State = { Status: 'running', Running: true, Paused: false };
      return send(200);
    }
    if (match[2] === 'stop') {
      c.State = { Status: 'exited', Running: false, Paused: false };
      return send(200);
    }
    if (match[2] === 'pause') {
      c.State = { Status: 'paused', Running: true, Paused: true };
      return send(200);
    }
    if (match[2] === 'rename') {
      c.Name = '/' + url.searchParams.get('name');
      return send(200);
    }
    if (match[2] === 'update') {
      c.HostConfig.RestartPolicy = body.RestartPolicy;
      return send(200);
    }
    if (req.method === 'DELETE') {
      if (c.State.Running && url.searchParams.get('force') !== 'true')
        return send(409, { message: 'Container is running' });
      containers.delete(c.Id);
      return send(200);
    }
    send(404, { message: 'Unsupported fixture endpoint' });
  });
  return {
    id,
    stoppedId,
    image,
    calls,
    containers,
    failNextStart: () => {
      failStart = true;
    },
    attach: (client: Connection) =>
      client.on('openssh.streamlocal', (accept, reject, info) => {
        if (info.socketPath !== '/var/run/docker.sock') return reject();
        const channel = accept();
        server.emit('connection', channel);
      }),
  };
}
