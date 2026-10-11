import { Modal } from './Modal';
import { useRef, useState, type ReactNode } from 'react';
import {
  TextCursorInput,
  MousePointer2,
  ArrowUpToLine,
  ArrowDownToLine,
  Search,
  ChevronUp,
  ChevronDown,
  ListOrdered,
  Undo2,
  Redo2,
  Save,
  MoreHorizontal,
  LogOut,
  Check,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type { EditorDetection, EditorKind } from '../editor-detection';
import type { EditorAction } from '../editor-actions';
export type AssistantChoice = 'auto' | 'vim' | 'nano' | 'off';
export function EditorAssistant({
  detected,
  choice,
  onChoice,
  children,
  onFocusTerminal,
  onAction,
}: {
  detected: EditorDetection | null;
  choice: AssistantChoice;
  onChoice: (value: AssistantChoice) => void;
  children: ReactNode;
  onFocusTerminal: () => void;
  onAction: (
    kind: EditorKind,
    action: EditorAction,
    value: string,
    modern: boolean,
    nanoSearch: 'Ctrl+W' | 'Ctrl+F',
  ) => Promise<void>;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [discard, setDiscard] = useState(false);
  const [more, setMore] = useState(false);
  const [entry, setEntry] = useState<'search' | 'line' | null>(null);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState('');
  const [nanoOverride, setNanoOverride] = useState('auto');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const kind = choice === 'auto' ? detected?.kind : choice === 'off' ? null : choice;
  const modern = nanoOverride === 'modern' || (nanoOverride === 'auto' && !!detected?.nanoModern);
  const label = kind === 'vim' ? 'Vim' : 'Nano';
  const act = async (action: EditorAction, value = '') => {
    if (!kind || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await onAction(kind, action, value, modern, detected?.nanoSearch || 'Ctrl+W');
      setEntry(null);
      setMore(false);
      onFocusTerminal();
    } catch (e) {
      const code = (e as Error).message;
      setError(
        code === 'INVALID_LINE'
          ? zh
            ? '请输入有效行号'
            : 'Enter a valid line number'
          : code === 'INVALID_SEARCH'
            ? zh
              ? '请输入单行搜索内容'
              : 'Enter a single-line search term'
            : code === 'EDITOR_PROMPT'
              ? zh
                ? '编辑器正在等待输入'
                : 'The editor is waiting for input'
              : code === 'EDITOR_INACTIVE'
                ? zh
                  ? '当前编辑器已离开或不可用'
                  : 'The editor is no longer active'
                : zh
                  ? '操作未发送，请重试'
                  : 'Could not send action. Try again.',
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const openEntry = (next: 'search' | 'line') => {
    setError('');
    setMore(false);
    if (kind === 'nano') void act(next);
    else setEntry(entry === next ? null : next);
  };
  const button = (action: EditorAction, text: string, key: string, icon: ReactNode) => (
    <button
      key={action}
      className="icon"
      aria-label={text}
      title={`${text}${key ? ` · ${key}` : ''}`}
      disabled={busy}
      onClick={() =>
        action === 'search' || action === 'line' ? openEntry(action) : void act(action)
      }
    >
      {icon}
    </button>
  );
  return (
    <div className="terminal-editor-layout">
      {discard && (
        <Modal
          title={zh ? '放弃修改并退出 Vim' : 'Discard changes & exit Vim'}
          onClose={() => setDiscard(false)}
        >
          <p>
            {zh ? '所有未保存的缓冲区修改都会丢失。' : 'All unsaved buffer changes will be lost.'}
          </p>
          <footer>
            <button onClick={() => setDiscard(false)}>{zh ? '取消' : 'Cancel'}</button>
            <button
              className="danger"
              onClick={() => {
                setDiscard(false);
                void act('discard');
              }}
            >
              {zh ? '放弃并退出' : 'Discard & exit'}
            </button>
          </footer>
        </Modal>
      )}
      <div className="terminal-editor-main">
        {children}
        {kind && (
          <div
            className="editor-actions"
            aria-label={zh ? `${label} 操作面板` : `${label} actions`}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEntry(null);
                setMore(false);
                setError('');
                onFocusTerminal();
              }
            }}
          >
            {error && (
              <div className="editor-action-error" role="alert">
                {error}
                <button
                  className="icon"
                  aria-label={zh ? '关闭错误' : 'Dismiss error'}
                  onClick={() => {
                    setError('');
                    onFocusTerminal();
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {entry && (
              <form
                className="editor-action-entry"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(entry, entry === 'search' ? query : line);
                }}
              >
                {entry === 'search' ? <Search size={14} /> : <ListOrdered size={14} />}
                <input
                  key={entry}
                  autoFocus
                  aria-label={
                    zh
                      ? entry === 'search'
                        ? '搜索文件内容'
                        : '目标行号'
                      : entry === 'search'
                        ? 'Search file'
                        : 'Line number'
                  }
                  placeholder={
                    zh
                      ? entry === 'search'
                        ? '搜索文件内容…'
                        : '跳到行…'
                      : entry === 'search'
                        ? 'Search file…'
                        : 'Go to line…'
                  }
                  value={entry === 'search' ? query : line}
                  maxLength={entry === 'search' ? 512 : 9}
                  inputMode={entry === 'line' ? 'numeric' : 'text'}
                  onChange={(e) =>
                    entry === 'search' ? setQuery(e.target.value) : setLine(e.target.value)
                  }
                />
                <button
                  className="icon"
                  aria-label={zh ? '执行' : 'Run'}
                  title={zh ? '执行 · Enter' : 'Run · Enter'}
                  disabled={busy}
                >
                  <Check size={14} />
                </button>
                <button
                  className="icon"
                  type="button"
                  aria-label={zh ? '关闭输入' : 'Close input'}
                  onClick={() => {
                    setEntry(null);
                    onFocusTerminal();
                  }}
                >
                  <X size={14} />
                </button>
              </form>
            )}
            {more && (
              <div className="editor-action-more">
                {kind === 'vim' && (
                  <>
                    <select
                      aria-label={zh ? '切换 Vim 模式' : 'Switch Vim mode'}
                      value=""
                      onChange={(e) => {
                        void act(e.target.value as EditorAction);
                      }}
                    >
                      <option value="" disabled>
                        {zh ? '切换模式' : 'Switch mode'}
                      </option>
                      {(
                        [
                          ['append', '行尾插入', 'Append'],
                          ['visual', '字符选择', 'Visual'],
                          ['visualLine', '整行选择', 'Visual line'],
                          ['visualBlock', '块选择', 'Visual block'],
                          ['replace', '替换模式', 'Replace'],
                        ] as const
                      ).map(([value, cn, en]) => (
                        <option key={value} value={value}>
                          {zh ? cn : en}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => void act('exitAll')}>
                      {zh ? '退出所有窗口' : 'Exit all windows'}
                    </button>
                    <button onClick={() => void act('saveExitAll')}>
                      {zh ? '全部保存并退出' : 'Save all & exit'}
                    </button>
                    <button className="danger" onClick={() => setDiscard(true)}>
                      {zh ? '放弃修改并退出' : 'Discard & exit'}
                    </button>
                  </>
                )}
                {kind === 'vim' && (
                  <button onClick={() => void act('saveExit')} disabled={busy}>
                    <Save size={13} />
                    {zh ? '保存并退出' : 'Save & exit'}
                  </button>
                )}
                <select
                  aria-label={zh ? '编辑器模式' : 'Editor mode'}
                  value={choice}
                  onChange={(e) => {
                    onChoice(e.target.value as AssistantChoice);
                    setMore(false);
                    setEntry(null);
                  }}
                >
                  <option value="auto">{zh ? '自动识别' : 'Automatic'}</option>
                  <option value="vim">Vim</option>
                  <option value="nano">Nano</option>
                  <option value="off">{zh ? '关闭面板' : 'Off'}</option>
                </select>
                {kind === 'nano' && (
                  <select
                    aria-label={zh ? 'Nano 按键方案' : 'Nano key bindings'}
                    value={nanoOverride}
                    onChange={(e) => setNanoOverride(e.target.value)}
                  >
                    <option value="auto">{zh ? '自动键位' : 'Auto bindings'}</option>
                    <option value="classic">{zh ? '默认键位' : 'Default bindings'}</option>
                    <option value="modern">{zh ? '现代键位' : 'Modern bindings'}</option>
                  </select>
                )}
              </div>
            )}
            <div
              className="editor-action-toolbar"
              role="toolbar"
              aria-label={zh ? '编辑器操作' : 'Editor actions'}
            >
              <span className="editor-action-brand">{label}</span>
              <div className="editor-action-group">
                {button(
                  kind === 'vim' ? 'normal' : 'cancel',
                  zh
                    ? kind === 'vim'
                      ? '退出当前模式'
                      : '取消当前操作'
                    : kind === 'vim'
                      ? 'Normal mode'
                      : 'Cancel prompt',
                  kind === 'vim' ? 'Esc' : 'Ctrl+C',
                  <MousePointer2 size={15} />,
                )}
                {kind === 'vim' &&
                  button(
                    'insert',
                    zh ? '插入模式' : 'Insert mode',
                    'i',
                    <TextCursorInput size={15} />,
                  )}
              </div>
              <div className="editor-action-group">
                {button(
                  'first',
                  zh ? '文件开头' : 'First line',
                  kind === 'vim' ? 'gg' : 'Alt+\\',
                  <ArrowUpToLine size={15} />,
                )}
                {button(
                  'last',
                  zh ? '文件结尾' : 'Last line',
                  kind === 'vim' ? 'G' : 'Alt+/',
                  <ArrowDownToLine size={15} />,
                )}
                {button('line', zh ? '跳到行' : 'Go to line', '', <ListOrdered size={15} />)}
              </div>
              <div className="editor-action-group">
                {button(
                  'search',
                  zh ? '搜索' : 'Search',
                  kind === 'vim' ? '/' : modern ? 'Ctrl+F' : detected?.nanoSearch || 'Ctrl+W',
                  <Search size={15} />,
                )}
                {kind === 'vim' &&
                  button(
                    'previous',
                    zh ? '上一个匹配' : 'Previous match',
                    'N',
                    <ChevronUp size={15} />,
                  )}
                {button(
                  'next',
                  zh ? '下一个匹配' : 'Next match',
                  kind === 'vim' ? 'n' : '',
                  <ChevronDown size={15} />,
                )}
              </div>
              <div className="editor-action-group">
                {button(
                  'undo',
                  zh ? '撤销' : 'Undo',
                  kind === 'vim' ? 'u' : modern ? 'Ctrl+Z' : 'Alt+U',
                  <Undo2 size={15} />,
                )}
                {button(
                  'redo',
                  zh ? '重做' : 'Redo',
                  kind === 'vim' ? 'Ctrl+R' : modern ? 'Ctrl+Y' : 'Alt+E',
                  <Redo2 size={15} />,
                )}
                {button(
                  'save',
                  zh ? '保存文件' : 'Save file',
                  kind === 'vim' ? ':w' : modern ? 'Ctrl+S' : 'Ctrl+O',
                  <Save size={15} />,
                )}
              </div>
              {button(
                'exit',
                zh ? '退出编辑器' : 'Exit editor',
                kind === 'vim' ? ':q' : modern ? 'Ctrl+Q' : 'Ctrl+X',
                <LogOut size={15} />,
              )}
              <button
                className="icon editor-action-menu"
                aria-label={zh ? '更多操作' : 'More actions'}
                title={zh ? '更多操作' : 'More actions'}
                aria-expanded={more}
                onClick={() => {
                  setMore((v) => !v);
                  setEntry(null);
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
