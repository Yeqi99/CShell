export const CONNECTION_CANCELLED = 'CSHELL_CONNECTION_CANCELLED';
export const CONNECTION_TIMEOUT = 'CSHELL_CONNECTION_TIMEOUT';

export function isConnectionCancelled(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).includes(CONNECTION_CANCELLED);
}

export function connectionErrorMessage(error: unknown, locale: string) {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
  const zh = locale === 'zh-CN';
  if (message.includes(CONNECTION_CANCELLED) || /AbortError/.test(message))
    return zh ? '已取消连接。' : 'Connection cancelled.';
  if (message.includes(CONNECTION_TIMEOUT) || /timed? ?out|ETIMEDOUT/i.test(message))
    return zh
      ? '连接超时，请检查网络、地址和端口后重试。'
      : 'Connection timed out. Check the network, host and port, then retry.';
  if (/ECONNREFUSED/.test(message))
    return zh
      ? '服务器拒绝连接，请检查端口和 SSH 服务。'
      : 'Connection refused. Check the port and SSH service.';
  if (/ENOTFOUND|EAI_AGAIN/.test(message))
    return zh
      ? '找不到服务器地址，请检查主机名和网络。'
      : 'Host not found. Check the hostname and network.';
  if (/All configured authentication methods failed/.test(message))
    return zh
      ? '认证失败，请检查用户名、密码或私钥。'
      : 'Authentication failed. Check the username, password or private key.';
  if (/ECONNRESET|EPIPE|SSH connection closed/.test(message))
    return zh
      ? '连接已中断，请检查网络或服务器状态。'
      : 'Connection interrupted. Check the network or server.';
  return message;
}
