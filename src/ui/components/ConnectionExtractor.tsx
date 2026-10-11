import { useEffect, useState } from 'react';
import { ClipboardPaste, Sparkles, X } from 'lucide-react';
import type { AiProvider } from '../../shared/ai';
import type { ExtractedConnection } from '../../shared/connection-extraction';
import { useI18n } from '../i18n';
export function ConnectionExtractor({
  onExtract,
  onBusy,
}: {
  onExtract: (value: ExtractedConnection) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { locale } = useI18n(),
    cn = locale === 'zh-CN';
  const [providers, setProviders] = useState<AiProvider[]>([]),
    [provider, setProvider] = useState('');
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void window.cshell
      .aiSnapshot()
      .then((snapshot) => {
        if (disposed) return;
        setProviders(snapshot.providers);
        const preferred = snapshot.extractionProviderId;
        setProvider((current) =>
          snapshot.providers.some((p) => p.id === current)
            ? current
            : snapshot.providers.find((p) => p.id === preferred)?.id ||
              snapshot.providers[0]?.id ||
              '',
        );
      })
      .catch(() => {
        if (!disposed) setError(cn ? '无法读取 AI 基座' : 'Could not load AI providers');
      });
    return () => {
      disposed = true;
    };
  }, [open]);
  const extract = async () => {
    if (busy || !provider || !text.trim()) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const result = await window.cshell.aiExtractConnection(text, provider);
      onExtract(result);
      setText('');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <div className="connection-ai-extractor">
      <button
        type="button"
        className="connection-extract"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
      >
        <Sparkles size={14} />
        {cn ? '从文本智能填写' : 'Fill from text'}
      </button>
      {open && (
        <section
          className="connection-extract-panel"
          aria-label={cn ? '连接信息提取' : 'Extract connection'}
        >
          <header>
            <span>{cn ? 'SSH 连接信息' : 'SSH connection details'}</span>
            <button
              type="button"
              className="icon"
              aria-label={cn ? '关闭提取' : 'Close extraction'}
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              <X size={13} />
            </button>
          </header>
          {providers.length ? (
            <>
              <textarea
                aria-label={cn ? '待提取文本' : 'Connection text'}
                placeholder={
                  cn ? '粘贴服务器地址、账号、端口等信息…' : 'Paste server address, account, port…'
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={24000}
                disabled={busy}
              />
              <div className="connection-extract-controls">
                <button
                  type="button"
                  className="icon"
                  title={cn ? '粘贴' : 'Paste'}
                  aria-label={cn ? '粘贴连接信息' : 'Paste connection text'}
                  disabled={busy}
                  onClick={() =>
                    void window.cshell
                      .pasteText()
                      .then(setText)
                      .catch(() => setError(cn ? '无法读取剪贴板' : 'Clipboard unavailable'))
                  }
                >
                  <ClipboardPaste size={14} />
                </button>
                <select
                  aria-label={cn ? '提取使用的 AI 基座' : 'Extraction AI provider'}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  disabled={busy}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !text.trim()}
                  onClick={() => void extract()}
                >
                  {busy ? (cn ? '识别中…' : 'Extracting…') : cn ? '提取并填写' : 'Extract & fill'}
                </button>
              </div>
              <small>
                {cn
                  ? '文本会发送至所选基座，仅填写表单，不自动连接。'
                  : 'Text is sent to the selected provider. Fills the form without connecting.'}
              </small>
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => window.dispatchEvent(new Event('cshell:open-ai'))}
            >
              {cn ? '配置 AI 基座' : 'Configure an AI provider'}
            </button>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
