import type { Profile } from '../../shared/contracts';
import { useState } from 'react';
import {
  clientInfoSchema,
  type ClientInfo,
  type ClientDevice,
  type ClientShell,
} from '../../shared/client';
import { useI18n } from '../i18n';
import type { AgentShellOption } from '../../shared/agent';
import type { AgentRelayConnection } from '../../shared/agent-relay';
export type ClientConnected = (
  result: { sessionId: string; name: string },
  device: ClientDevice,
  shell: ClientShell,
  distribution?: string,
) => void | Promise<void>;
export function ClientConnectForm({
  onConnect,
  profile,
}: {
  onConnect: ClientConnected;
  profile?: Profile;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const [host, setHost] = useState(profile?.host ?? ''),
    [port, setPort] = useState(String(profile?.port ?? 47831)),
    [password, setPassword] = useState('');
  const [shell, setShell] = useState<ClientShell>(profile?.clientShell ?? 'powershell');
  const [distribution, setDistribution] = useState(profile?.clientDistribution);
  const [device, setDevice] = useState<ClientDevice>();
  const [shells, setShells] = useState<AgentShellOption[]>([]);
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [relay, setRelay] = useState<AgentRelayConnection>({
    host: '',
    port: 22444,
    fingerprint: '',
    credential: '',
    targetId: '',
  });
  const [name, setName] = useState(profile?.name ?? ''),
    [group, setGroup] = useState(profile?.group ?? ''),
    [favorite, setFavorite] = useState(profile?.favorite ?? false);
  const [info, setInfo] = useState<ClientInfo>();
  const [fingerprint, setFingerprint] = useState('');
  const [trusted, setTrusted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const reset = () => {
    setInfo(undefined);
    setTrusted(false);
    setFingerprint('');
    setDevice(undefined);
    setShells([]);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const describe = async (next: ClientInfo) => {
    const der = Uint8Array.from(
      atob(next.certificate.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')),
      (v) => v.charCodeAt(0),
    );
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
    setFingerprint(
      [...digest]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join(':')
        .toUpperCase(),
    );
    setInfo(next);
    setTrusted(false);
  };
  return (
    <form
      className="client-connect-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          if (!info) {
            await describe(
              await window.cshell.clientProbe({
                host: host.trim(),
                port: Number(port),
                ...(relayEnabled ? { relay } : {}),
              }),
            );
            return;
          }
          if (!trusted) return;
          if (!device) {
            const next = await window.cshell.clientPasswordPair(info, password);
            const choices = await window.cshell.clientShells(next.deviceId);
            if (!choices.length) throw new Error('Agent 未开放可用终端');
            setDevice(next);
            setShells(choices);
            setShell(choices[0].shell as ClientShell);
            setDistribution(choices[0].distribution);
            setPassword('');
            return;
          }
          await window.cshell.saveProfile({
            id: device.deviceId,
            protocol: 'client',
            clientShell: shell,
            clientDistribution: distribution,
            name: profile?.name ?? (name.trim() || device.name),
            group: profile?.group ?? group.trim(),
            favorite: profile?.favorite ?? favorite,
            host: device.host,
            port: device.port,
            username: 'Client',
            auth: 'password',
          });
          setPassword('');
          await onConnect(
            await window.cshell.clientConnect(device.deviceId, shell, distribution),
            device,
            shell,
            distribution,
          );
        });
      }}
    >
      <div className="connection-form-tools">
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              window.dispatchEvent(new Event('cshell:open-extensions'));
            })
          }
        >
          {cn ? '打开插件市场' : 'Open plugin marketplace'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const text = await window.cshell.pasteText();
              if (text.length > 16384)
                throw new Error(cn ? '连接信息过长' : 'Connection info too large');
              const next = clientInfoSchema.parse(JSON.parse(text));
              setHost(next.host);
              setPort(String(next.port));
              await describe(next);
            })
          }
        >
          {cn ? '粘贴连接信息' : 'Paste connection info'}
        </button>
      </div>
      <fieldset disabled={busy}>
        <div className="client-fields">
          <label>
            {cn ? '主机地址' : 'Host'}
            <input
              required
              value={host}
              onChange={(e) => {
                setHost(e.target.value);
                reset();
              }}
            />
          </label>
          <label>
            {cn ? '端口' : 'Port'}
            <input
              type="number"
              min={1024}
              max={65535}
              required
              value={port}
              onChange={(e) => {
                setPort(e.target.value);
                reset();
              }}
            />
          </label>
        </div>
        <label>
          {cn ? '连接密码' : 'Connection password'}
          <input
            required={!device}
            type="password"
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {!!shells.length && (
          <label>
            {cn ? '终端' : 'Terminal'}
            <select
              aria-label={cn ? '终端' : 'Terminal'}
              value={shell + '|' + (distribution ?? '')}
              onChange={(e) => {
                const choice = shells.find(
                  (s) => s.shell + '|' + (s.distribution ?? '') === e.target.value,
                )!;
                setShell(choice.shell as ClientShell);
                setDistribution(choice.distribution);
              }}
            >
              {shells.map((s) => (
                <option
                  key={s.shell + '|' + (s.distribution ?? '')}
                  value={s.shell + '|' + (s.distribution ?? '')}
                >
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <details>
          <summary>{cn ? '通过中继连接' : 'Relay connection'}</summary>
          <label>
            <input
              type="checkbox"
              checked={relayEnabled}
              onChange={(e) => {
                setRelayEnabled(e.target.checked);
                reset();
              }}
            />
            {cn ? '使用已授权中继' : 'Use an authorized relay'}
          </label>
          {relayEnabled &&
            (['host', 'port', 'fingerprint', 'targetId', 'credential'] as const).map(
              (key, index) => (
                <label key={key}>
                  {['中继地址', '中继端口', '中继指纹', '目标标识', '中继凭证'][index]}
                  <input
                    type={key === 'credential' ? 'password' : key === 'port' ? 'number' : 'text'}
                    value={relay[key]}
                    onChange={(e) => {
                      setRelay({
                        ...relay,
                        [key]: key === 'port' ? Number(e.target.value) : e.target.value,
                      });
                      reset();
                    }}
                  />
                </label>
              ),
            )}
        </details>
        {!profile && (
          <details className="connection-metadata">
            <summary>{cn ? '名称、分组与收藏' : 'Name, group and favorite'}</summary>
            <label>
              {cn ? '名称' : 'Name'}
              <input
                value={name}
                maxLength={255}
                onChange={(e) => setName(e.target.value)}
                placeholder={cn ? '可选，默认使用设备名称' : 'Optional, defaults to device name'}
              />
            </label>
            <label>
              {cn ? '分组' : 'Group'}
              <input value={group} maxLength={100} onChange={(e) => setGroup(e.target.value)} />
            </label>
            <label className="client-favorite">
              <input
                type="checkbox"
                checked={favorite}
                onChange={(e) => setFavorite(e.target.checked)}
              />
              {cn ? '收藏' : 'Favorite'}
            </label>
          </details>
        )}
        {info && (
          <div className="client-trust">
            <p>
              {cn
                ? '核对此电脑显示的设备指纹后连接：'
                : 'Verify the fingerprint shown on the managed computer:'}
            </p>
            <strong>{info.name}</strong>
            <code>{fingerprint}</code>
            <label>
              <input
                type="checkbox"
                checked={trusted}
                onChange={(e) => setTrusted(e.target.checked)}
              />
              {cn ? '我已核对设备身份' : 'I verified this device identity'}
            </label>
          </div>
        )}
        <button className="client-primary" disabled={busy || (!!info && !trusted)}>
          {busy
            ? cn
              ? '连接中…'
              : 'Connecting…'
            : info
              ? cn
                ? device
                  ? '连接'
                  : '验证并读取终端'
                : device
                  ? 'Connect'
                  : 'Verify and load terminals'
              : cn
                ? '检查设备'
                : 'Check device'}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function RdpConnectForm() {
  const { locale } = useI18n(),
    cn = locale === 'zh-CN';
  const [host, setHost] = useState(''),
    [port, setPort] = useState('3389'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="rdp-connect-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setMessage('');
        void window.cshell
          .openRdp({ host: host.trim(), port: Number(port) })
          .then(() =>
            setMessage(
              cn ? '已打开 Windows 远程桌面客户端。' : 'Windows Remote Desktop client opened.',
            ),
          )
          .catch((e) => setMessage(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <p>
        {cn
          ? '使用 Windows 远程桌面客户端，身份验证在系统窗口完成。'
          : 'Uses Windows Remote Desktop. Authenticate in the system window.'}
      </p>
      <label>
        {cn ? '主机地址' : 'Host'}
        <input required value={host} onChange={(e) => setHost(e.target.value)} />
      </label>
      <label>
        {cn ? '端口' : 'Port'}
        <input
          type="number"
          min={1}
          max={65535}
          required
          value={port}
          onChange={(e) => setPort(e.target.value)}
        />
      </label>
      <button className="client-primary" disabled={busy}>
        {cn ? '打开远程桌面' : 'Open Remote Desktop'}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
