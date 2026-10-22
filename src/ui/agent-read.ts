/** Retry transient connection setup failures for reads only. Never retry mutations. */
export async function agentRead<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++)
    try {
      return await read();
    } catch (error) {
      if (
        attempt >= 2 ||
        !/socket|network|ECONN|TLS|disconnected|timeout|尚未连接|断开/i.test(String(error))
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
}
