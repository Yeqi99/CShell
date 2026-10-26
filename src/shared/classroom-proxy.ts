import type { ClassroomAction } from './classroom-tasks';
export interface ClassroomProxyDraft { mode: 'set' | 'clear'; url: string; noProxy: string }
export const defaultClassroomProxyDraft: ClassroomProxyDraft = { mode: 'set', url: '', noProxy: '' };
export const classroomProxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'] as const;
function address(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(raw)) throw new Error('请输入有效的 HTTP 或 HTTPS 代理地址');
  let url: URL;try { url = new URL(raw); } catch { throw new Error('代理地址需包含 http:// 或 https:// 及主机地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.port === '0' || !['', '/'].includes(url.pathname) || url.search || url.hash || raw.includes('\\')) throw new Error('代理地址只支持 HTTP/HTTPS 主机与有效端口，不包含路径、参数或片段');
  if (url.username || url.password || /@/.test(raw)) throw new Error('此入口不接受含账号或密码的代理地址');
  return url.origin;
}
function bypass(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\r\n\u0000-\u001f\u007f]/.test(raw)) throw new Error('直连例外需为逗号分隔的主机列表');
  if (!raw.trim()) return '';
  const parts = raw.split(',').map(v => v.trim());
  if (parts.length > 100 || parts.some(p => !p || p.length > 253 || /[\s/@?#\\*%]/.test(p))) throw new Error('直连例外仅接受主机或 IP，可含端口；不接受网址、通配符或空项目');
  const normalized = parts.map(part => {
    const suffix = part.startsWith('.'), host = suffix ? part.slice(1) : part;
    let value: URL;try { value = new URL('http://' + host); } catch { throw new Error('直连例外中的主机或端口无效'); }
    if (!value.hostname || value.username || value.password || !['', '/'].includes(value.pathname) || value.search || value.hash) throw new Error('直连例外中的主机无效');
    // URL strips the default :80; NO_PROXY host:80 must remain port-specific.
    const explicitPort = /:\d+$/.exec(host)?.[0] ?? '';
    return (suffix ? '.' : '') + value.hostname + explicitPort;
  });
  return [...new Set(normalized)].join(',');
}
/** Patch only proxy overrides; the remote environment handler merges other variables unchanged. */
export function classroomProxyAction(draft: ClassroomProxyDraft): Extract<ClassroomAction, { kind: 'environment' }> {
  if (!draft || !['set', 'clear'].includes(draft.mode)) throw new Error('无效代理操作');
  if (draft.mode === 'clear') return { kind: 'environment', variables: Object.fromEntries(classroomProxyKeys.map(key => [key, null])) };
  const proxy = address(draft.url), noProxy = bypass(draft.noProxy);
  return { kind: 'environment', variables: { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: noProxy,
    http_proxy: proxy, https_proxy: proxy, no_proxy: noProxy } };
}
