/** Only consecutive, explicitly independent reads can share an execution batch. */
export function* toolBatches<T>(calls: readonly T[], independent: (call: T) => boolean) {
  let batch: T[] = [];
  for (const call of calls) {
    if (!independent(call)) {
      if (batch.length) yield batch;
      batch = [];
      yield [call];
      continue;
    }
    batch.push(call);
    if (batch.length === 4) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}
