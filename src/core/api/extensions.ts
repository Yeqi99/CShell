import { z } from 'zod';
import { EnvironmentService } from '../environments';
import { ApplicationService } from '../applications';
import { RemoteJobs } from '../remote-jobs';
import { PythonFiles } from '../python-files';
import { remoteFileConflict } from '../paths';
import { extensionResults, extensionExamples } from './extension-contracts';
import type { SshService, Session } from '../ssh';
import type { Store } from '../store';
import type { ConnectionTool } from '../connections/contracts';
import {
  applicationRequestSchema,
  environmentActionSchema,
  remoteExecutable,
  pluginEnabled,
  applications,
  catalogSchema,
  installedPluginSchema,
} from '../../shared/plugins';
import { ApiError } from './errors';
import { DockerService } from '../docker';
import { dockerActionSchema, dockerId } from '../../shared/docker';
import { PluginService } from '../plugins';
import { pluginId } from '../../shared/plugins';
import type { ProcessExtensions } from '../process-extensions';

/** Shared by desktop handlers and the provider registry; no IPC forwarding or separate job store. */
export function createExtensionServices(
  ssh: SshService,
  store: Store,
  beforeDisable?: (id: string) => Promise<void>,
  processExtensions?: ProcessExtensions,
) {
  const plugins = new PluginService(store);
  const applicationTools: ConnectionTool[] = [
    {
      name: 'plugin_catalog',
      capability: 'plugins.manage',
      description:
        'Fetch and validate an HTTPS plugin catalog using the desktop market service, then save it as the application catalog source. Performs a network request; rejects redirects, unsupported protocols and forged built-in capabilities. Does not install a package.',
      input: z.object({ url: z.string().url().max(2048) }).strict(),
      jsonOutput: catalogSchema.shape.plugins,
      examples: [
        {
          input: { url: 'https://example.com/plugins.json' },
          explanation:
            'Replace with a trusted HTTPS catalog URL. Fetching validates and saves the catalog source; it does not install packages.',
        },
      ],
      needsReview: () => true,
      conflictDomain: () => 'plugins',
      invoke: async (input, signal) =>
        JSON.stringify(await plugins.catalog((input as { url: string }).url, signal)),
    },
    {
      name: 'plugin_download',
      capability: 'plugins.manage',
      description:
        'Download and enable a plugin using an exact catalog entry. Verifies SHA-256, manifest equality and supported contribution permissions. External packages can only supply supported command snippets; no arbitrary renderer code. Network and application-wide installation side effects require review.',
      input: z.object({ entry: catalogSchema.shape.plugins.element }).strict(),
      jsonOutput: z.object({ id: pluginId, installed: z.literal(true) }).strict(),
      needsReview: () => true,
      conflictDomain: () => 'plugins',
      invoke: async (input, signal) => {
        const entry = (input as { entry: z.infer<typeof catalogSchema>['plugins'][number] }).entry;
        await plugins.download(entry, signal);
        return JSON.stringify({ id: entry.manifest.id, installed: true });
      },
    },
    {
      name: 'plugins_list',
      capability: 'plugins.read',
      description:
        'List installed plugin manifests and enabled state. Application-wide metadata; does not grant access to remote machines or secrets.',
      input: z.object({}).strict(),
      jsonOutput: z.array(installedPluginSchema),
      examples: [
        {
          input: {},
          explanation:
            'Inspect actual installed manifests and enabled state before requesting a management change.',
        },
      ],
      needsReview: () => false,
      invoke: async (_a, signal) => {
        signal.throwIfAborted();
        return JSON.stringify(store.plugins());
      },
    },
    {
      name: 'plugin_manage',
      capability: 'plugins.manage',
      description:
        'Install a built-in plugin, toggle it, or remove it. Changes the whole CShell application and may affect active plugin operations. Does not grant API machine permissions. Remote packages require application_plan/application_install instead.',
      input: z
        .object({ id: pluginId, action: z.enum(['install', 'enable', 'disable', 'remove']) })
        .strict(),
      jsonOutput: z
        .object({
          id: pluginId,
          action: z.enum(['install', 'enable', 'disable', 'remove']),
          applied: z.literal(true),
        })
        .strict(),
      examples: [
        {
          input: { id: 'cshell.python', action: 'enable' },
          explanation:
            'Use an installed plugin ID from plugins_list; enabling changes application-wide state without granting machine access.',
        },
      ],
      needsReview: () => true,
      conflictDomain: () => 'plugins',
      invoke: async (input, signal) => {
        const a = input as { id: string; action: string };
        signal.throwIfAborted();
        if (a.action === 'disable' || a.action === 'remove') await beforeDisable?.(a.id);
        if (a.id === 'cshell.conda' && (a.action === 'disable' || a.action === 'remove'))
          environments.stopAllJupyter();
        signal.throwIfAborted();
        const beforeWrite = () => signal.throwIfAborted();
        if (a.action === 'install') await plugins.install(a.id, beforeWrite);
        else if (a.action === 'remove') await plugins.remove(a.id, beforeWrite);
        else await plugins.toggle(a.id, a.action === 'enable', beforeWrite);
        await processExtensions?.refresh();
        return JSON.stringify({ id: a.id, action: a.action, applied: true });
      },
    },
  ];
  const builtinToolCount = applicationTools.length;
  const refreshProcessTools = () => applicationTools.splice(builtinToolCount, applicationTools.length - builtinToolCount, ...(processExtensions?.applicationTools() ?? []));
  const jobs = new RemoteJobs(ssh);
  const environments = new EnvironmentService(ssh, jobs);
  const apps = new ApplicationService(jobs);
  const files = new PythonFiles(ssh);
  const docker = new DockerService(ssh, () => {
    const settings = store.snapshot().tools;
    if (!settings.dockerEnabled)
      throw new ApiError('UNAVAILABLE', 'Docker plugin is disabled.', 'Enable Docker in CShell.');
    return settings.dockerSocket;
  });
  const cached = new WeakMap<Session, readonly ConnectionTool[]>();
  const requirePlugin = (name: 'conda' | 'python') => {
    if (!pluginEnabled(store.plugins(), name))
      throw new ApiError(
        'UNAVAILABLE',
        `${name} plugin is disabled.`,
        'Enable the plugin in CShell before using this operation.',
      );
  };
  const tools = (id: string): readonly ConnectionTool[] => {
    const session = ssh.get(id);
    let result = cached.get(session);
    if (!result) {
      const tool = (
        name: string,
        capability: string,
        description: string,
        input: z.ZodType,
        invoke: (args: any, signal: AbortSignal) => Promise<unknown> | unknown,
        mutation = false,
      ): ConnectionTool => ({
        name,
        capability,
        description,
        input,
        jsonOutput: extensionResults[name],
        examples: extensionExamples[name],
        needsReview: () => mutation,
        conflictDomain: mutation
          ? (args) =>
              name === 'python_file_save'
                ? remoteFileConflict((args as { path: string }).path)
                : 'extension-environment'
          : undefined,
        invoke: async (args, signal) => {
          signal.throwIfAborted();
          const value = await invoke(args, signal);
          signal.throwIfAborted();
          return JSON.stringify(value);
        },
      });
      // Keep the scheduler reservation until the shared job actually settles. Abort requests
      // cancellation but does not claim that all remote descendants have terminated.
      const waitJob = async (job: { id: string }, signal: AbortSignal) => {
        const cancel = () => jobs.cancel(job.id);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        try {
          return await jobs.wait(job.id);
        } finally {
          signal.removeEventListener('abort', cancel);
        }
      };
      result = [
        tool(
          'python_analyze',
          'environments.read',
          'Analyze supplied Python source with the selected real remote interpreter and installed semantic dependencies. Requires Python plugin. Does not execute the supplied source. Position is a one-based line and zero-based Unicode column. Missing dependencies are reported; no static keyword fallback.',
          z
            .object({
              python: remoteExecutable,
              code: z.string().max(32000),
              line: z.number().int().min(1).max(32000),
              column: z.number().int().min(0).max(32000),
              path: remoteExecutable.refine((p) => p.endsWith('.py')).optional(),
            })
            .strict(),
          (a) => {
            requirePlugin('python');
            return environments.analyze(id, a.python, a.code, a.line, a.column, a.path);
          },
        ),
        tool(
          'python_file_read',
          'files.read',
          'Read a UTF-8 .py file and its SHA-256 content revision using the same desktop editor service. Requires Python plugin. Maximum file size 1 MB; API result quota may be lower, so use read_file_chunk for large files.',
          z
            .object({
              path: z
                .string()
                .max(4096)
                .refine((p) => p.endsWith('.py')),
            })
            .strict(),
          (a) => {
            requirePlugin('python');
            return files.read(id, a.path);
          },
        ),
        tool(
          'python_file_save',
          'files.write',
          'Save a .py file through the shared editor service. Requires Python plugin and the SHA-256 revision from python_file_read. Writes a temporary file then uses OpenSSH rename, preserving ownership and mode. Content checks are best effort, not atomic compare-and-swap against external writers. Explicitly accept this limitation. Unknown outcomes must be inspected, never blindly retried.',
          z
            .object({
              path: z
                .string()
                .max(4096)
                .refine((p) => p.endsWith('.py')),
              code: z.string().max(32000),
              revision: z.string().regex(/^[a-f0-9]{64}$/),
              acceptNonAtomic: z.literal(true),
            })
            .strict(),
          (a, signal) => {
            requirePlugin('python');
            return files.save(id, a.path, a.code, a.revision, () => {
              signal.throwIfAborted();
              requirePlugin('python');
            });
          },
          true,
        ),
        tool(
          'docker_snapshot',
          'docker.read',
          'Inspect Docker containers and images through this SSH target’s configured Unix socket. Requires Docker plugin; never exposes or falls back to a TCP daemon.',
          z.object({}).strict(),
          () => docker.snapshot(id),
        ),
        tool(
          'docker_details',
          'docker.read',
          'Read the selected container configuration on this SSH target.',
          z.object({ id: dockerId }).strict(),
          (a) => docker.details(id, a.id),
        ),
        tool(
          'docker_stats',
          'docker.read',
          'Read actual container resource counters on this SSH target.',
          z.object({ id: dockerId }).strict(),
          (a) => docker.stats(id, a.id),
        ),
        tool(
          'docker_action',
          'docker.manage',
          'Perform a declared Docker operation on this target. Port changes may recreate a container. Inspect configuration first; volumes are not implicitly deleted. No privilege escalation.',
          dockerActionSchema,
          (a) => docker.action(id, a),
          true,
        ),
        tool(
          'environments_list',
          'environments.read',
          'Inspect actual Python and Conda interpreters on this SSH target. Requires the Conda plugin. No installation or activation.',
          z.object({}).strict(),
          () => {
            requirePlugin('conda');
            return environments.inspect(id);
          },
        ),
        tool(
          'environment_packages',
          'environments.read',
          'List packages using the explicitly selected remote interpreter. Requires Conda plugin.',
          z.object({ python: remoteExecutable }).strict(),
          (a) => {
            requirePlugin('conda');
            return environments.packages(id, a.python);
          },
        ),
        tool(
          'environment_jupyter_status',
          'environments.read',
          'Inspect only Jupyter owned by this API connection and interpreter. Never discovers or adopts external servers. Returns readiness and remote port, never tokens or local tunnel URLs.',
          z.object({ python: remoteExecutable }).strict(),
          (a) => {
            requirePlugin('conda');
            return environments.jupyterStatus(id, a.python);
          },
        ),
        tool(
          'environment_jupyter_start',
          'environments.manage',
          'Start Jupyter on the selected interpreter, bound to remote loopback with a backend-held random token. Requires installed jupyterlab; does not install or elevate. Connection owns the process and tunnel; disconnect/revocation closes them. Returns status only, not a browser URL. Use task_start with an idempotency key. Closing the SSH channel cannot guarantee termination of every remote descendant.',
          z
            .object({ python: remoteExecutable, port: z.number().int().min(1024).max(65535) })
            .strict(),
          async (a, signal) => {
            requirePlugin('conda');
            await environments.startJupyter(id, a.python, a.port, signal);
            try {
              signal.throwIfAborted();
              requirePlugin('conda');
            } catch (error) {
              environments.stopJupyter(id, a.python);
              throw error;
            }
            return environments.jupyterStatus(id, a.python);
          },
          true,
        ),
        tool(
          'environment_jupyter_stop',
          'environments.manage',
          'Close only this connection’s Jupyter process channel and tunnel for the selected interpreter. Also cancels an in-progress startup. Does not stop external Jupyter servers; remote descendant termination is not guaranteed.',
          z.object({ python: remoteExecutable }).strict(),
          (a) => {
            requirePlugin('conda');
            environments.stopJupyter(id, a.python);
            return environments.jupyterStatus(id, a.python);
          },
          true,
        ),
        tool(
          'environment_action',
          'environments.manage',
          'Create or remove a Conda environment or install packages on this target using a separate SSH channel. Requires Conda plugin. Use task_start with an idempotency key; cancellation does not guarantee descendant termination.',
          environmentActionSchema,
          async (a, signal) => {
            requirePlugin('conda');
            const job = await environments.action(id, a, () => {
              signal.throwIfAborted();
              requirePlugin('conda');
            });
            return waitJob(job, signal);
          },
          true,
        ),
        tool(
          'applications_list',
          'applications.read',
          'List the built-in, implemented Linux application recipes. Check application_plan against the actual target before installation.',
          z.object({}).strict(),
          () => applications,
        ),
        tool(
          'application_plan',
          'applications.read',
          'Check the actual remote platform and return a 15-minute installation plan including the exact command. Does not install. Inspect the plan before calling application_install.',
          applicationRequestSchema,
          (a) => apps.plan(id, a),
        ),
        tool(
          'application_install',
          'applications.install',
          'Execute an unexpired installation plan bound to this session. Uses a separate SSH channel, never the interactive terminal. No implicit privilege escalation. Use task_start with an idempotency key.',
          z.object({ planId: z.string().uuid() }).strict(),
          (a, signal) => waitJob(apps.install(a.planId, id), signal),
          true,
        ),
      ];
      cached.set(session, result);
    }
    return result.filter(
      (t) =>
        (!t.name.startsWith('environment') || pluginEnabled(store.plugins(), 'conda')) &&
        (!t.name.startsWith('python_') || pluginEnabled(store.plugins(), 'python')) &&
        (!t.name.startsWith('docker_') || store.snapshot().tools.dockerEnabled),
    );
  };
  return { jobs, environments, apps, files, docker, tools, plugins, applicationTools, processExtensions, refreshProcessTools };
}
export type ExtensionServices = ReturnType<typeof createExtensionServices>;
