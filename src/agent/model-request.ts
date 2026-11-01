import { requestAiReply } from '../core/ai-request';
import { updateRequest } from './update-request';

/** Standalone CAgent has no Electron session to inherit the system proxy. */
const modelTransport: typeof fetch = async (input, init) => {
  const url = String(input);
  if (new URL(url).protocol !== 'https:') return fetch(input, init);
  if (init?.body !== undefined && typeof init.body !== 'string') throw Error('不支持的模型请求格式');
  return updateRequest(url, {
    signal: init?.signal ?? new AbortController().signal,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    method: init?.method ?? 'GET',
    body: init?.body,
  });
};
export const requestAgentModel: typeof requestAiReply = (url, init, signal, onContent, limits) =>
  requestAiReply(url, init, signal, onContent, limits, modelTransport);
