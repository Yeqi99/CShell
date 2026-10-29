export type PingResult = { method: 'icmp'; elapsedMs: number | null; lessThan?: boolean; status: 'reply' | 'unreachable' | 'unsupported'; checkedAt: number };
