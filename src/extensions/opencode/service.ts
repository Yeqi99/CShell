import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AiProviderExtension } from '../../core/ai-extension';
import { readAiResponse } from '../../core/ai-response';
import { family, encodeRequest, normalizeResponse } from './protocol';
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const workspaceSchema = z
  .string()
  .regex(/^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/)
  .optional();
const accountSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  key: z.string().min(1).max(16000),
  workspace: workspaceSchema,
  refreshToken: z.string().max(16000).optional(),
  expiresAt: z.number().finite().optional(),
  refreshPending: z.boolean().optional(),
  providerId: z.string().uuid().optional(),
});
const configSchema = z.object({ accounts: z.array(accountSchema).max(32) });
const legacySchema = z.object({
  key: z.string().max(16000).default(''),
  workspace: workspaceSchema,
});
const modelSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/) });
const tierSchema = z.enum(['go', 'zen']);
export function quotaWindows(raw: any) {
  return [
    ['rollingUsage', '5 小时'],
    ['weeklyUsage', '每周'],
    ['monthlyUsage', '每月'],
  ].flatMap(([key, label]) => {
    const v = raw?.usage?.[key.replace('Usage', '')] ?? raw?.[key];
    const percent = v?.percent ?? v?.usagePercent;
    if (!v || typeof percent !== 'number' || !Number.isFinite(percent)) return [];
    return [
      {
        label,
        usedPercent: percent,
        resetAt:
          typeof v.resetsAt === 'string' ? v.resetsAt : typeof v.resetAt === 'string'
            ? v.resetAt
            : typeof v.resetInSec === 'number' && Number.isFinite(v.resetInSec) && v.resetInSec >= 0
              ? new Date(Date.now() + v.resetInSec * 1000).toISOString()
              : undefined,
      },
    ];
  });
}
export class OpenCodeExtension implements AiProviderExtension {
  readonly id = 'cshell.opencode';
  private config: z.infer<typeof configSchema> = { accounts: [] };
  private cache = new Map<string, { at: number; models: { id: string; available: boolean }[] }>();
  private saving = Promise.resolve();
  private loadError = '';
  private device:
    | {
        id: string;
        code: string;
        userCode: string;
        url: string;
        expiresAt: number;
        interval: number;
        nextPoll: number;
      }
    | undefined;
  private refreshing = new Map<string, Promise<string>>();
  private invalidRefresh = new Set<string>();
  constructor(
    private host: {
      directory: string;
      enabled: () => boolean;
      encrypt: (s: string) => Promise<string>;
      decrypt: (s: string) => Promise<string>;
      saveProvider: (p: any) => Promise<void>;
      open: (url: string) => Promise<void>;
    },
    private network: typeof fetch = fetch,
  ) {}
  private check() {
    if (!this.host.enabled()) throw Error('请先在插件市场启用 OpenCode 扩展');
    if (this.loadError) throw Error(this.loadError);
  }
  async load() {
    try {
      const raw = JSON.parse(
        await this.host.decrypt(await readFile(join(this.host.directory, 'opencode.enc'), 'utf8')),
      );
      if ('accounts' in raw) this.config = configSchema.parse(raw);
      else {
        const old = legacySchema.parse(raw);
        this.config = { accounts: old.key ? [{ ...old, id: 'default', name: '默认账号' }] : [] };
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        this.loadError = 'OpenCode 扩展配置读取失败，请检查本机凭据存储';
    }
  }
  // Backend-only: plaintext exists only inside the encrypted cloud vault pipeline.
  async cloudExport() {
    await this.saving;
    if (this.loadError) throw Error(this.loadError);
    return structuredClone(this.config);
  }
  cloudValidate(value: unknown) {
    const next = configSchema.parse(value);
    if (new Set(next.accounts.map(a => a.id)).size !== next.accounts.length)
      throw Error('云端 OpenCode 账号重复');
    return next;
  }
  async cloudImport(value: unknown) {
    const next = this.cloudValidate(value);
    await this.mutate(() => next, false);
    this.cache.clear();
    this.invalidRefresh.clear();
  }
  private account(id = 'default') {
    const a = this.config.accounts.find((a) => a.id === id);
    if (!a) throw Error('此 OpenCode 账号未配置或已移除，请重新选择账号');
    return a;
  }
  private async mutate(change: () => z.infer<typeof configSchema>, requireEnabled = true) {
    const task = this.saving
      .catch(() => {})
      .then(async () => {
        if (requireEnabled) this.check();
        else if (this.loadError) throw Error(this.loadError);
        const next = configSchema.parse(change());
        const path = join(this.host.directory, 'opencode.enc');
        await mkdir(dirname(path), { recursive: true });
        const temp = path + '.' + randomUUID() + '.tmp';
        await writeFile(temp, await this.host.encrypt(JSON.stringify(next)));
        if (requireEnabled) this.check();
        await rename(temp, path);
        this.config = next;
      });
    this.saving = task;
    await task;
  }
  private url(tier: 'go' | 'zen', suffix: string) {
    return `https://opencode.ai/inference/${tier === 'go' ? 'go/' : ''}${suffix}`;
  }
  private async json(url: string, key?: string) {
    this.check();
    const r = await this.network(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw Error(
        `OpenCode HTTP ${r.status}${r.status === 401 ? '：请检查 API Key' : r.status === 403 ? '：此 Key 或套餐没有访问权限' : ''}`,
      );
    }
    const reader = r.body?.getReader();
    if (!reader) throw Error('OpenCode 返回空响应');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) throw Error('OpenCode 响应过大');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    this.check();
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  private async authRequest(path: string, body: Record<string, string>) {
    const response = await this.network('https://opencode.ai/console/auth/device/' + path, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    const reader = response.body?.getReader();
    if (!reader) throw Error('登录服务返回空响应');
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const n = await reader.read();
        if (n.done) break;
        bytes += n.value.length;
        if (bytes > 65536) throw Error('登录响应过大');
        chunks.push(n.value);
      }
    } finally {
      await reader.cancel();
    }
    this.check();
    return {
      ok: response.ok,
      status: response.status,
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    };
  }
  private async credential(id: string): Promise<string> {
    const ongoing = this.refreshing.get(id);
    if (ongoing) return ongoing;
    const a = this.account(id);
    if (this.invalidRefresh.has(id) || a.refreshPending)
      throw Error('登录刷新结果未知，请重新登录；不会重复使用刷新令牌');
    if (!a.refreshToken || !a.expiresAt || Date.now() < a.expiresAt - 60000) return a.key;
    const task = (async () => {
      this.invalidRefresh.add(id);
      await this.mutate(() => {
        const current = this.account(id);
        if (current.key !== a.key || current.refreshToken !== a.refreshToken)
          throw Error('账号已变化，请重新登录');
        return {
          accounts: this.config.accounts.map((v) =>
            v.id === id ? { ...v, refreshPending: true } : v,
          ),
        };
      });
      const r = await this.authRequest('token', {
        grant_type: 'refresh_token',
        refresh_token: a.refreshToken!,
        client_id: 'cshell-opencode',
      });
      if (!r.ok) throw Error('OpenCode 登录已过期，请重新通过浏览器登录');
      const token = z
        .object({
          access_token: z.string().min(1).max(16000),
          refresh_token: z.string().min(1).max(16000),
          expires_in: z.number().positive().max(31536000),
        })
        .parse(r.value);
      await this.mutate(() => {
        const current = this.account(id);
        if (current.key !== a.key || current.refreshToken !== a.refreshToken)
          throw Error('账号已变化，请重新登录');
        return {
          accounts: this.config.accounts.map((v) =>
            v.id === id
              ? {
                  ...v,
                  key: token.access_token,
                  refreshToken: token.refresh_token,
                  expiresAt: Date.now() + token.expires_in * 1000,
                  refreshPending: false,
                }
              : v,
          ),
        };
      });
      this.invalidRefresh.delete(id);
      return token.access_token;
    })();
    this.refreshing.set(id, task);
    try {
      return await task;
    } finally {
      this.refreshing.delete(id);
    }
  }
  async models(tier: 'go' | 'zen', refresh = false) {
    this.check();
    const cached = this.cache.get(tier);
    if (!refresh && cached && Date.now() - cached.at < 300000) return cached.models;
    const data = z
      .object({ data: z.array(modelSchema).max(2000) })
      .parse(await this.json(this.url(tier, 'v1/models')));
    const models = [...new Set(data.data.map((m) => m.id))]
      .sort()
      .map((id) => ({ id, available: !!family(id) }));
    this.cache.set(tier, { at: Date.now(), models });
    return models;
  }
  private reference(reference: string) {
    const parts = reference.split('/');
    const [accountId, tierValue, model] = parts.length === 2 ? ['default', ...parts] : parts;
    if (parts.length !== 2 && parts.length !== 3) throw Error('模型标识无效');
    idSchema.parse(accountId);
    return {
      accountId,
      tier: tierSchema.parse(tierValue),
      model: modelSchema.shape.id.parse(model),
      legacy: parts.length === 2,
    };
  }
  private consoleUrl(page: 'keys' | 'go', id = 'default') {
    const a = this.config.accounts.find((a) => a.id === id);
    return `https://opencode.ai/console/${a?.workspace ? a.workspace + '/' + page : ''}`;
  }
  async call(action: string, input: unknown = {}): Promise<any> {
    this.check();
    if (action === 'login-start') {
      const r = await this.authRequest('code', {
        client_id: 'cshell-opencode',
        supports_org_scope: 'true',
      });
      if (!r.ok) throw Error('无法开始 OpenCode 登录，请稍后重试');
      const v = z
        .object({
          device_code: z.string().min(1).max(16000),
          user_code: z.string().min(1).max(100),
          verification_uri_complete: z.string().max(2000),
          expires_in: z.number().positive().max(3600),
          interval: z.number().positive().max(60).default(5),
        })
        .parse(r.value);
      const url = new URL(v.verification_uri_complete, 'https://opencode.ai');
      if (url.origin !== 'https://opencode.ai' || url.pathname != '/console/device')
        throw Error('登录地址不可信');
      const id = randomUUID();
      this.device = {
        id,
        code: v.device_code,
        userCode: v.user_code,
        url: url.href,
        expiresAt: Date.now() + v.expires_in * 1000,
        interval: Math.max(5, v.interval),
        nextPoll: Date.now() + Math.max(5, v.interval) * 1000,
      };
      await this.host.open(url.href);
      return {
        id,
        userCode: v.user_code,
        expiresAt: this.device.expiresAt,
        interval: this.device.interval,
      };
    }
    if (action === 'login-cancel') {
      if ((input as any)?.id === this.device?.id) this.device = undefined;
      return;
    }
    if (action === 'login-poll') {
      const d = this.device;
      if (!d || d.id !== (input as any)?.id) throw Error('登录已取消，请重新开始');
      if (Date.now() >= d.expiresAt) {
        this.device = undefined;
        throw Error('登录已过期，请重新开始');
      }
      if (Date.now() < d.nextPoll) return { pending: true };
      d.nextPoll = Infinity;
      let r;
      try {
        r = await this.authRequest('token', {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: d.code,
          client_id: 'cshell-opencode',
        });
      } finally {
        d.nextPoll = Date.now() + d.interval * 1000;
      }
      if (this.device !== d) throw Error('登录已取消');
      if (!r.ok) {
        if (r.value.error === 'authorization_pending' || r.value.error === 'slow_down') {
          if (r.value.error === 'slow_down') {
            d.interval = Math.min(60, d.interval + 5);
            d.nextPoll = Date.now() + d.interval * 1000;
          }
          return { pending: true };
        }
        this.device = undefined;
        throw Error('登录未获批准或已过期，请重新开始');
      }
      this.device = undefined;
      const token = z
        .object({
          access_token: z.string().min(1).max(16000),
          refresh_token: z.string().min(1).max(16000),
          expires_in: z.number().positive().max(31536000),
          org_id: workspaceSchema,
        })
        .parse(r.value);
      await this.mutate(() => ({
        accounts: [
          ...this.config.accounts,
          {
            id: d.id,
            name: '浏览器账号 ' + (this.config.accounts.length + 1),
            key: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date.now() + token.expires_in * 1000,
            workspace: token.org_id,
          },
        ],
      }));
      return { pending: false, id: d.id, ...(await this.call('status')) };
    }
    if (action === 'status') {
      const a = this.config.accounts.find((a) => a.id === 'default');
      return {
        hasKey: this.config.accounts.length > 0,
        workspace: a?.workspace ?? '',
        accounts: this.config.accounts.map(({ id, name, workspace, refreshToken, providerId }) => ({
          id,
          name,
          workspace: workspace ?? '',
          hasKey: true,
          login: !!refreshToken,
          providerId,
        })),
        usageUrl: this.consoleUrl('go'),
      };
    }
    if (action === 'save') {
      const p = z
        .object({
          id: idSchema.default('default'),
          name: z.string().trim().min(1).max(80).optional(),
          key: z.string().trim().max(16000).optional(),
          workspace: z.string().max(2000).optional(),
        })
        .strict()
        .parse(input);
      const workspace = p.workspace?.startsWith('https://')
        ? new URL(p.workspace).pathname.split('/').find((s) => /^(wrk_|org_)/.test(s))
        : p.workspace;
      await this.mutate(() => {
        const old = this.config.accounts.find((a) => a.id === p.id);
        const next = accountSchema.parse({
          id: p.id,
          name: p.name ?? old?.name ?? '默认账号',
          key: p.key || old?.key,
          providerId: old?.providerId,
          workspace: p.workspace === undefined ? old?.workspace : workspace || undefined,
          ...(!p.key && old?.refreshToken
            ? {
                refreshToken: old.refreshToken,
                expiresAt: old.expiresAt,
                refreshPending: old.refreshPending,
              }
            : {}),
        });
        return { accounts: [...this.config.accounts.filter((a) => a.id !== p.id), next] };
      });
      if (p.key) this.invalidRefresh.delete(p.id);
      return this.call('status');
    }
    if (action === 'remove') {
      const id = idSchema.parse((input as any)?.id);
      await this.mutate(() => ({ accounts: this.config.accounts.filter((a) => a.id !== id) }));
      return this.call('status');
    }
    if (action === 'models') {
      const p = z.object({ tier: tierSchema, refresh: z.boolean().default(false) }).parse(input);
      return this.models(p.tier, p.refresh);
    }
    if (action === 'choices') {
      const p = this.reference(
        z
          .string()
          .max(400)
          .parse((input as any)?.reference),
      );
      this.account(p.accountId);
      const groups = await Promise.allSettled((['go', 'zen'] as const).map(async tier =>
        (await this.models(tier)).map(m => ({
          ref: `${p.accountId}/${tier}/${m.id}`,
          model: m.id, label: `${m.id} · ${tier === 'go' ? 'Go' : 'Zen'}`,
          available: m.available,
        }))));
      const models = groups.flatMap(g => g.status === 'fulfilled' ? g.value : []);
      if (!models.length) throw Error('OpenCode 模型目录暂不可用，请稍后刷新');
      return models;
    }
    if (action === 'usage') {
      const id = idSchema.parse((input as any)?.id ?? 'default');
      const key = await this.credential(id);
      const value = await this.json(this.url('go', 'v1/usage'), key);
      if (this.account(id).key !== key) throw Error('账号已变化，请重新检测');
      const windows = quotaWindows(value);
      return {
        windows,
        available: windows.length > 0,
        useBalance: typeof value.useBalance === 'boolean' ? value.useBalance : undefined,
        checkedAt: Date.now(),
        message: windows.length
          ? '官方 Go 套餐使用量；不是现金余额'
          : '服务返回了未识别的额度格式，请在控制台查看',
        url: this.consoleUrl('go', id),
      };
    }
    if (action === 'check') {
      const p = z
        .object({
          id: idSchema.default('default'),
          tier: tierSchema,
          model: modelSchema.shape.id.optional(),
        })
        .parse(input);
      const key = await this.credential(p.id);
      // Public model catalogs alone never establish authentication, including free models.
      await this.json('https://opencode.ai/console/api/v2/config', key);
      if (this.account(p.id).key !== key) throw Error('账号已变化，请重新检测');
      const models = await this.models(p.tier, true);
      const model = p.model ?? models.find((m) => m.available)?.id;
      if (!model) throw Error('当前目录没有可检测的模型');
      const provider = await this.resolve(`${p.id}/${p.tier}/${model}`, 'configuration-probe');
      const started = Date.now();
      const response = await provider.transport(provider.url, {
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'Reply with OK only.' }],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`模型检测 HTTP ${response.status}；账号已保存，请检查套餐、额度或所选模型权限`);
      }
      const reply = await readAiResponse(response, () => {});
      if (!reply.content?.trim()) throw Error('模型未返回有效文本');
      if (this.account(p.id).key !== key) throw Error('账号已变化，请重新检测');
      let usage = null,
        usageError = '';
      if (p.tier === 'go')
        try {
          usage = await this.call('usage', { id: p.id });
        } catch (e) {
          usageError = (e as Error).message;
        }
      return {
        authenticated: true,
        model,
        elapsedMs: Date.now() - started,
        models,
        usage,
        usageError,
        checkedAt: Date.now(),
      };
    }
    if (action === 'open') {
      const p = z
        .object({ page: z.enum(['keys', 'go']), id: idSchema.default('default') })
        .parse(input);
      await this.host.open(this.consoleUrl(p.page, p.id));
      return;
    }
    if (action === 'add') {
      const p = z
        .object({
          accountId: idSchema.optional(),
          tier: tierSchema,
          model: modelSchema.shape.id,
          name: z.string().trim().min(1).max(80),
          id: z.string().uuid().optional(),
        })
        .strict()
        .parse(input);
      const reference = `${p.accountId ? p.accountId + '/' : ''}${p.tier}/${p.model}`;
      await this.resolve(reference, 'configuration');
      const id = p.id ?? randomUUID();
      await this.host.saveProvider({
        id,
        name: p.name,
        url: 'https://model-extension.invalid',
        model: p.model,
        extension: { id: this.id, model: reference },
      });
      return { id };
    }
    if (action === 'connect') {
      const id = idSchema.parse((input as any)?.id ?? 'default');
      const account = this.account(id);
      await this.json('https://opencode.ai/console/api/v2/config', await this.credential(id));
      const choices = await this.call('choices', {reference:`${id}/go/placeholder`}) as {ref:string;model:string;available:boolean}[];
      const choice = choices.find(m => m.available);
      const model = choice?.model;
      if (!model) throw Error('没有已适配的模型');
      const providerId = account.providerId ?? randomUUID();
      await this.host.saveProvider({id:providerId,name:`OpenCode · ${account.name}`,url:'https://model-extension.invalid',model,extension:{id:this.id,model:choice!.ref}});
      await this.mutate(() => ({accounts:this.config.accounts.map(a => a.id === id ? {...a,providerId} : a)}));
      return {id:providerId};
    }
    throw Error('不支持的模型扩展操作');
  }
  async resolve(reference: string, session: string) {
    this.check();
    const { accountId, tier, model } = this.reference(reference);
    this.account(accountId);
    const listed = (await this.models(tier)).find((m) => m.id === model);
    if (!listed?.available)
      throw Error('该模型不在当前目录中，或尚未适配其协议；请刷新 OpenCode 模型列表');
    const kind = family(model)!;
    const transport: typeof fetch = async (_url, init) => {
      this.check();
      const key = await this.credential(accountId);
      const b = JSON.parse(String(init?.body));
      if (b.model !== model) throw Error('模型配置已变化');
      const suffix =
        kind === 'chat'
          ? 'openai/v1/chat/completions'
          : kind === 'responses'
            ? 'openai/v1/responses'
            : kind === 'anthropic'
              ? 'anthropic/v1/messages'
              : `google/v1beta/models/${encodeURIComponent(model)}:${b.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
      const response = await this.network(this.url(tier, suffix), {
        method: 'POST',
        redirect: 'error',
        signal: init?.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'User-Agent': 'CShell-OpenCode-Extension/1.0',
          'x-opencode-session': session,
          ...(kind === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}),
        },
        body: JSON.stringify(encodeRequest(kind, b)),
      });
      this.check();
      if (this.account(accountId).key !== key) {
        await response.body?.cancel();
        throw Error('OpenCode 账号凭据已变化');
      }
      return normalizeResponse(response, kind, !!b.stream);
    };
    return { url: 'https://model-extension.invalid', model, key: '', transport };
  }
}
