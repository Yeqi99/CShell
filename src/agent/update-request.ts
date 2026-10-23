import { request } from 'node:https';
import { Readable } from 'node:stream';

/** A single owned HTTPS request: abort also closes a connection still opening. */
export function updateRequest(url: string, options: { signal: AbortSignal; headers?: Record<string,string> }): Promise<Response> {
  return new Promise((resolve, reject) => {
    options.signal.throwIfAborted();
    const req = request(url, { method: 'GET', agent: false, signal: options.signal, headers: options.headers }, response => {
      // No redirects: update locations are validated before a request is made.
      const status = response.statusCode ?? 500;
      if (status !== 200) {
        response.resume();
        req.destroy();
        resolve(new Response(null, { status }));
        return;
      }
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status }));
    });
    req.once('error', reject);
    req.end();
  });
}
