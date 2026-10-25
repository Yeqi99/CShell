/** Explicit unsupported-method responses only. Permission and transport failures
 * remain errors and must not enable an alternate execution path. */
export function isUnsupportedAgentMethod(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /^(?:Unknown (?:Agent )?method|Unknown operation|未知(?: Agent)?(?:方法|操作)|不支持的(?: Agent 管理操作|方法))/i.test(text) ||
    (/"(?:code|message)"\s*:\s*"(?:invalid_enum_value|invalid_value|Invalid enum value|Invalid option)/.test(text) && /"path"\s*:\s*\[\s*"method"\s*\]/.test(text));
}
export const agentCompatibilityNotice = '此机器的 CAgent 暂未提供这项能力；已保留现有连接和运行任务。';

export function agentCapabilityError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error).replace(/^Error: /, '');
  // Older bridges may truncate the method enum before its path. This is display
  // normalization only; it must not be used to authorize a fallback or retry.
  return isUnsupportedAgentMethod(error) || /^\s*\[\s*\{\s*"(?:code|expected|values)"/.test(text)
    ? agentCompatibilityNotice : text;
}
