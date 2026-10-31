import {formatFileBytes} from './transfer-progress';

/** Presentation only: raw byte counts remain available for progress and verification. */
export function formatUpdateProgress(bytes:unknown,total:unknown):string {
  const received=typeof bytes==='number'&&Number.isFinite(bytes)&&bytes>=0?formatFileBytes(bytes):'—';
  const expected=typeof total==='number'&&Number.isFinite(total)&&total>0?formatFileBytes(total):'总大小未知';
  return `${received} / ${expected}`;
}
