import { useState } from 'react';
import { ChevronDown, Check, ShieldCheck, Folder, Server } from 'lucide-react';
import {
  aiLocations,
  aiCapabilities,
  type AiLocation,
  type AiPermission,
  type AiSnapshot,
} from '../../shared/ai';
import type { Profile } from '../../shared/contracts';
const names = { workspace: '工作台', terminal: '终端', files: '文件', python: 'Python 插件' };
const tools = {
  'metrics.read': '读取资源指标',
  'files.read': '读取文件',
  'commands.execute': '执行命令与修改文件',
};
export function AiPermissionTree({
  snapshot,
  profiles,
  groups,
  refresh,
}: {
  snapshot: AiSnapshot;
  profiles: Profile[];
  groups: string[];
  refresh: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Partial<Record<AiLocation, AiPermission>>>({});
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(''),
    [failed, setFailed] = useState(false);
  const value = (location: AiLocation): AiPermission =>
    drafts[location] ??
    snapshot.permissions.find((p) => p.location === location) ?? {
      location,
      providerId: null,
      capabilities: [],
      groups: [],
      profiles: [],
    };
  const edit = (p: AiPermission) => {
    setDrafts((d) => ({ ...d, [p.location]: p }));
    setFeedback('');
    setFailed(false);
  };
  const toggle = <T extends string>(list: T[], id: T, enabled: boolean) =>
    enabled ? [...new Set([...list, id])] : list.filter((x) => x !== id);
  const save = async () => {
    setBusy(true);
    setFailed(false);
    setFeedback('正在保存…');
    let count = 0;
    try {
      for (const location of aiLocations) {
        const draft = drafts[location];
        if (!draft) continue;
        await window.cshell.aiPermissionSave(draft);
        count++;
      }
      await refresh();
      setDrafts({});
      setFeedback('权限已保存');
    } catch (e) {
      setFailed(true);
      setFeedback(
        `${count ? '部分配置已保存；' : ''}保存失败：${(e as Error).message}。修改已保留，可重试。`,
      );
    } finally {
      setBusy(false);
    }
  };
  const categories = [...new Set([...groups, ...profiles.map((p) => p.group)])];
  return (
    <section className="permission-tree" aria-label="权限节点">
      <div className="ai-section-heading">
        <h3>访问权限</h3>
        <ShieldCheck size={16} />
      </div>
      <p className="ai-section-note">直接勾选允许使用的工具和机器。审核策略不会扩大授权范围。</p>
      <fieldset disabled={busy} className="permission-tree-nodes">
        {aiLocations.map((location) => {
          const p = value(location);
          return (
            <details open key={location} className="permission-tree-root">
              <summary>
                <ChevronDown size={14} />
                <strong>{names[location]}</strong>
                <small>
                  {p.capabilities.length} 项工具 · {p.groups.length} 个分组 · {p.profiles.length}{' '}
                  台单独授权
                </small>
              </summary>
              <div className="permission-tree-children">
                <label className="permission-model">
                  默认基座
                  <select
                    aria-label={`${names[location]}默认基座`}
                    value={p.providerId ?? ''}
                    onChange={(e) => edit({ ...p, providerId: e.target.value || null })}
                  >
                    <option value="">手动选择</option>
                    {snapshot.providers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="permission-tree-branch">
                  <strong>工具操作</strong>
                  {aiCapabilities.map((c) => (
                    <label key={c}>
                      <input
                        type="checkbox"
                        aria-label={`${names[location]}：${tools[c]}`}
                        checked={p.capabilities.includes(c)}
                        onChange={(e) =>
                          edit({ ...p, capabilities: toggle(p.capabilities, c, e.target.checked) })
                        }
                      />
                      <span>{tools[c]}</span>
                    </label>
                  ))}
                </div>
                <div className="permission-tree-branch">
                  <strong>机器范围</strong>
                  {!categories.length && <p className="muted">保存连接后，可在这里授权机器。</p>}
                  {categories.map((group) => {
                    const inherited = p.groups.includes(group);
                    return (
                      <div key={group} className="permission-machine-group">
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`${names[location]}：分组 ${group || '未分组'}`}
                            checked={inherited}
                            onChange={(e) =>
                              edit({ ...p, groups: toggle(p.groups, group, e.target.checked) })
                            }
                          />
                          <Folder size={14} />
                          <span>{group || '未分组'}</span>
                          <small>含以后加入的机器</small>
                        </label>
                        <div className="permission-machine-leaves">
                          {profiles
                            .filter((m) => m.group === group)
                            .map((m) => (
                              <label key={m.id}>
                                <input
                                  type="checkbox"
                                  aria-label={`${names[location]}：机器 ${m.name}`}
                                  disabled={inherited}
                                  checked={inherited || p.profiles.includes(m.id)}
                                  onChange={(e) =>
                                    edit({
                                      ...p,
                                      profiles: toggle(p.profiles, m.id, e.target.checked),
                                    })
                                  }
                                />
                                <Server size={13} />
                                <span>
                                  {m.name}
                                  <small>{m.host}</small>
                                </span>
                                {inherited && <small>分组已授权</small>}
                              </label>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </details>
          );
        })}
      </fieldset>
      <footer className="permission-tree-footer">
        <span role={failed ? 'alert' : 'status'} className={failed ? 'form-error' : ''}>
          {feedback || (Object.keys(drafts).length ? '有未保存的修改' : '未勾选的能力不可调用')}
        </span>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          <Check size={14} />
          {busy ? '保存中…' : '保存权限'}
        </button>
      </footer>
    </section>
  );
}
