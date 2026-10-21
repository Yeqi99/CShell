import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Languages, Sparkles, X } from 'lucide-react';
import { type TextAssistTarget, translationChunks, analyzeSelection } from '../text-assist';
import { AiMarkdown } from './AiMarkdown';
import './text-assist.css';
import { useAiProviders } from '../use-ai-providers';

export function TextAssist() {
  const aiAvailable = useAiProviders().providers.length > 0;
  const [target, setTarget] = useState<TextAssistTarget | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: TextAssistTarget } | null>(null);
  const [intent, setIntent] = useState(''),
    [ideas, setIdeas] = useState<string[]>([]);
  const [choices, setChoices] = useState<string[]>([]),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [automatic, setAutomatic] = useState(false);
  const [original, setOriginal] = useState(false),
    [language, setLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
  const [source, setSource] = useState(''),
    [translations, setTranslations] = useState<Record<string, string>>({});
  const generation = useRef(0),
    cache = useRef<Record<string, string>>({});
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const open = (next: TextAssistTarget) => {
    generation.current++;
    setBusy(false);
    setTarget(next);
    setMenu(null);
    setIntent('');
    setIdeas([]);
    setChoices([]);
    setError('');
    setSource(next.text);
    setTranslations({});
    cache.current = {};
    setAutomatic(false);
    setOriginal(false);
  };
  const close = () => {
    generation.current++;
    setTarget(null);
    setBusy(false);
    setAutomatic(false);
  };
  useEffect(() => {
    if (!aiAvailable) {
      close();
      setMenu(null);
      return;
    }
    const requested = (e: Event) => open((e as CustomEvent<TextAssistTarget>).detail);
    const context = (e: MouseEvent) => {
      const element = e.target as HTMLElement;
      if (element.closest('.terminal-pane, .view-terminal, .text-assist, .text-assist-menu')) return;
      const input = element.closest('input,textarea') as
        HTMLInputElement | HTMLTextAreaElement | null;
      let next: TextAssistTarget | null = null;
      if (input && !input.disabled && !input.readOnly) {
        const sensitive =
          input.type === 'password' ||
          /password|secret|api.?key|token|密码|密钥/i.test(
            [input.name, input.id, input.getAttribute('aria-label'), input.placeholder].join(' '),
          );
        if (
          sensitive ||
          (input instanceof HTMLInputElement &&
            !['text', 'search', 'url', 'email'].includes(input.type))
        )
          return;
        const before = input.value,
          start = input.selectionStart ?? before.length,
          end = input.selectionEnd ?? start;
        const apply = (value: string) => {
          if (!input.isConnected || input.value !== before)
            throw new Error('输入内容已变化，请在当前输入位置重新打开助手');
          const setter = Object.getOwnPropertyDescriptor(
            input instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype,
            'value',
          )!.set!;
          setter.call(input, before.slice(0, start) + value + before.slice(end));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
          input.setSelectionRange(start + value.length, start + value.length);
        };
        next = {
          mode: 'compose',
          text: before,
          label: input.getAttribute('aria-label') || input.placeholder || '输入框',
          apply,
          copy: before.slice(start, end),
          cut: () => {
            void window.cshell
              .copyText(before.slice(start, end))
              .then(() => apply(''))
              .catch((e) => setError(String(e)));
          },
          paste: () => {
            void window.cshell
              .pasteText()
              .then(apply)
              .catch((e) => setError(String(e)));
          },
        };
      } else {
        const selected = window.getSelection()?.toString().trim();
        if (selected) {
          const scope = element.closest('.agent-messages') ?? element.closest('.agent-markdown');
          next = {
            mode: 'translate',
            text: selected,
            label: '选中文字',
            ...(scope ? { read: () => (scope.isConnected ? scope.textContent || '' : null) } : {}),
          };
        }
      }
      if (!next) return;
      e.preventDefault();
      setMenu({
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - 210)),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - 100)),
        target: next,
      });
    };
    const dismiss = () => setMenu(null);
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('cshell:text-assist', requested);
    document.addEventListener('contextmenu', context);
    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('cshell:text-assist', requested);
      document.removeEventListener('contextmenu', context);
      document.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [aiAvailable]);
  useEffect(() => {
    if (!target || target.mode !== 'translate' || !automatic || !target.read) return;
    const update = () => {
      if (busyRef.current) return;
      const text = target.read!();
      if (text === null) {
        setAutomatic(false);
        return;
      }
      setSource(text);
    };
    update();
    const timer = setInterval(update, 1800);
    return () => clearInterval(timer);
  }, [target, automatic]);
  useEffect(() => {
    if (!target || target.mode !== 'translate') return;
    if (original) {
      setBusy(false);
      return;
    }
    const run = ++generation.current;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        setBusy(true);
        setError('');
        try {
          for (const chunk of translationChunks(source)) {
            if (cancelled) break;
            const key = language + '\0' + chunk;
            if (!cache.current[key]) {
              const result = await window.cshell.aiText({
                kind: 'translate',
                text: chunk,
                language,
              });
              if (cancelled || run !== generation.current) return;
              cache.current[key] = result.text;
              if (Object.keys(cache.current).length > 1024)
                delete cache.current[Object.keys(cache.current)[0]];
            }
            setTranslations({ ...cache.current });
          }
        } catch (e) {
          if (!cancelled) {
            setError(String(e));
            setAutomatic(false);
          }
        } finally {
          if (!cancelled && run === generation.current) setBusy(false);
        }
      },
      automatic ? 800 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, target, language, original]);
  const suggest = async () => {
    if (!target || !intent.trim() || busy) return;
    const run = ++generation.current,
      next = [...ideas, intent.trim()].slice(-12);
    setIdeas(next);
    setIntent('');
    setBusy(true);
    setError('');
    try {
      const result = await window.cshell.aiText({
        kind: 'compose',
        text: next[0],
        context: target.label + '\n' + target.text.slice(0, 3500),
        ideas: next.slice(1),
      });
      if (run === generation.current) setChoices(result.choices);
    } catch (e) {
      if (run === generation.current) setError(String(e));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  };
  return (
    <>
      {menu && (
        <div className="text-assist-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          {!!(menu.target.copy ?? menu.target.text) && (
            <button
              role="menuitem"
              onClick={() => analyzeSelection(menu.target.copy ?? menu.target.text, menu.target.sessionId)}
            >
              <Sparkles size={15} />
              AI 分析
            </button>
          )}
          <button role="menuitem" onClick={() => open(menu.target)}>
            {menu.target.mode === 'translate' ? <Languages size={15} /> : <Sparkles size={15} />}{' '}
            {menu.target.mode === 'translate' ? 'AI 翻译' : '我想……'}
          </button>
          <button
            role="menuitem"
            disabled={!(menu.target.copy ?? menu.target.text)}
            onClick={() => {
              void window.cshell.copyText(menu.target.copy ?? menu.target.text);
            }}
          >
            复制
          </button>
          {menu.target.cut && (
            <button role="menuitem" disabled={!menu.target.copy} onClick={menu.target.cut}>
              剪切
            </button>
          )}
          {menu.target.paste && (
            <button role="menuitem" onClick={menu.target.paste}>
              粘贴
            </button>
          )}
        </div>
      )}
      {target && (
        <section
          className="text-assist"
          role="region"
          aria-label={target.mode === 'translate' ? 'AI 翻译' : '我想……'}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <header>
            {target.mode === 'translate' ? <Languages size={17} /> : <Sparkles size={17} />}
            <strong>{target.mode === 'translate' ? 'AI 翻译' : '我想……'}</strong>
            <span title={target.label}>{target.label}</span>
            <button className="icon" aria-label="关闭文字助手" title="关闭 · Esc" onClick={close}>
              <X size={16} />
            </button>
          </header>
          {target.mode === 'translate' ? (
            <>
              <div className="text-assist-controls">
                <button aria-pressed={!original} onClick={() => setOriginal(false)}>
                  译文
                </button>
                <button aria-pressed={original} onClick={() => setOriginal(true)}>
                  原文
                </button>
                <select
                  aria-label="翻译语言"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as typeof language)}
                >
                  <option value="zh-CN">中文</option>
                  <option value="en">English</option>
                </select>
                {target.read && (
                  <label>
                    <input
                      type="checkbox"
                      checked={automatic}
                      onChange={(e) => setAutomatic(e.target.checked)}
                    />
                    自动翻译增量
                  </label>
                )}
              </div>
              <div className="text-assist-result">
                {original ? (
                  <pre>{source}</pre>
                ) : (
                  translationChunks(source).map((chunk, index) => (
                    <div key={index}>
                      {translations[language + '\0' + chunk] ? (
                        <AiMarkdown text={translations[language + '\0' + chunk]} />
                      ) : (
                        <pre className="muted">{chunk}</pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {!!ideas.length && <div className="text-assist-intent">{ideas.join(' · ')}</div>}
              <div className="text-assist-choices">
                {choices.map((choice, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      try {
                        target.apply?.(choice);
                        close();
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    <span>{choice}</span>
                    <Check size={15} />
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void suggest();
                }}
              >
                <textarea
                  autoFocus
                  aria-label="描述想法"
                  placeholder={ideas.length ? '补充想法，继续优化……' : '描述你想输入的内容……'}
                  value={intent}
                  maxLength={2000}
                  onChange={(e) => setIntent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void suggest();
                    }
                  }}
                />
                <button
                  className="primary icon"
                  disabled={busy || !intent.trim()}
                  aria-label="生成候选"
                >
                  <ArrowUp size={17} />
                </button>
              </form>
              <small>选择候选后填入原输入位置，不自动执行。</small>
            </>
          )}
          {(busy || error) && (
            <footer role="status">
              {error || (target.mode === 'translate' ? '正在翻译……' : '正在生成候选……')}
            </footer>
          )}
        </section>
      )}
    </>
  );
}
