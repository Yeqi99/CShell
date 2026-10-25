/** Text/selection input may contain passwords or OTPs regardless of its field name. */
export function visualAuditArguments(tool: string, input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  if (tool === 'invoke_connection' && typeof value.tool === 'string')
    return { ...value, arguments: visualAuditArguments(value.tool, value.arguments) };
  if (tool === 'task_start' && typeof value.tool === 'string')
    return { ...value, arguments: visualAuditArguments(value.tool, value.arguments) };
  if (
    (tool === 'browser_interact' && ['fill', 'select'].includes(String(value.action))) ||
    (tool === 'desktop_interact' && value.action === 'text')
  )
    return {
      ...value,
      ...('text' in value ? { text: '[输入内容已隐藏]' } : {}),
      ...('value' in value ? { value: '[输入内容已隐藏]' } : {}),
    };
  return input;
}
export function visualAuditJson(tool: string, input: string) {
  try {
    return JSON.stringify(visualAuditArguments(tool, JSON.parse(input)));
  } catch {
    return input;
  }
}
