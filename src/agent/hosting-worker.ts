// Runs only in a separate Node process. This is fault containment, not a permission sandbox.
export const hostingWorkerSource = String.raw`
process.once('message', async ({code, request}) => {
  try {
    const run = new (Object.getPrototypeOf(async function(){}).constructor)('request', code);
    const result = await run(request);
    const body = typeof result === 'string' ? result : String(result?.body ?? '');
    if (Buffer.byteLength(body) > 65536) throw new Error('代码响应超过 64 KiB');
    process.send({ok:true, result: typeof result === 'string' ? {body} : {...(result?.status == null ? {} : {status:result.status}), ...(result?.headers == null ? {} : {headers:result.headers}), body}});
  } catch (error) {
    process.send({ok:false, error:String(error?.message ?? error).slice(0,1000)});
  }
});
`;
