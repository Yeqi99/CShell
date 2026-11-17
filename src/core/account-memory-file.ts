import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { habitsSchema, type AccountHabit } from '../shared/account-memory';

const heading = '# 用户记忆';
const marker = /^<!-- cshell-memory:([0-9a-f-]{36}) -->\r?$/gm;
const maxBytes = 16 * 1024 * 1024;

function stableId(seed: string) {
  const hex = createHash('sha256').update(seed).digest('hex');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
}

/** MEMORY.md is the editable source. The portable habits array also works with older clients. */
export class AccountMemoryFile {
  readonly path: string;
  constructor(private directory: string) { this.path = join(directory, 'MEMORY.md'); }

  read(previous: AccountHabit[]): AccountHabit[] {
    let info;
    try { info = statSync(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return previous; throw error; }
    if (info.size > maxBytes) throw Error('MEMORY.md 超过 16 MiB，请精简文件后重试');
    const body = readFileSync(this.path, 'utf8').replace(/^\uFEFF/, '').replace(/^# 用户记忆(?:\r?\n|$)/, '');
    const marks = [...body.matchAll(marker)];
    const entries: AccountHabit[] = [];
    const saved = new Map(previous.map(item => [item.id, item]));
    const used = new Set<string>();
    function add(section: string, firstId?: string) {
      let remaining = section.trim();
      while (remaining) {
        let end = Math.min(2000, remaining.length);
        if (remaining.length > end) {
          const newline = remaining.lastIndexOf('\n', end);
          if (newline > 0) end = newline;
          else if (/[\uD800-\uDBFF]/.test(remaining[end-1])) end--;
        }
        const text = remaining.slice(0,end).trim();
        let id = firstId ?? stableId(entries.length+'\n'+text);
        if (used.has(id)) id = stableId(entries.length+'\n'+id+'\n'+text);
        const prior = saved.get(id);
        entries.push(prior?.text === text ? prior : {id,text,updatedAt:info!.mtime.toISOString()});
        used.add(id);
        firstId = undefined;
        remaining = remaining.slice(end).trimStart();
      }
    }
    add(body.slice(0, marks[0]?.index ?? body.length));
    marks.forEach((match,i) => add(body.slice(match.index! + match[0].length, marks[i+1]?.index ?? body.length),match[1]));
    return habitsSchema.parse(entries);
  }

  write(items: AccountHabit[]) {
    mkdirSync(this.directory, {recursive:true});
    const contents = [heading, ...items.map(item => '<!-- cshell-memory:'+item.id+' -->\n'+item.text)].join('\n\n')+'\n';
    const tmp = this.path+'.'+randomUUID()+'.tmp';
    writeFileSync(tmp, contents, {mode:0o600, flag:'wx'});
    renameSync(tmp,this.path);
  }
}
