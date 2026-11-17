import { z } from 'zod';

export function friendActionReceipt(httpStatus: number, payload: unknown, requestId: string, action: 'accept' | 'invite') {
  const row = z.object({
    requestId: z.literal(requestId), state: z.string().optional(), nativeActionsAvailable: z.boolean().optional(),
    friend: z.string().optional(), invite: z.string().optional()
  }).parse(payload);
  const receipt = { requestId, httpStatus };
  if (httpStatus === 501 && row.nativeActionsAvailable === false)
    return { ...receipt, status: 'unsupported', nativeActionsAvailable: false };
  if (httpStatus === 200) {
    if (action === 'accept' && row.friend === 'confirmed') return { ...receipt, status: 'confirmed' };
    if (action === 'invite' && (row.invite === 'invited' || row.invite === 'joined'))
      return { ...receipt, status: row.invite };
  }
  if ([200, 202, 409].includes(httpStatus))
    return { ...receipt, status: 'requires-reconciliation', nextAction: 'read', replay: false };
  throw Error('WECHAT_HTTP_' + httpStatus);
}
