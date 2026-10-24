import { randomUUID } from 'node:crypto';
import { readCustomExtension, installCustomExtension } from '../core/custom-extensions';
import type { ConnectionManager } from '../core/connections/manager';
import { dialog, shell, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { httpsText } from '../core/plugins';
import { applications } from '../shared/plugins';
import { applicationCatalogUrl } from '../shared/market';
import {
  pluginId,
  pluginEnabled,
  remoteExecutable,
  environmentActionSchema,
} from '../shared/plugins';
import type { Store } from '../core/store';
import type { SshService } from '../core/ssh';
import { PythonFiles } from '../core/python-files';
import { createExtensionServices, type ExtensionServices } from '../core/api/extensions';
export function registerExtensionHandlers(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  window: BrowserWindow,
  store: Store,
  ssh: SshService,
  connections: ConnectionManager,
  beforeDisable?: (id: string) => Promise<void>,
  services?: ExtensionServices,
) {
  const { jobs, environments, apps, files, plugins } =
    services ?? createExtensionServices(ssh, store);
  const connected = (id: unknown) => {
    const value = z.string().uuid().parse(id);
    ssh.get(value);
    return value;
  };
  const textFiles = new PythonFiles(ssh, true);
  handle('text:read', (id, path) => textFiles.read(connected(id), z.string().max(4096).parse(path)));
  handle('text:save', (id, path, code, revision) => textFiles.save(connected(id), z.string().max(4096).parse(path), code, revision));
  handle('text:environments', (id, path) => {
    requirePlugin('python');
    return environments.inspectForFile(connected(id), z.string().max(4096).parse(path));
  });
  const requirePlugin = (provider: 'conda' | 'python') => {
    if (!pluginEnabled(store.plugins(), provider))
      throw new Error(`${provider} plugin is not enabled`);
  };
  handle('applications:catalog', async () => {
    const catalog = z
      .object({
        protocol: z.literal(1),
        applications: z
          .array(
            z
              .object({
                id: z.string(),
                name: z.string().max(80),
                description: z.string().max(300),
                recipe: z.string(),
                platforms: z.array(z.literal('linux')),
              })
              .strict(),
          )
          .max(100),
      })
      .strict()
      .parse(JSON.parse(await httpsText(applicationCatalogUrl)));
    if (
      new Set(catalog.applications.map((a) => a.id)).size !== catalog.applications.length ||
      catalog.applications.some(
        (a) => !applications.some((b) => b.id === a.id) || a.recipe !== `cshell:${a.id}:1`,
      )
    )
      throw new Error('Unsupported application recipe; update CShell');
    return catalog.applications.map(({ id, name, description }) => ({ id, name, description }));
  });
  handle('python:read', (id, path) => {
    requirePlugin('python');
    return files.read(connected(id), z.string().max(4096).parse(path));
  });
  handle('python:save', (id, path, code, revision) => {
    requirePlugin('python');
    return files.save(connected(id), path, code, revision);
  });
  const pendingImports=new Map<string,{pack:Awaited<ReturnType<typeof readCustomExtension>>;expires:number}>();
  handle('plugins:import-preview',async (path?:unknown)=>{
    let selected:string;
    if(path===undefined){const result=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'CShell 自定义扩展',extensions:['cshellext']}]});if(result.canceled)return null;selected=result.filePaths[0];}
    else selected=z.string().min(1).max(32767).parse(path);
    const pack=await readCustomExtension(selected),token=randomUUID();
    pendingImports.clear();pendingImports.set(token,{pack,expires:Date.now()+300000});
    setTimeout(()=>pendingImports.delete(token),300000).unref();
    return {token,manifest:pack.value.manifest,trusted:pack.trusted,bytes:pack.bytes};
  });
  handle('plugins:import-apply',async (input:unknown)=>{
    const token=z.string().uuid().parse(input),pending=pendingImports.get(token);pendingImports.delete(token);
    if(!pending||pending.expires<Date.now())throw new Error('导入预览已过期，请重新选择扩展包');
    const existing=store.plugins().find(p=>p.manifest.id===pending.pack.value.manifest.id);
    if(existing?.enabled)throw new Error('请先停用此扩展，再导入更新，已有配置会保留');
    const manifest=await installCustomExtension(pending.pack);
    await store.setPlugins([...store.plugins().filter(p=>p.manifest.id!==manifest.id),{manifest,enabled:false,source:'custom:'+pending.pack.sha256}]);
  });
  handle('plugins:list', () => store.plugins());
  handle('plugins:install', (id) => plugins.install(pluginId.parse(id)));
  handle('plugins:toggle', async (id, enabled) => {
    pluginId.parse(id);
    z.boolean().parse(enabled);
    if (!enabled) await beforeDisable?.(id);
    if (!enabled && id === 'cshell.conda') environments.stopAllJupyter();
    return plugins.toggle(id, enabled);
  });
  handle('plugins:remove', async (id) => {
    pluginId.parse(id);
    await beforeDisable?.(id);
    if (id === 'cshell.conda') environments.stopAllJupyter();
    return plugins.remove(id);
  });
  handle('plugins:source', () => store.pluginSource());
  handle('plugins:catalog', (url) => plugins.catalog(z.string().max(2048).parse(url)));
  handle('plugins:download', (entry) => plugins.download(entry));
  handle('environments:list', (id) => environments.inspect(connected(id)));
  handle('environments:packages', (id, python) => {
    requirePlugin('conda');
    return environments.packages(connected(id), remoteExecutable.parse(python));
  });
  handle('environments:action', async (id, input) => {
    requirePlugin('conda');
    const sessionId = connected(id),
      action = environmentActionSchema.parse(input);
    if (action.type === 'remove') {
      const cn = store.snapshot().preferences.locale === 'zh-CN';
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        message: cn
          ? '删除此 Conda 环境及其依赖？'
          : 'Remove this Conda environment and its packages?',
        detail: action.prefix,
        buttons: [cn ? '取消' : 'Cancel', cn ? '删除' : 'Remove'],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) throw new Error(cn ? '已取消' : 'Cancelled');
    }
    requirePlugin('conda');
    return environments.action(connected(sessionId), action);
  });
  handle('environments:terminal', async (id, conda, prefix) => {
    requirePlugin('conda');
    const sessionId = connected(id);
    remoteExecutable.parse(conda);
    remoteExecutable.parse(prefix);
    const result = await environments.openTerminal(sessionId, conda, prefix);
    try {
      connections.adopt('cshell.ssh', result.sessionId);
    } catch (error) {
      ssh.disconnect(result.sessionId);
      throw error;
    }
    return result;
  });
  handle('python:analyze', (id, python, code, line, column, path) => {
    requirePlugin('python');
    return environments.analyze(connected(id), python, code, line, column, path);
  });
  handle('applications:plan', (id, request) => apps.plan(connected(id), request));
  handle('applications:install', (id) => apps.install(z.string().uuid().parse(id)));
  handle('jobs:list', (id) => jobs.list(z.string().uuid().parse(id)));
  handle('jobs:cancel', (id) => jobs.cancel(z.string().uuid().parse(id)));
  handle('jupyter:status', (id, python) =>
    environments.jupyterStatus(z.string().uuid().parse(id), remoteExecutable.parse(python)),
  );
  handle('jupyter:start', async (id, python, port) => {
    requirePlugin('conda');
    const url = await environments.startJupyter(connected(id), python, port);
    await shell.openExternal(url);
  });
  handle('jupyter:stop', (id, python) =>
    environments.stopJupyter(z.string().uuid().parse(id), remoteExecutable.parse(python)),
  );
}
