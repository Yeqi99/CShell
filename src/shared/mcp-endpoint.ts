import { isPro } from './edition';
export const defaultMcpPort = (pro = isPro) => pro ? 3778 : 3777;
export const localMcpEndpoint = (port = defaultMcpPort()) => `http://127.0.0.1:${port}`;
