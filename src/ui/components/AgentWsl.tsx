import {useEffect,useState} from 'react';
import type {AgentCall} from '../../shared/agent';
import {AgentWslNetwork} from './AgentWslNetwork';
type Call=(method:AgentCall['method'],params?:unknown)=>Promise<any>;
export function AgentWsl({ target, call }: { target: string; call: Call }) {
  const [check, setCheck] = useState<any>(),
    [plan, setPlan] = useState<any>(),
    [distribution, setDistribution] = useState(''),
    [installed, setInstalled] = useState(''),
    [user, setUser] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(false),
    [webDownload,setWebDownload]=useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(async () => {
      const value = await call('wsl.check');
      setCheck(value);
      setPlan(value.installation);
      setDistribution(value.online?.[0] ?? '');
      setInstalled(value.distributions?.[0] ?? '');
    });
  }, [target]);
  useEffect(() => {
    if (plan?.state !== 'running') return;
    const timer = setInterval(
      () =>
        void call('wsl.status')
          .then(setPlan)
          .catch((e) => setError(String(e))),
      1500,
    );
    return () => clearInterval(timer);
  }, [call, plan?.state]);
  return (
    <div className="agent-settings">
      {check?.supported === false ? (
        <p>此 Agent 不是 Windows，无 WSL 功能。</p>
      ) : (
        <>
          <p>操作作用于所选 Windows Agent，安装可能需要管理员权限及重启；不会自动提权或重启。</p>
          <fieldset disabled={busy}>
            <button onClick={()=>void run(async()=>{const value=await call('wsl.check');setCheck(value);setPlan(value.installation);setInstalled(value.distributions?.[0]??'');})}>重新检查</button>
            {check?.distributions?.length>0&&<p>已安装 Linux：{check.distributions.join('、')}。可在此机器的终端选择中打开。</p>}
            {check?.guidance?.map((message:string)=><p key={message}>{message}</p>)}
            {check?.webDownloadSupported&&<label className="agent-check"><input type="checkbox" checked={webDownload} onChange={e=>setWebDownload(e.target.checked)}/>直接下载（绕过 Microsoft Store）</label>}
            <div className="agent-fields">
              <label>
                安装发行版
                <select value={distribution} onChange={(e) => setDistribution(e.target.value)}>
                  {check?.online?.map((d: string) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <button
                disabled={!distribution}
                onClick={() =>
                  void run(async () => {
                    setPlan(await call('wsl.plan', { distribution,webDownload }));
                    setConfirm(false);
                  })
                }
              >
                检查并生成计划
              </button>
            </div>
            {check?.onlineError && <p>{check.onlineError}</p>}
            {plan && (
              <>
                <pre>{plan.logs}</pre>
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  确认在此 Agent 安装 {plan.distribution}
                </label>
                <button
                  disabled={!confirm || plan.state === 'running' || plan.state === 'completed'}
                  onClick={() =>
                    void run(async () =>
                      setPlan(await call('wsl.install', { planId: plan.id, confirm: true })),
                    )
                  }
                >
                  执行安装
                </button>
                {plan.state === 'running' && (
                  <button onClick={() => void run(async () => setPlan(await call('wsl.cancel')))}>
                    取消安装
                  </button>
                )}
                <p>状态：{plan.state}</p>
              </>
            )}
            <details>
              <summary>初始化 Linux 用户</summary>
              <label>
                已安装发行版
                <select value={installed} onChange={(e) => setInstalled(e.target.value)}>
                  {check?.distributions?.map((d: string) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label>
                用户名
                <input value={user} onChange={(e) => setUser(e.target.value)} />
              </label>
              <label>
                Linux 密码
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                disabled={!installed || !user || !password}
                onClick={() =>
                  void run(async () => {
                    const status = await call('wsl.account.initialize', {
                      distribution: installed,
                      username: user,
                      password,
                      confirm: true,
                    });
                    setPassword('');
                    setResult(status.ready ? '默认 Linux 用户已验证' : '用户初始化未完成');
                  })
                }
              >
                创建并设为默认用户
              </button>
            </details>
          </fieldset>
          <AgentWslNetwork call={call} />
        </>
      )}
      {result && <p role="status">{result}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
