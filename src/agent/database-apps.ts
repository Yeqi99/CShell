import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { databaseRecipes, type DatabaseApp } from '../shared/database-apps';
const execute = promisify(execFile);

async function docker(args: string[], signal: AbortSignal, timeout = 15000, input?: string) {
  const job = execute('docker', args, { signal, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  job.child.stdin?.on('error', () => {});
  job.child.stdin?.end(input);
  return (await job).stdout.trim();
}

export async function databaseHost(signal: AbortSignal) {
  const host = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ? process.env.DOCKER_HOST :
    await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : [])], signal);
  if (!/^unix:\/\/\/[^\n]+$|^npipe:\/\/\/\/\.\/pipe\/[\w.-]+$/.test(host)) throw Error('请在目标机器选择本机 Docker 引擎');
  const args = ['--host', host];
  const [platform, version] = await Promise.all([
    docker([...args, 'info', '--format', '{{.OSType}}/{{.Architecture}}'], signal),
    docker([...args, 'compose', 'version', '--short'], signal),
  ]);
  if (!/^linux\/(x86_64|amd64|aarch64|arm64)$/.test(platform)) throw Error('需要 x64 或 ARM64 的 Linux 容器引擎');
  const [major, minor, patch] = version.replace(/^v/, '').split('.').map(Number);
  if (!(major > 2 || major === 2 && (minor > 23 || minor === 23 && patch >= 1))) throw Error('需要 Docker Compose 2.23.1 或更高版本');
  return host;
}

export function databaseCompose(app: DatabaseApp, port: number, image: string) {
  const recipe = databaseRecipes[app];
  const base = { image, restart: 'unless-stopped', ports: [`127.0.0.1:${port}:${recipe.port}`] };
  const service = app === 'mysql' ? {
    environment: { MYSQL_ROOT_PASSWORD_FILE: '/credentials/root' },
    entrypoint: ['/bin/sh','-ec','umask 077; if [ ! -s /credentials/root ]; then cat /proc/sys/kernel/random/uuid > /credentials/new && mv /credentials/new /credentials/root; fi; exec docker-entrypoint.sh mysqld'],
    volumes: ['data:/var/lib/mysql','credentials:/credentials'],
    healthcheck: { test: ['CMD','mysqladmin','ping','-h','127.0.0.1'] },
  } : app === 'redis' ? {
    command: ['redis-server','--appendonly','yes'], volumes: ['data:/data'],
    healthcheck: { test: ['CMD','redis-cli','ping'] },
  } : {
    command: ['milvus','run','standalone'], volumes: ['data:/var/lib/milvus'],
    configs: [{source:'etcd',target:'/milvus/configs/embedEtcd.yaml'}],
    environment: { ETCD_USE_EMBED:'true', ETCD_DATA_DIR:'/var/lib/milvus/etcd', ETCD_CONFIG_PATH:'/milvus/configs/embedEtcd.yaml', COMMON_STORAGETYPE:'local', DEPLOY_MODE:'STANDALONE' },
    healthcheck: { test:['CMD','curl','-fsS','http://localhost:9091/healthz'] },
  };
  return JSON.stringify({
    services: { database: { ...base, ...service, healthcheck: {...service.healthcheck, interval:'5s', timeout:'5s', retries:30, start_period:'90s'} } },
    volumes: app === 'mysql' ? { data:{}, credentials:{} } : { data:{} },
    ...(app === 'milvus' ? {configs:{etcd:{content:'listen-client-urls: http://0.0.0.0:2379\nadvertise-client-urls: http://127.0.0.1:2379\nquota-backend-bytes: 4294967296\nauto-compaction-mode: revision\nauto-compaction-retention: "1000"\n'}}} : {}),
  });
}

export async function databasePort(host: string, project: string, app: DatabaseApp, signal: AbortSignal) {
  const args = ['--host',host];
  const id = await docker([...args,'ps','-aq','--filter',`label=com.docker.compose.project=${project}`,'--filter','label=com.docker.compose.service=database'], signal);
  if (!id) return undefined;
  if (!/^[a-f0-9]+$/.test(id)) throw Error('发现多个数据库容器，请先检查 Docker 项目');
  const mappings = JSON.parse(await docker([...args,'inspect','--format','{{json .HostConfig.PortBindings}}',id],signal));
  return Number(mappings?.[`${databaseRecipes[app].port}/tcp`]?.[0]?.HostPort) || undefined;
}

export async function installDatabase(host: string, project: string, app: DatabaseApp, port: number, signal: AbortSignal, log: (s:string)=>void) {
  if (await databaseHost(signal) !== host) throw Error('目标 Docker 引擎已改变，请重新检查安装计划');
  if (await databasePort(host, project, app, signal) !== port) await new Promise<void>((resolve,reject)=>{
    const server=createServer();
    server.once('error',()=>reject(Error(`本机端口 ${port} 无法监听，请更换端口`)));
    server.listen(port,'127.0.0.1',()=>server.close(()=>resolve()));
  });
  const {repository,digest}=databaseRecipes[app];
  const sources=[`docker.m.daocloud.io/${repository}@${digest}`,`docker.io/${repository}@${digest}`];
  const args=['--host',host];
  let image: string | undefined;
  for (const ref of sources) {
    try { await docker([...args,'image','inspect',ref,'--format','{{.Id}}'],signal); image=ref; break; }
    catch { signal.throwIfAborted(); }
  }
  if (!image) for (const ref of sources) {
    log('正在从 '+ref.split('/')[0]+' 拉取并校验镜像');
    try { await docker([...args,'pull','--quiet',ref],signal,ref===sources[0]?240000:480000); image=ref; break; }
    catch (err) { signal.throwIfAborted(); log(String(err).slice(-600)); }
  }
  if (!image) throw Error('镜像下载失败，请检查目标机器的 Docker 镜像加速或代理设置后重试');
  log('启动数据库并等待健康检查');
  await docker([...args,'compose','-p',project,'-f','-','up','-d','--wait','--wait-timeout','240','--pull','never'], signal,260000,databaseCompose(app,port,image));
  log(`已就绪：127.0.0.1:${port}`);
  if(app==='mysql') log(`在目标机器查看 root 密码：docker exec ${project}-database-1 cat /credentials/root`);
}
