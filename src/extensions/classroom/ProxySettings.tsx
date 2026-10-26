import { classroomProxyAction, type ClassroomProxyDraft } from '../../shared/classroom-proxy';
import './proxy-settings.css';
export function ProxySettings({ value, onChange, disabled = false }: {
  value: ClassroomProxyDraft; onChange(value: ClassroomProxyDraft): void; disabled?: boolean;
}) {
  let error = '';
  if (value.mode === 'set' && value.url) { try { classroomProxyAction(value); } catch (e) { error = e instanceof Error ? e.message : '代理设置无效'; } }
  return <div className="classroom-proxy-settings">
    <label>代理操作<select value={value.mode} disabled={disabled} onChange={event => onChange({ ...value, mode: event.target.value as ClassroomProxyDraft['mode'] })}>
      <option value="set">设置代理</option><option value="clear">清除 CAgent 代理变量</option>
    </select></label>
    {value.mode === 'set' ? <>
      <label>学生机器使用的代理地址<input type="text" value={value.url} autoComplete="off" spellCheck={false} maxLength={2048} disabled={disabled}
        placeholder="http://192.168.1.10:7890" onChange={event => onChange({ ...value, url: event.target.value })}/></label>
      <label>直连例外（可选）<input type="text" value={value.noProxy} autoComplete="off" spellCheck={false} maxLength={2048} disabled={disabled}
        placeholder="localhost, .example.internal" onChange={event => onChange({ ...value, noProxy: event.target.value })}/></label>
      <p>地址需能从学生机器访问，不支持在地址中填写账号密码。例外中的主机按应用规则直连；留空则不设置例外。</p>
    </> : <p>仅删除本入口使用的六个大小写代理变量，不清除其他环境变量，也不更改机器已有的系统代理。</p>}
    {error && <p className="classroom-proxy-error" role="alert">{error}</p>}
    <div className="classroom-proxy-scope"><strong>生效范围</strong><p>仅影响 CAgent 后续启动、且支持代理环境变量的终端或脚本程序。已运行的程序、系统代理及不读取这些变量的应用保持原状。</p><p>不会配置连接失败时自动回退直连。代理服务器的可达性由目标程序实际连接验证；下发成功不等于网络已连通。</p></div>
  </div>;
}
