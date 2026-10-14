import { z } from 'zod';
export const wslNetworkInput = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(['nat', 'mirrored']),
    autoProxy: z.boolean(),
  })
  .strict();
export type WslNetworkInput = z.infer<typeof wslNetworkInput>;
export type WslNetworkState = {
  revision: string;
  mode: string;
  autoProxy: boolean;
  mirroredSupported: boolean;
  localhostProxy: boolean;
};
