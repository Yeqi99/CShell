import { isDeepStrictEqual as equal } from 'node:util';
export class CloudImportConflict extends Error {
  constructor(message = '云端恢复期间本机配置已变化，已保留修改并暂停自动同步') {
    super(message); this.name = 'CloudImportConflict';
  }
}
export interface CloudImportStage {
  read(): unknown | Promise<unknown>;
  value: unknown;
  apply(value: unknown): Promise<void>;
  restore(value: unknown): Promise<void>;
}
/** Roll back only fields still owned by the failed import. Arrays and permission
 * objects remain atomic: never synthesize expanded grants by merging policies. */
export function undoImportedFields(before: unknown, imported: unknown, current: unknown): { value: unknown; conflict: boolean } {
  if (equal(current, imported)) return { value: structuredClone(before), conflict: false };
  if (equal(current, before) || equal(imported, before)) return { value: structuredClone(current), conflict: false };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (record(before) && record(imported) && record(current)) {
    const result = { ...current }; let conflict = false;
    for (const key of new Set([...Object.keys(before), ...Object.keys(imported)])) {
      if (equal(before[key], imported[key])) continue;
      if (equal(current[key], imported[key])) {
        if (Object.hasOwn(before, key)) result[key] = structuredClone(before[key]); else delete result[key];
      } else if (!equal(current[key], before[key])) conflict = true;
    }
    return { value: result, conflict };
  }
  return { value: structuredClone(current), conflict: true };
}
export async function importCloudStages(stages: CloudImportStage[], commit: () => Promise<void>) {
  const undo: Array<{stage: CloudImportStage; before: unknown; imported: unknown}> = [];
  try {
    for (const stage of stages) {
      const before = structuredClone(await stage.read());
      const imported = structuredClone(stage.value);
      undo.push({ stage, before, imported });
      await stage.apply(structuredClone(imported));
    }
    await commit();
  } catch (error) {
    let conflict = error instanceof CloudImportConflict;
    for (const {stage, before, imported} of undo.reverse()) {
      try {
        const current = await stage.read();
        const next = undoImportedFields(before, imported, current);
        conflict ||= next.conflict;
        if (!equal(current, next.value)) {
          // Do not overwrite edits made while an asynchronous export completed.
          if (!equal(current, await stage.read())) { conflict = true; continue; }
          await stage.restore(next.value);
        }
      } catch { conflict = true; }
    }
    if (conflict) throw new CloudImportConflict('云端恢复未完成；并发修改已保留，自动同步已暂停，请核对本机与云端配置');
    throw error;
  }
}
