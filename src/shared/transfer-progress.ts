import type { Transfer } from './contracts';
/** Counts actual stream/chunk bytes; monotonic elapsed time excludes queue waiting. */
export class TransferMeter {
  private started: number;
  constructor(private now: () => number = () => performance.now()) { this.started = now(); }
  update(state: Transfer) {
    const seconds = (this.now() - this.started) / 1000;
    state.bytesPerSecond = !state.queued && state.state === 'running' && seconds >= .1
      ? Math.max(0, state.done / seconds) : undefined;
  }
}
export function formatFileBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const unit = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log2(bytes || 1) / 10)));
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}
export function transferDetail(t: Transfer): string {
  if (t.queued && t.state === 'running') return '等待传输';
  const known = t.totalKnown === true || t.state === 'done';
  const size = known ? `${formatFileBytes(t.done)} / ${formatFileBytes(t.total)}` : `已传输 ${formatFileBytes(t.done)}`;
  const percent = known && t.total > 0 ? ` · ${Math.min(t.state === 'done' ? 100 : 99, Math.floor(t.done / t.total * 100))}%` : '';
  const speed = t.state === 'running' && t.bytesPerSecond !== undefined ? ` · 平均 ${formatFileBytes(t.bytesPerSecond)}/s` : '';
  return size + percent + speed;
}

/** One CAgent operation; publish only bytes acknowledged by remote writes or local file writes. */
export function createTransferProgress(id:string, target:string, name:string, direction:Transfer['direction'], emit:(state:Transfer)=>void, now:()=>number=()=>performance.now()) {
  const state:Transfer={id,sessionId:target,name,direction,done:0,total:0,state:'running'};
  const meter=new TransferMeter(now);let last=0;
  const update=(done:number,total:number,known:boolean,nameOverride?:string)=>{state.done=done;state.total=total;state.totalKnown=known;if(nameOverride)state.name=nameOverride;const time=now();if(time-last>=100){last=time;meter.update(state);emit({...state});}};
  const finish=(status:Transfer['state'])=>{state.state=status;if(status==='done'&&!state.totalKnown){state.total=state.done;state.totalKnown=true;}meter.update(state);emit({...state});};
  emit({...state});return {update,finish};
}
