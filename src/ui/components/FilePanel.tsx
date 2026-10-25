import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Download,
  Upload,
  FolderPlus,
  RefreshCw,
  Folder,
  File,
  MoreHorizontal,
  Copy,
  ClipboardPaste,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { FileEntry, FileRef, Transfer } from '../../shared/contracts';
import { useI18n } from '../i18n';
const TextFileEditor = lazy(() => import('./TextFileEditor').then(module => ({default: module.TextFileEditor})));
import { textCandidate } from '../text-path';
import {
  copyFiles,
  pastedFiles,
  dragFiles,
  draggedFiles,
  fileDragType,
  filesChanged,
} from '../fileClipboard';
export function FilePanel({
  sessionId,
  transfers,
  localRoot,
  closed = false,
  disableEnvironment = false,
}: {
  sessionId: string;
  transfers: Transfer[];
  onError: (e: unknown) => void;
  localRoot?: string;
  closed?: boolean;
  disableEnvironment?: boolean;
}) {
  const { t, locale } = useI18n();
  const [editors, setEditors] = useState<string[]>([]);
  const [activeEditor, setActiveEditor] = useState('');
  const [closingEditor, setClosingEditor] = useState('');
  const openText = (file: string) => {
    if (!editors.includes(file) && editors.length >= 6) {
      setError('最多同时打开 6 个文本文件，请先关闭不需要的编辑页。');return;
    }
    setEditors(current => current.includes(file) ? current : [...current, file]);
    setActiveEditor(file);
  };
  const [path, setPath] = useState('.'),
    [draft, setDraft] = useState('.'),
    [entries, setEntries] = useState<FileEntry[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState<string | null>(null),
    [action, setAction] = useState<'mkdir' | 'rename' | null>(null),
    [name, setName] = useState(''),
    [dropping, setDropping] = useState(false),
    [error, setError] = useState('');
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menu]);
  const sequence = useRef(0);
  const selectionAnchor = useRef<string | null>(null);
  const reportError = (e: unknown) =>
    setError(
      (e instanceof Error ? e.message : String(e)).replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      ),
    );
  const load = useCallback(
    async (next: string) => {
      if (closed) return;
      const request = ++sequence.current;
      setBusy(true);
      setError('');
      try {
        const result = await (localRoot
          ? window.cshell.localList(localRoot, next)
          : window.cshell.list(sessionId, next));
        if (request === sequence.current) {
          setEntries(result.entries);
          setPath(result.path);
          setDraft(result.path);
          setSelected([]);
        }
      } catch (e) {
        if (request === sequence.current) {
          setEntries([]);
          setSelected([]);
          reportError(e);
        }
      } finally {
        if (request === sequence.current) setBusy(false);
      }
    },
    [sessionId, localRoot, closed],
  );
  useEffect(() => {
    void load('.');
    return () => {
      sequence.current++;
    };
  }, [load]);
  const finished = transfers.filter((x) => x.state === 'done').length;
  useEffect(() => {
    if (finished) void load(path);
  }, [finished]);
  useEffect(() => {
    const handler = () => void load(path);
    window.addEventListener('cshell:files-changed', handler);
    return () => window.removeEventListener('cshell:files-changed', handler);
  }, [load, path]);
  const refFor = (value: string): FileRef =>
    localRoot
      ? { kind: 'local', root: localRoot, path: value }
      : { kind: 'remote', sessionId, path: value };
  const fileAction = (
    action: 'mkdir' | 'rename' | 'delete',
    value: string,
    destination?: string,
  ) =>
    localRoot
      ? window.cshell.localAction(localRoot, action, value, destination)
      : window.cshell.fileAction(sessionId, action, value, destination);
  const transfer = async (sources: FileRef[], destination: string, move = false) => {
    if (!sources.length) return;
    await window.cshell.transferFiles(sources, refFor(destination), move);
    filesChanged();
  };
  const dropped = (event: React.DragEvent, destination: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropping(false);
    if (event.dataTransfer.types.includes(fileDragType)) {
      const sources = draggedFiles();
      const same = sources.every((source) =>
        localRoot
          ? source.kind === 'local'
          : source.kind === 'remote' && source.sessionId === sessionId,
      );
      run(transfer(sources, destination, same && !event.ctrlKey && !event.metaKey));
    } else if (!localRoot) {
      const files = Array.from(event.dataTransfer.files);
      if (files.length)
        run(window.cshell.upload(sessionId, destination, window.cshell.droppedFiles(files)));
    }
  };
  const run = (operation: Promise<unknown>) => void operation.catch(reportError);
  const copyPath = () => run(window.cshell.copyText(selected.join('\n')));
  async function remove() {
    setMenu(null);
    for (const item of selected) await fileAction('delete', item);
    await load(path);
  }
  async function submit() {
    if (!name || /[\/\0]/.test(name) || name === '.' || name === '..')
      throw new Error(t('renameHint'));
    await fileAction(
      action!,
      action === 'mkdir' ? `${path.replace(/\/$/, '')}/${name}` : selected[0],
      action === 'rename' ? `${path.replace(/\/$/, '')}/${name}` : undefined,
    );
    setAction(null);
    setName('');
    await load(path);
  }
  return (<>
    {!!editors.length && <nav className="text-file-tabs" aria-label="文件编辑页">
      <button aria-pressed={!activeEditor} onClick={() => setActiveEditor('')}>文件</button>
      {editors.map(file => <span key={file}><button title={file} aria-pressed={file === activeEditor} onClick={() => setActiveEditor(file)}>{file.split('/').pop()}</button>
        <button aria-label={`关闭 ${file}`} title="关闭编辑页（请先保存）" onClick={() => {
          // Keep the draft until the user explicitly confirms closing it.
          setClosingEditor(file);
        }}><X size={13}/></button></span>)}
    </nav>}
    {closingEditor && <div className="text-editor-options" role="alert">关闭编辑页会丢弃未保存修改。
      <button onClick={() => setClosingEditor('')}>保留编辑页</button>
      <button onClick={() => { setEditors(current => current.filter(p => p !== closingEditor));if (activeEditor === closingEditor) setActiveEditor('');setClosingEditor(''); }}>关闭</button>
    </div>}
    <div
      hidden={!!activeEditor}
      className={`file-panel ${dropping ? 'drop-active' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setMenu(null);
          setAction(null);
        }
      }}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes(fileDragType) ||
          (!localRoot && e.dataTransfer.types.includes('Files'))
        ) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => dropped(e, path)}
    >
      <div className="file-toolbar">
        <button title={t('parent')} className="icon" onClick={() => void load(`${path}/..`)}>
          <ArrowUp size={16} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(draft);
          }}
        >
          <input aria-label={t('path')} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
        <button
          title={t('refresh')}
          className="icon"
          disabled={busy}
          onClick={() => void load(path)}
        >
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
        </button>
        <button
          className="icon"
          title={t('copyPath')}
          aria-label={t('copyPath')}
          onClick={() => run(window.cshell.copyText(path))}
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="file-actions">
        {!selected.length ? (
          <>
            {!localRoot && (
              <button
                className="icon"
                title={t('upload')}
                aria-label={t('upload')}
                onClick={() => run(window.cshell.upload(sessionId, path))}
              >
                <Upload size={14} />
              </button>
            )}
            <button
              className="icon"
              title={t('newFolder')}
              aria-label={t('newFolder')}
              onClick={() => {
                setName('');
                setAction('mkdir');
              }}
            >
              <FolderPlus size={15} />
            </button>
          </>
        ) : (
          <>
            {!localRoot && (
              <button
                className="icon"
                title={t('download')}
                aria-label={t('download')}
                onClick={() => run(window.cshell.download(sessionId, selected))}
              >
                <Download size={14} />
              </button>
            )}
            <button
              className="icon"
              title={t('copy')}
              aria-label={t('copy')}
              onClick={() => copyFiles(selected.map(refFor))}
            >
              <Copy size={14} />
            </button>
            <button
              className="icon"
              title={t('rename')}
              aria-label={t('rename')}
              disabled={selected.length !== 1}
              onClick={() => {
                setName(selected[0].split('/').pop()!);
                setAction('rename');
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon"
              title={t('delete')}
              aria-label={t('delete')}
              onClick={() => run(remove())}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
        <button
          className="icon"
          title={t('paste')}
          aria-label={t('paste')}
          onClick={() => run(transfer(pastedFiles(), path))}
        >
          <ClipboardPaste size={14} />
        </button>
      </div>
      {error && (
        <div className="file-inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void load(draft)}>{t('retry')}</button>
        </div>
      )}
      <div className="file-heading">
        <span>{t('fileName')}</span>
        <span>{t('size')}</span>
        <span>{t('modified')}</span>
      </div>
      <div
        className="file-list"
        tabIndex={0}
        aria-label={t('files')}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            e.stopPropagation();
            copyFiles(selected.map(refFor));
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            e.stopPropagation();
            run(transfer(pastedFiles(), path));
          }
          if (e.key === 'Delete' && selected.length) {
            e.preventDefault();
            run(remove());
          }
          if (e.key === 'F2' && selected.length === 1) {
            setName(selected[0].split('/').pop()!);
            setAction('rename');
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            setSelected(entries.map((x) => x.path));
          }
        }}
      >
        {entries.map((entry) => (
          <div
            role="button"
            tabIndex={0}
            key={entry.path}
            draggable={!entry.symlink}
            onDragStart={(e) => {
              const paths = selected.includes(entry.path) ? selected : [entry.path];
              dragFiles(paths.map(refFor));
              e.dataTransfer.setData(fileDragType, 'internal');
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
            onDragOver={(e) => {
              if (entry.directory) e.preventDefault();
            }}
            onDrop={(e) => {
              if (entry.directory) dropped(e, entry.path);
            }}
            className={`file-row ${selected.includes(entry.path) ? 'selected' : ''}`}
            title={`${entry.path}\n${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(entry.modified)}`}
            onClick={(e) => {
              if (e.shiftKey && selectionAnchor.current) {
                const start = entries.findIndex((item) => item.path === selectionAnchor.current),
                  end = entries.findIndex((item) => item.path === entry.path);
                if (start >= 0) {
                  setSelected(
                    entries
                      .slice(Math.min(start, end), Math.max(start, end) + 1)
                      .map((item) => item.path),
                  );
                  return;
                }
              }
              selectionAnchor.current = entry.path;
              setSelected(
                e.ctrlKey || e.metaKey
                  ? selected.includes(entry.path)
                    ? selected.filter((p) => p !== entry.path)
                    : [...selected, entry.path]
                  : [entry.path],
              );
            }}
            onDoubleClick={() =>
              entry.directory
                ? void load(entry.path)
                : !localRoot &&
                  (textCandidate(entry.path)
                    ? openText(entry.path)
                    : run(window.cshell.download(sessionId, [entry.path])))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                entry.directory ? void load(entry.path) : setSelected([entry.path]);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!selected.includes(entry.path)) setSelected([entry.path]);
              setMenuPosition({
                x: Math.min(e.clientX, innerWidth - 180),
                y: Math.min(e.clientY, innerHeight - 240),
              });
              setMenu(entry.path);
            }}
          >
            {entry.directory ? <Folder size={14} className="folder-icon" /> : <File size={13} />}
            <span className="file-label">
              {entry.name}
              {entry.symlink ? ' ↗' : ''}
            </span>
            <small className="file-size">
              {entry.directory
                ? '—'
                : new Intl.NumberFormat(locale, {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  }).format(entry.size) + ' B'}
            </small>
            <small className="file-date">
              {new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
                entry.modified,
              )}
            </small>
            <button
              className="icon file-more"
              aria-label={t('moreActions')}
              onClick={(e) => {
                e.stopPropagation();
                setSelected([entry.path]);
                const rect = e.currentTarget.getBoundingClientRect();
                setMenuPosition({
                  x: Math.min(rect.right - 170, innerWidth - 180),
                  y: Math.min(rect.bottom, innerHeight - 240),
                });
                setMenu(menu === entry.path ? null : entry.path);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        ))}
        {!entries.length && !busy && <p className="empty-small">{t('emptyFolder')}</p>}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="file-context"
          style={{ left: menuPosition.x, top: menuPosition.y }}
        >
          <button
            onClick={() => {
              copyFiles(selected.map(refFor));
              setMenu(null);
            }}
          >
            {t('copy')}
          </button>
          <button
            onClick={() => {
              run(transfer(pastedFiles(), path));
              setMenu(null);
            }}
          >
            {t('paste')}
          </button>
          <button
            disabled={Boolean(localRoot)}
            onClick={() => {
              run(window.cshell.download(sessionId, selected));
              setMenu(null);
            }}
          >
            {t('download')}
          </button>
          <button
            onClick={() => {
              copyPath();
              setMenu(null);
            }}
          >
            {t('copyPath')}
          </button>
          <button
            disabled={selected.length !== 1}
            onClick={() => {
              setName(selected[0].split('/').pop()!);
              setAction('rename');
              setMenu(null);
            }}
          >
            {t('rename')}
          </button>
          <button className="danger" onClick={() => run(remove())}>
            {t('delete')}
          </button>
          <button className="icon" aria-label={t('close')} onClick={() => setMenu(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="file-summary">
        {entries.length} {t('fileCount')}
        {selected.length ? ` · ${selected.length} ${t('selected')}` : ''}
      </div>
      <div className="drop-hint">
        <Upload size={16} />
        {t('dropHint')}
      </div>
      {action && (
        <section
          className="inline-file-editor"
          aria-label={t(action === 'mkdir' ? 'newFolder' : 'rename')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAction(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(submit());
            }}
          >
            <label>
              {t(action === 'mkdir' ? 'folderHint' : 'renameHint')}
              <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <footer>
              <button type="button" onClick={() => setAction(null)}>
                {t('cancel')}
              </button>
              <button className="primary">{t('confirm')}</button>
            </footer>
          </form>
        </section>
      )}
    </div>
    {editors.map(file => <div className="text-file-slot" hidden={activeEditor !== file} key={file}><Suspense fallback={<p role="status">正在打开编辑器…</p>}><TextFileEditor sessionId={sessionId} path={file} closed={closed} disableEnvironment={disableEnvironment}/></Suspense></div>)}
  </>);
}
