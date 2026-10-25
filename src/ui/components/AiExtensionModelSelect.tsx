import { useState } from 'react';
import { useExtensionCatalog } from '../use-extension-catalog';
import './AiExtensionModelSelect.css';
export function AiExtensionModelSelect({
  extension,
  onChange,
}: {
  extension: { id: string; model: string };
  onChange: (ref: string, model: string) => void;
}) {
  const [query, setQuery] = useState('');
  const { catalog, loading, error, refresh } = useExtensionCatalog(extension);
  const choices = catalog?.choices ?? [];
  const current = catalog?.current;
  const filtered = choices.filter(
    (c) => c.ref !== current?.ref && c.model.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="ai-extension-model-picker">
      <label>
        查找扩展模型
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按模型名称搜索"
        />
      </label>
      <label>
        扩展模型
        <select
          aria-label="扩展模型"
          value={current?.ref ?? extension.model}
          disabled={loading}
          onChange={(e) => {
            const c = choices.find((c) => c.ref === e.target.value);
            if (c?.available) onChange(c.ref, c.model);
          }}
        >
          <option value={current?.ref ?? extension.model} disabled={!current?.available}>
            {current?.model ?? extension.model}{loading ? ' · 正在确认' : current?.available ? '' : ' · 当前不可用'}
          </option>
          {filtered.map((c) => (
            <option key={c.ref} value={c.ref} disabled={!c.available}>
              {c.model}
              {c.available ? '' : ` · ${c.reason || '当前不可用'}`}
            </option>
          ))}
        </select>
      </label>
      {query && !filtered.length && <small>没有其他匹配模型</small>}
      {!loading && current?.reason && <small role="status">{current.reason}</small>}
      {error && <small role="alert">{error}</small>}
      <button type="button" disabled={loading} onClick={refresh}>刷新模型目录</button>
    </div>
  );
}

/** Runtime catalog status is not written into account/cloud configuration. */
export function AiExtensionProviderStatus({ extension }: { extension: { id: string; model: string } }) {
  const { catalog, loading, error } = useExtensionCatalog(extension);
  if (loading) return <small>正在确认模型目录…</small>;
  const reason = error || catalog?.current.reason;
  if (!reason) return null;
  return <small role="status" title={reason}>{reason} · 点击重新选择</small>;
}
