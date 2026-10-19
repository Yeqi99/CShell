import { useEffect, useState } from 'react';
import './AiExtensionModelSelect.css';
export function AiExtensionModelSelect({
  extension,
  onChange,
}: {
  extension: { id: string; model: string };
  onChange: (ref: string, model: string) => void;
}) {
  const [choices, setChoices] = useState<{ ref: string; model: string; available: boolean }[]>([]),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setChoices([]);
    void window.cshell
      .aiExtensionCall(extension.id, 'choices', { reference: extension.model })
      .then((v) => {
        if (active) setChoices(v as typeof choices);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [extension.id, extension.model]);
  const filtered = choices.filter(
    (c) => c.ref !== extension.model && c.model.toLowerCase().includes(query.toLowerCase()),
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
          value={extension.model}
          onChange={(e) => {
            const c = choices.find((c) => c.ref === e.target.value);
            if (c) onChange(c.ref, c.model);
          }}
        >
          <option value={extension.model}>
            {choices.find((c) => c.ref === extension.model)?.model ?? extension.model}
          </option>
          {filtered.map((c) => (
            <option key={c.ref} value={c.ref} disabled={!c.available}>
              {c.model}
              {c.available ? '' : ' · 协议待适配'}
            </option>
          ))}
        </select>
      </label>
      {query && !filtered.length && <small>没有其他匹配模型</small>}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
