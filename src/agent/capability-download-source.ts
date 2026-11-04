import type { CapabilityCatalogEntry } from './capability-catalog';

// Public immutable copies verified against the host-pinned package catalog.
// This is transport only: original manifest provenance and every digest still apply.
const copies: Record<string, string> = {
  'Weixin-4.1.15.56-0.1.3.cagent-package.json': 'a73b1767e46f2737021d4815b672d7f7b023b1cf6cdb381b3b391cb09e912e09',
  'Weixin-4.2.0.12-0.1.3.cagent-package.json': 'a044a1f1826613c775465a02cf16ec116f08a2df63791bd4d6e74a93de35a7ba',
  'Weixin-4.1.15.56-0.1.2.cagent-package.json': '52eb044cf5870124dbf704292c232225a6156658bc153ce3c8659cb85a7d33c4',
  'Weixin-4.2.0.12-0.1.2.cagent-package.json': 'aab70f092aed4a1b622be9a086cd89711b69d37bf401c11d18be9c6c6ffe4604',
};
export function capabilityDownloadSources(entry: CapabilityCatalogEntry): string[] {
  const original = entry.url ?? '';
  const match=/^https:\/\/github\.com\/Yeqi99\/CShell\/releases\/download\/wechat-toolkit-v(0\.1\.[23])\/(Weixin-[\d.]+-0\.1\.[23]\.cagent-package\.json)$/.exec(original);
  const version=match?.[1]??'';
  const name=match?.[2]??'';
  if (Object.hasOwn(copies, name) && copies[name] === entry.bundleSha256 && name.endsWith('-'+version+'.cagent-package.json'))
    return ['https://shell.canp.ai/downloads/toolkit/v'+version+'/' + name, original];
  return [original];
}

export async function openCapabilityDownload(entry: CapabilityCatalogEntry, download: typeof fetch, signal: AbortSignal) {
  const request = async (url: URL, redirect: RequestRedirect) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('Package connection timed out')), 30000);
    try { return await download(url, {signal: AbortSignal.any([signal, timeout.signal]), redirect}); }
    finally { clearTimeout(timer); }
  };
  const sources = capabilityDownloadSources(entry);
  for (let i = 0; i < sources.length; i++) {
    try {
      signal.throwIfAborted();
      const url = new URL(sources[i]);
      let response = await request(url, 'manual');
      if ([301,302,303,307,308].includes(response.status)) {
        const next = new URL(response.headers.get('location') ?? '', url);
        await response.body?.cancel();
        if (url.hostname !== 'github.com' || next.protocol !== 'https:' || next.hostname !== 'release-assets.githubusercontent.com' || next.port || next.username || next.password)
          throw new Error('Unexpected package asset redirect');
        response = await request(next, 'error');
      }
      if (response.ok && response.body) return response;
      await response.body?.cancel();
      throw new Error(`Package download failed: ${response.status}`);
    } catch (error) {
      signal.throwIfAborted();
      // No direct-network bypass: each attempt uses the same system proxy transport.
      if (i === sources.length - 1 || (error instanceof Error && error.message.includes('redirect'))) throw error;
    }
  }
  throw new Error('Package download unavailable');
}
