import { useState, useEffect, useRef } from 'react';
import type {
  ConsoleRecoveryPlan,
  ConsoleRecoveryResult,
} from '../../agent/system-desktop-recovery';
const reasons: Record<string, string> = {
  ALREADY_CONSOLE: 'CAgent 已在本机控制台会话中，无需转换。',
  NO_CONSOLE: 'Windows 当前没有可连接的控制台会话。',
  CONSOLE_OCCUPIED: '控制台已有用户登录；不会替换或断开该用户。',
  NOT_RDP: '当前 CAgent 不在 RDP 会话中。',
  SESSION_NOT_ACTIVE: '原会话已断开；请先恢复原 RDP 会话后检查。',
  SESSION_LOCKED_OR_UNKNOWN: '会话已锁定或无法核对状态；请先由用户解锁。',
  UNSUPPORTED_WINDOWS: '此 Windows 版本不支持安全核对会话状态。',
};
export function DesktopRecovery({
  target,
  allowed,
  beforeExecute,
  onRecovered,
}: {
  target: string;
  allowed: boolean;
  beforeExecute: () => Promise<void>;
  onRecovered: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [plan, setPlan] = useState<ConsoleRecoveryPlan>(),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setOpen(false);
    setPlan(undefined);
    setConfirmed(false);
    setMessage('');
    setBusy(false);
  }, [target]);
  const inspect = async () => {
    const epoch = generation.current;
    setOpen(true);
    setBusy(true);
    setPlan(undefined);
    setMessage('');
    setConfirmed(false);
    try {
      const next = (await window.cshell.agentCall(target, {
        method: 'desktop.recovery.plan',
        params: {},
      })) as ConsoleRecoveryPlan;
      if (epoch === generation.current) setPlan(next);
    } catch (e) {
      if (epoch === generation.current)
        setMessage('无法检查独立远控：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  const execute = async () => {
    if (!plan || !confirmed) return;
    const epoch = generation.current;
    setBusy(true);
    setMessage('');
    try {
      await beforeExecute();
      if (epoch !== generation.current) return;
      const result = (await window.cshell.agentCall(target, {
        method: 'desktop.recovery.execute',
        params: { planId: plan.id, confirm: true },
      })) as ConsoleRecoveryResult;
      if (epoch !== generation.current) return;
      setPlan(undefined);
      setConfirmed(false);
      if (result.confirmed) {
        setMessage('Windows 已确认切换到原用户的控制台会话，正在重新连接画面。');
        await onRecovered();
      } else
        setMessage(
          `Windows 未确认会话转换${result.errorCode ? '（错误 ' + result.errorCode + '）' : ''}。不会自动重试或改用其他用户；请恢复原 RDP 连接后检查。`,
        );
    } catch (e) {
      if (epoch === generation.current) {
        setPlan(undefined);
        setConfirmed(false);
        setMessage('未能确认转换结果（不会自动重试）：' + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  return (
    <div className="desktop-recovery">
      <button
        disabled={!allowed || busy}
        title="检查当前 Windows 会话，确认后尝试脱离 RDP 显示依赖"
        onClick={() => void inspect()}
      >
        转为独立远控
      </button>
      {open && (
        <div className="desktop-recovery-plan" role="region" aria-label="独立远控计划">
          <div className="desktop-recovery-heading">
            <strong>独立远控计划</strong>
            <button disabled={busy} aria-label="关闭独立远控计划" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          {busy && <p role="status">正在处理…</p>}
          {plan && (
            <>
              <dl>
                <dt>CAgent 所属会话</dt>
                <dd>
                  {plan.sessionId} · {plan.protocol === 2 ? 'RDP' : '控制台/其他'} ·{' '}
                  {plan.sourceUnlocked ? '未锁定' : '已锁定或未知'}
                </dd>
                <dt>控制台</dt>
                <dd>
                  {plan.consoleSessionId === 4294967295 ? '不可用' : plan.consoleSessionId} ·{' '}
                  {plan.consoleOccupied ? '已有用户' : '无人登录'}
                </dd>
                <dt>当前显示采集</dt>
                <dd>
                  {plan.displayAvailable
                    ? `${plan.displayWidth} × ${plan.displayHeight}`
                    : '不可用；转换后仍需重新验证'}
                </dd>
              </dl>
              {!plan.canAttempt ? (
                <p>{reasons[plan.reason] || '此状态暂不支持转换。'}</p>
              ) : (
                <>
                  <p>
                    仅尝试把当前 CAgent 同一用户、同一会话转到空闲控制台。RDP
                    将断开，已运行的程序保留；桌面可能显示在这台机器的实体屏幕上。
                  </p>
                  <p>
                    不会解锁、自动登录或切换其他用户。系统可能拒绝转换；无可用显示器时仍可能需要单独配置虚拟显示。
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    我已确认 RDP 断开和本机屏幕可见的影响
                  </label>
                  <button
                    className="primary"
                    disabled={!confirmed || busy}
                    onClick={() => void execute()}
                  >
                    确认转换并重新连接
                  </button>
                </>
              )}
            </>
          )}
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </div>
  );
}
