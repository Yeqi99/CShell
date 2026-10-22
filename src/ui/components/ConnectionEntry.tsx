import { RdpConnectionForm } from './RdpConnectionForm';
import { ConnectionImport } from './ConnectionImport';
import { ClientConnectForm, type ClientConnected } from './ClientConnectForm';
import { useI18n } from '../i18n';
import type { LocalShell, LocalConnectionTarget } from '../../shared/local-terminal';
import { useState, type ReactNode } from 'react';
import {
  Search,
  Server,
  ArrowLeft,
  ChevronRight,
  Monitor,
  Terminal,
  ShieldCheck,
} from 'lucide-react';
import type { Profile } from '../../shared/contracts';
import './connection-entry.css';
type ConnectionKind = 'ssh' | 'rdp' | 'client' | 'http';
export function ConnectionEntry({
  onSaved,
  profiles,
  http,
  onConnect,
  targets = [],
  onTarget,
  children,
  onClient,
  onLocal,
}: {
  onSaved: () => Promise<void>;
  http?: ReactNode;
  onClient: ClientConnected;
  onLocal: (shell: LocalShell) => Promise<void>;
  profiles: Profile[];
  onConnect: (p: Profile) => void;
  children: ReactNode;
  targets?: LocalConnectionTarget[];
  onTarget?: (t: LocalConnectionTarget) => void;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const [kind, setKind] = useState<ConnectionKind | null>(null);
  const [visited, setVisited] = useState<ConnectionKind[]>([]);
  const [query, setQuery] = useState('');
  const [localError, setLocalError] = useState('');
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);
  const windows = window.cshell.platform === 'win32';
  const kinds = [
    ...(http
      ? [
          {
            id: 'http' as const,
            title: 'HTTP 请求',
            description: '多目标、发送方、请求集合与历史',
            icon: Server,
          },
        ]
      : []),
    ...(windows
      ? [
          {
            id: 'rdp' as const,
            title: cn ? 'Windows 远程桌面' : 'Windows Remote Desktop',
            description: cn ? '打开远程电脑的桌面与应用' : 'Access a remote desktop and its apps',
            icon: Monitor,
          },
        ]
      : []),
    {
      id: 'ssh' as const,
      title: cn ? 'SSH 终端' : 'SSH terminal',
      description: cn ? '连接服务器，使用终端和文件' : 'Access a server terminal and files',
      icon: Terminal,
    },
    {
      id: 'client' as const,
      title: 'CAgent',
      description: cn ? '连接运行独立 Agent 的电脑' : 'Access a computer running CAgent',
      icon: ShieldCheck,
    },
  ];
  const selected = kinds.find((item) => item.id === kind);
  const matches = profiles.filter((p) =>
    `${p.name} ${p.host} ${p.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  const choose = (next: ConnectionKind) => {
    setVisited((items) => (items.includes(next) ? items : [...items, next]));
    setKind(next);
  };
  const openLocal = async (shell: LocalShell) => {
    setOpening(true);
    setLocalError('');
    try {
      await onLocal(shell);
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="connection-entry connection-flow">
      {importing && <ConnectionImport onSaved={onSaved} onBack={() => setImporting(false)}/>}
      <div hidden={importing} style={{height: '100%'}}>
      <div hidden={kind !== null} className="connection-start">
        <header className="connection-start-heading">
          <h1>{cn ? '新建连接' : 'New connection'}</h1>
          <p>{cn ? '你想连接什么？' : 'What would you like to connect to?'}</p>
        </header>
        {window.cshell.connectionImportText && <button className="secondary" onClick={() => setImporting(true)}>{cn ? '批量导入连接' : 'Import connections'}</button>}
        <div className="connection-kind-grid">
          {kinds.map(({ id, title, description, icon: Icon }) => (
            <button
              key={id}
              className="connection-kind"
              aria-label={title}
              onClick={() => choose(id)}
            >
              <Icon size={23} strokeWidth={1.6} aria-hidden="true" />
              <strong>{title}</strong>
              <span>{description}</span>
              <ChevronRight className="connection-kind-arrow" size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        {(windows || targets.length > 0) && (
          <section className="connection-local" aria-label={cn ? '本机终端' : 'Local terminal'}>
            <h2>{cn ? '本机终端' : 'Local terminal'}</h2>
            <div>
              {windows && (
                <>
                  <button disabled={opening} onClick={() => void openLocal('powershell')}>
                    <Terminal size={15} />
                    PowerShell
                  </button>
                  <button disabled={opening} onClick={() => void openLocal('cmd')}>
                    <Terminal size={15} />
                    CMD
                  </button>
                </>
              )}
              {targets.map((target) => (
                <button key={target.id} onClick={() => onTarget?.(target)} title={target.detail}>
                  <Terminal size={15} />
                  {target.name}
                </button>
              ))}
            </div>
            {localError && <p role="alert">{localError}</p>}
          </section>
        )}
        {!!profiles.length && (
          <details className="connection-saved-list">
            <summary>
              {cn ? '已有连接' : 'Saved connections'} <span>{profiles.length}</span>
            </summary>
            <label className="connection-chooser-search">
              <Search size={15} />
              <input
                aria-label={cn ? '查找已有机器' : 'Find saved computer'}
                placeholder={cn ? '搜索名称、地址或分组' : 'Search name, address or group'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="connection-choices">
              {matches.map((p) => (
                <button key={p.id} onClick={() => onConnect(p)}>
                  <Server size={18} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.host}:{p.port}
                      {p.group ? ` · ${p.group}` : ''}
                    </small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            {!matches.length && <p>{cn ? '没有匹配的机器' : 'No matching computers'}</p>}
          </details>
        )}
      </div>
      <div hidden={kind === null} className="connection-detail">
        <header className="connection-detail-heading">
          <button
            className="icon"
            aria-label={cn ? '返回连接方式' : 'Back to connection types'}
            title={cn ? '返回连接方式' : 'Back to connection types'}
            onClick={() => setKind(null)}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1>{selected?.title}</h1>
            <p>{selected?.description}</p>
          </div>
        </header>
        <div className="protocol-form">
          <div hidden={kind !== 'http'}>{visited.includes('http') && http}</div>
          <div hidden={kind !== 'ssh'}>{visited.includes('ssh') && children}</div>
          <div className="client-page protocol-client" hidden={kind !== 'client'}>
            {visited.includes('client') && <ClientConnectForm onConnect={onClient} />}
          </div>
          <div hidden={kind !== 'rdp'}>
            {visited.includes('rdp') && <RdpConnectionForm embedded onSaved={onSaved} />}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
