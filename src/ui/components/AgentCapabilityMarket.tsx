import { ErrorNotice } from './ErrorNotice';
import { remoteWechatConfig } from '../../shared/wechat';
import {WechatPlugin} from './WechatPlugin';
import {Monitor,Package,MessageCircle} from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { AgentCall, AgentTarget } from '../../shared/agent';
import { desktopConfigSchema, type DesktopConfig } from '../../shared/agent-desktop';
import { AgentDesktopView } from './AgentDesktopView';
import './agent-capability-market.css';
import {agentRead} from '../agent-read';

const stateSchema = z.enum([
  'not-installed',
  'not-configured',
  'authorization-required',
  'available',
  'incompatible',
  'fault',
]);
const catalogSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string(),
    source: z.string(),
    permissions: z.array(z.string()),
    installed: z.boolean(),
    status: stateSchema,
    reason: z.string().optional(),
  }),
);
const installedSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    status: stateSchema,
    reason: z.string().optional(),
    grants: z.array(z.string()),
    requiredPermissions: z.array(z.string()),
    registered: z.boolean(),
  }),
);
const statusSchema = z.object({
  enabled: z.boolean(),
  listening: z.boolean(),
  viewAllowed: z.boolean(),
  controlAllowed: z.boolean(),
  config: desktopConfigSchema.optional(),
  busy: z.boolean().optional(),
});
const states = {
  'not-installed': '未安装',
  'not-configured': '待配置',
  'authorization-required': '待授权',
  available: '可用',
  incompatible: '版本不兼容',
  fault: '故障',
};
const permissionNames: Record<string, string> = {
  'wechat.read': '读取微信与监听消息',
  'wechat.send': '发送微信与发布朋友圈',
  'wechat.contacts.manage': '修改好友备注',
  'applications.read': '读取系统应用目录',
  'applications.plan': '检查并生成安装计划',
  'applications.install': '按计划安装系统应用',
  'desktop.view': '观看桌面',
  'desktop.control': '控制鼠标键盘',
};
type Call = (method: AgentCall['method'], params?: unknown) => Promise<unknown>;

export function AgentCapabilityMarket({ target, call }: { target: AgentTarget; call: Call }) {
  const [catalog, setCatalog] = useState<z.infer<typeof catalogSchema>>([]);
  const [installed, setInstalled] = useState<z.infer<typeof installedSchema>>([]);
  const [selected, setSelected] = useState('');
  const [grants, setGrants] = useState<string[]>([]);
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [remove, setRemove] = useState(false);
  const refresh = async () => {
    const [nextCatalog, nextInstalled] = await Promise.all([
      agentRead(()=>call('packages.catalog')),
      agentRead(()=>call('packages.list')),
    ]);
    setCatalog(catalogSchema.parse(nextCatalog));
    setInstalled(installedSchema.parse(nextInstalled));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void Promise.all([call('packages.catalog'), call('packages.list')])
      .then(([c, i]) => {
        if (!cancelled) {
          setCatalog(catalogSchema.parse(c));
          setInstalled(installedSchema.parse(i));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [target.id]);
  const item = catalog.find((p) => p.id === selected),
    record = installed.find((p) => p.id === selected);
  const update = async (method: AgentCall['method'], params: unknown) => {
    await call(method, params);
    await refresh();
  };
  return (
    <section className="agent-capability-market" aria-label="能力工具包">
      <div className="agent-toolbar">
        <h3>能力工具包</h3>
        <button disabled={busy} onClick={() => void run(refresh)}>
          刷新能力包
        </button>
      </div>
      {error && (
        <ErrorNotice title="应用能力操作未完成" error={error} />
      )}
      {!item ? (
        <>
          <input
            aria-label="搜索能力包"
            placeholder="搜索能力包"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="agent-app-grid">
            {catalog
              .filter((p) => (p.name + p.id).toLowerCase().includes(query.toLowerCase()))
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelected(p.id);
                    setGrants(installed.find((i) => i.id === p.id)?.grants ?? []);
                    setRemove(false);
                    setError('');
                  }}
                >
                  <span className="capability-app-icon">{p.id==='cagent.desktop'?<Monitor size={23}/>:p.id==='cagent.wechat'?<MessageCircle size={23}/>:<Package size={23}/>}</span><strong>{p.name}</strong>
                  <small>
                    {p.version} · {p.installed&&p.status==='not-installed'?'需要修复':states[p.status]}
                  </small>
                </button>
              ))}
          </div>
          {!catalog.length && !error && <p>没有可用的能力包目录。</p>}
        </>
      ) : (
        <div className="capability-detail">
          <button className="secondary" disabled={busy} onClick={() => setSelected('')}>
            返回能力包列表
          </button>
          <h3>{item.name}</h3>
          <p>{item.description}</p>
          <small>
            {item.version} · {item.source === 'bundled' ? '随 CAgent 提供' : 'GitHub'} ·{' '}
            {record&&record.status==='not-installed'?'已安装 · 需要修复':states[(record ?? item).status]}
          </small>
          {(record?.reason ?? item.reason) && <p>{record?.reason ?? item.reason}</p>}
          {!record ? (
            true ? (
              <>
                <p>安装后按应用要求完成配置，可在这里调整工具权限。</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await update('packages.install', { id: item.id, confirm: true });
                      setGrants([]);
                    })
                  }
                >
                  安装并核验能力包
                </button>
              </>
            ) : (
              <p>请在目标 CAgent 本机安装并配置此能力包。</p>
            )
          ) : (
            <>
              <p>{record.registered ? '已就绪' : '尚未就绪'}</p>{['not-installed','fault','incompatible'].includes(record.status)&&<button disabled={busy} onClick={()=>void run(()=>update('packages.install',{id:item.id,confirm:true}))}>修复安装</button>}
              {true ? (
                <>
                  <fieldset disabled={busy}>
                    <legend>工具权限</legend>
                    {record.requiredPermissions.map((permission) => (
                      <label key={permission}>
                        <input
                          type="checkbox"
                          checked={grants.includes(permission)}
                          onChange={(e) =>
                            setGrants((old) =>
                              e.target.checked
                                ? [...old, permission]
                                : old.filter((p) => p !== permission),
                            )
                          }
                        />
                        {permissionNames[permission] ?? permission}
                      </label>
                    ))}
                    <small>保存后生效；安装不代表授权。</small>
                    <div className="agent-toolbar">
                      <button
                        onClick={() =>
                          void run(() =>
                            update('packages.grant', { id: item.id, permissions: grants }),
                          )
                        }
                      >
                        保存工具权限
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            await update('packages.grant', { id: item.id, permissions: [] });
                            setGrants([]);
                          })
                        }
                      >
                        停用工具
                      </button>
                      <button
                        onClick={() => void run(() => update('packages.refresh', { id: item.id }))}
                      >
                        重新核验
                      </button>
                    </div>
                  </fieldset>
                  <button disabled={busy} onClick={() => setRemove(true)}>
                    卸载能力包
                  </button>
                  {remove && (
                    <div className="capability-confirm">
                      <p>卸载将停止此包的任务并移除工具，不卸载系统软件。</p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await update('packages.uninstall', { id: item.id, confirm: true });
                            setSelected('');
                          })
                        }
                      >
                        确认卸载
                      </button>
                      <button disabled={busy} onClick={() => setRemove(false)}>
                        保留
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p>能力包配置与授权由目标 CAgent 本机管理。</p>
              )}
              {item.id === 'cagent.wechat' && <WechatPlugin key={target.id} remote api={{wechatStatus:async()=>await call('wechat.status') as Awaited<ReturnType<typeof window.cshell.wechatStatus>>,wechatSave:async input=>{await call('wechat.configure',remoteWechatConfig(input));await refresh();},wechatStopSubscriptions:async()=>{await call('wechat.stop');}}}/>}
              {item.id === 'cagent.desktop' && (
                <DesktopSettings
                  key={target.id + item.id + record.status + record.grants.join(',')}
                  target={target}
                  call={call}
                />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DesktopSettings({ target, call }: { target: AgentTarget; call: Call }) {
  const [status, setStatus] = useState<z.infer<typeof statusSchema>>(),
    [config, setConfig] = useState<DesktopConfig>();
  const [fingerprint, setFingerprint] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = async (replaceDraft = false) => {
    const value = statusSchema.parse(await call('desktop.status'));
    setStatus(value);
    if (replaceDraft) setConfig(value.config);
  };
  useEffect(() => {
    let disposed = false;
    void call('desktop.status')
      .then((raw) => {
        if (!disposed) {
          const value = statusSchema.parse(raw);
          setStatus(value);
          setConfig(value.config);
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [target.id]);
  return (
    <section className="capability-desktop" aria-label="桌面服务配置">
      <div className="agent-toolbar">
        <h4>桌面服务</h4>
        <button disabled={busy} onClick={() => void refresh().catch((e) => setError(String(e)))}>
          刷新桌面状态
        </button>
      </div>
      <p>{status ? (status.enabled ? (status.listening ? '服务已启用 · 独立监听' : '服务已启用 · 使用当前 CAgent 连接') : '服务未启用') : '正在读取服务状态'}</p>
      {config && (
        <details>
          <summary>服务与访问权限</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              void Promise.resolve()
                .then(() => call('desktop.configure', desktopConfigSchema.parse(config)))
                .then(() => refresh(true))
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            <fieldset disabled={busy}>
              <label>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                />
                启用桌面服务
              </label>
              <p>复用 CAgent 连接端口，无需单独映射远控端口。</p>
              <label><input type="checkbox" checked={config.authenticatedPeers} onChange={e=>setConfig({...config,authenticatedPeers:e.target.checked,directListener:false})}/>允许已连接的控制端观看和操作</label>
              <label>
                <input
                  type="checkbox"
                  checked={config.local.view}
                  onChange={(e) =>
                    setConfig({ ...config, local: { ...config.local, view: e.target.checked } })
                  }
                />
                允许本机观看
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.local.control}
                  onChange={(e) =>
                    setConfig({ ...config, local: { ...config.local, control: e.target.checked } })
                  }
                />
                允许本机控制键鼠
              </label>
              <h4>远程控制端</h4>
              {Object.entries(config.ownerGrants).map(([owner, grant]) => (
                <div className="capability-owner" key={owner}>
                  <code>{owner}</code>
                  <label>
                    <input
                      type="checkbox"
                      checked={grant.view}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          ownerGrants: {
                            ...config.ownerGrants,
                            [owner]: { ...grant, view: e.target.checked },
                          },
                        })
                      }
                    />
                    观看
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={grant.control}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          ownerGrants: {
                            ...config.ownerGrants,
                            [owner]: { ...grant, control: e.target.checked },
                          },
                        })
                      }
                    />
                    控制
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...config.ownerGrants };
                      delete next[owner];
                      setConfig({ ...config, ownerGrants: next });
                    }}
                  >
                    移除
                  </button>
                </div>
              ))}
              <label>
                控制端身份指纹
                <input
                  value={fingerprint}
                  onChange={(e) => setFingerprint(e.target.value)}
                  placeholder="粘贴已核对的身份指纹"
                />
              </label>
              <button
                type="button"
                disabled={!fingerprint.trim()}
                onClick={() => {
                  const owner = fingerprint.trim();
                  setConfig({
                    ...config,
                    ownerGrants: {
                      ...config.ownerGrants,
                      [owner]: config.ownerGrants[owner] ?? { view: false, control: false },
                    },
                  });
                  setFingerprint('');
                }}
              >
                加入授权草稿
              </button>
              <p>
                保存将重新启动桌面监听并中断当前桌面连接，不自动开放防火墙。观看和键鼠控制分别授权。
              </p>
              <button type="submit">保存并应用服务配置</button>
            </fieldset>
          </form>
        </details>
      )}
      {status && (
        <AgentDesktopView
          target={target.id}
          canView={status.viewAllowed}
          canControl={status.controlAllowed}
        />
      )}
      {error && (
        <ErrorNotice title="应用能力操作未完成" error={error} />
      )}
    </section>
  );
}
