import { useState } from 'react';
import { ClipboardPaste, ScanText, Sparkles, X } from 'lucide-react';
import type { ExtractedConnection } from '../../shared/connection-extraction';
import { ConnectionRuleError, extractConnectionByRules } from '../../shared/connection-rules';
import { useAiProviders } from '../use-ai-providers';
import { useI18n } from '../i18n';

export function ConnectionExtractor({
  title,
  titleId,
  disabled,
  onStart,
  onExtract,
  onBusy,
}: {
  title: string;
  titleId: string;
  disabled: boolean;
  onStart: () => void;
  onExtract: (value: ExtractedConnection) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { locale } = useI18n(),
    cn = locale === 'zh-CN';
  const { providers, extractionProviderId } = useAiProviders();
  const [provider, setProvider] = useState('');
  const [mode, setMode] = useState<'rules' | 'ai'>('rules');
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const ai = mode === 'ai' && providers.length > 0;
  const selected =
    providers.find((p) => p.id === provider) ??
    providers.find((p) => p.id === extractionProviderId) ??
    providers[0];
  const locked = busy || disabled;
  const paste = async () => {
    onStart();
    setOpen(true);
    setError('');
    try {
      setText((await window.cshell.pasteText()).slice(0, 24000));
    } catch {
      setError(cn ? '无法读取剪贴板，请手动粘贴。' : 'Clipboard unavailable. Paste text manually.');
    }
  };
  const extract = async () => {
    if (locked || !text.trim()) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const result = ai
        ? await window.cshell.aiExtractConnection(text, selected.id)
        : extractConnectionByRules(text);
      onExtract(result);
      setText('');
      setOpen(false);
    } catch (e) {
      if (e instanceof ConnectionRuleError) {
        const errors = {
          empty: cn ? '请先粘贴连接信息。' : 'Paste connection information first.',
          unsupported: cn
            ? '未找到可识别的 SSH 信息。请使用 SSH 命令，或“主机、端口、用户名”等字段标签。'
            : 'No SSH details found. Use an SSH command or labelled Host, Port and Username fields.',
          ambiguous: cn
            ? '发现多组或相互冲突的连接信息，请仅保留一个目标后重试。'
            : 'Conflicting connection details found. Keep only one target and retry.',
          invalid: cn
            ? '连接信息格式有误，请检查主机地址和端口（1–65535）。'
            : 'Check the host and port (1–65535).',
        };
        setError(errors[e.reason]);
      } else
        setError(
          (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''),
        );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <div className="connection-ai-extractor">
      <header className="connection-heading">
        <h1 id={titleId}>{title}</h1>
        <div className="connection-extract-actions">
          <button
            type="button"
            className="connection-extract"
            aria-expanded={open}
            disabled={locked}
            onClick={() => {
              onStart();
              setOpen(!open);
              setError('');
            }}
          >
            <ScanText size={14} />
            {cn ? '从文本填写' : 'Fill from text'}
          </button>
          <button
            type="button"
            className="icon"
            title={cn ? '粘贴连接信息' : 'Paste connection text'}
            aria-label={cn ? '粘贴连接信息' : 'Paste connection text'}
            disabled={locked}
            onClick={() => void paste()}
          >
            <ClipboardPaste size={14} />
          </button>
        </div>
      </header>
      {open && (
        <section
          className="connection-extract-panel"
          aria-label={cn ? '连接信息提取' : 'Extract connection'}
        >
          <header>
            <div
              className="connection-extract-modes"
              role="group"
              aria-label={cn ? '读取方式' : 'Extraction method'}
            >
              <button
                type="button"
                aria-pressed={!ai}
                disabled={locked}
                onClick={() => {
                  setMode('rules');
                  setError('');
                }}
              >
                <ScanText size={14} />
                {cn ? '本地规则' : 'Local rules'}
              </button>
              {providers.length > 0 && (
                <button
                  type="button"
                  aria-pressed={ai}
                  disabled={locked}
                  onClick={() => {
                    setMode('ai');
                    setError('');
                  }}
                >
                  <Sparkles size={14} />
                  {cn ? 'AI 模型' : 'AI model'}
                </button>
              )}
            </div>
            <button
              type="button"
              className="icon"
              title={cn ? '关闭提取' : 'Close extraction'}
              aria-label={cn ? '关闭提取' : 'Close extraction'}
              disabled={locked}
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          {ai && (
            <label className="connection-extract-model">
              {cn ? '解析模型' : 'Model'}
              <select
                aria-label={cn ? '提取使用的 AI 基座' : 'Extraction AI provider'}
                value={selected.id}
                disabled={locked}
                onChange={(e) => setProvider(e.target.value)}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model}
                  </option>
                ))}
              </select>
            </label>
          )}
          <textarea
            aria-label={cn ? '待提取文本' : 'Connection text'}
            autoFocus
            placeholder={
              cn
                ? 'ssh user@host -p 2222\n或粘贴：主机: example.com  端口: 22  用户名: root'
                : 'ssh user@host -p 2222\nOr: Host: example.com  Port: 22  Username: root'
            }
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            maxLength={24000}
            disabled={locked}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="connection-extract-controls">
            <small>
              {ai
                ? cn
                  ? '发送至所选模型，提取后可继续修改。'
                  : 'Sent to the selected model. Review and edit after extraction.'
                : cn
                  ? '在本机匹配关键词与格式，无需 AI。'
                  : 'Matches labels and formats locally. No AI required.'}
            </small>
            <button
              type="button"
              className="primary"
              disabled={locked || !text.trim()}
              onClick={() => void extract()}
            >
              {busy ? (cn ? '识别中…' : 'Extracting…') : cn ? '提取并填写' : 'Extract & fill'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
