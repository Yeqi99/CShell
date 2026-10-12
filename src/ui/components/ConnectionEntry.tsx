import { ClientConnectForm, RdpConnectForm, type ClientConnected } from './ClientConnectForm';
import { useI18n } from '../i18n';
import type { LocalShell } from '../../shared/local-terminal';
import { useState, type ReactNode } from 'react';
import { Search, Plus, Server, ArrowLeft, ChevronRight } from 'lucide-react';
import type { LocalConnectionTarget } from '../../shared/local-terminal';
import type { Profile } from '../../shared/contracts';
export function ConnectionEntry({
  profiles,
  onConnect,
  targets = [],
  onTarget,
  children,
  onClient,
  onLocal,
}: {
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
  const [protocol, setProtocol] = useState('ssh');
  const [localError, setLocalError] = useState('');
  const [adding, setAdding] = useState(false),
    [query, setQuery] = useState('');
  const matches = profiles.filter((p) =>
    `${p.name} ${p.host} ${p.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  const localMatches = targets.filter((t) =>
    `${t.name} ${t.detail}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="connection-entry">
      <div hidden={adding} className="connection-chooser">
        <header>
          <div>
            <h1>新建连接</h1>
            <p>选择机器，打开一个会话。</p>
          </div>
          <button className="secondary" onClick={() => setAdding(true)}>
            <Plus size={15} />
            添加连接记录
          </button>
        </header>
        <label className="connection-chooser-search">
          <Search size={15} />
          <input
            aria-label="查找已有机器"
            placeholder="搜索名称、地址或分组"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="connection-choices">
          {targets
            .filter((t) => `${t.name} ${t.detail}`.toLowerCase().includes(query.toLowerCase()))
            .map((t) => (
              <button key={t.id} onClick={() => onTarget?.(t)}>
                <Server size={19} />
                <span>
                  <strong>{t.name}</strong>
                  <small>{t.detail}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          {matches.map((p) => (
            <button key={p.id} onClick={() => onConnect(p)}>
              <Server size={19} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.protocol === 'client' ? 'Client · ' : p.username + '@'}
                  {p.host}:{p.port}
                  {p.group ? ` · ${p.group}` : ''}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        {!matches.length && !localMatches.length && (
          <p className="connection-chooser-empty">
            {profiles.length || targets.length
              ? '没有匹配的机器'
              : '尚无连接记录，添加一台机器即可开始。'}
          </p>
        )}
      </div>
      <div hidden={!adding}>
        <button className="connection-entry-back" onClick={() => setAdding(false)}>
          <ArrowLeft size={14} />
          已有机器
        </button>
        <div className="protocol-form">
          <label>
            {cn ? '连接方式' : 'Connection type'}
            <select
              aria-label={cn ? '连接方式' : 'Connection type'}
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
            >
              <option value="ssh">SSH</option>
              <option value="client">CShell Client</option>
              <option value="rdp">RDP · Windows</option>
              <option value="powershell">PowerShell · {cn ? '本机' : 'Local'}</option>
              <option value="cmd">CMD · {cn ? '本机' : 'Local'}</option>
              {targets.map((t) => (
                <option key={t.id} value={t.shell}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div hidden={protocol !== 'ssh'}>{children}</div>
          <div className="client-page protocol-client" hidden={protocol !== 'client'}>
            <ClientConnectForm onConnect={onClient} />
          </div>
          <div className="client-page protocol-client" hidden={protocol !== 'rdp'}>
            <RdpConnectForm />
          </div>
          {protocol !== 'ssh' && protocol !== 'client' && protocol !== 'rdp' && (
            <button
              onClick={() => {
                setLocalError('');
                void onLocal(protocol as LocalShell).catch((e) => setLocalError(e.message));
              }}
            >
              {cn ? '打开终端' : 'Open terminal'}
            </button>
          )}
          {localError && <p role="alert">{localError}</p>}
        </div>
      </div>
    </div>
  );
}
