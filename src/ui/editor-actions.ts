import type { EditorKind } from './editor-detection';
export type EditorAction =
  | 'normal'
  | 'insert'
  | 'append'
  | 'visual'
  | 'visualLine'
  | 'visualBlock'
  | 'replace'
  | 'cancel'
  | 'exitAll'
  | 'saveExitAll'
  | 'discard'
  | 'discardCurrent'
  | 'first'
  | 'last'
  | 'search'
  | 'next'
  | 'previous'
  | 'line'
  | 'undo'
  | 'redo'
  | 'save'
  | 'saveExit'
  | 'exit';
export function editorActionInput(
  kind: EditorKind,
  action: EditorAction,
  value = '',
  modern = false,
  nanoSearch = 'Ctrl+W',
): string {
  if (kind === 'vim') {
    const normal = '\x1c\x0e';
    if (action === 'normal' || action === 'cancel') return normal;
    const modes: Partial<Record<EditorAction, string>> = {
      insert: 'i',
      append: 'A',
      visual: 'v',
      visualLine: 'V',
      visualBlock: '\x16',
      replace: 'R',
    };
    if (modes[action]) return normal + modes[action];
    const commands: Partial<Record<EditorAction, string>> = {
      first: 'normal! gg',
      last: 'normal! G',
      next: 'normal! n',
      previous: 'normal! N',
      undo: 'undo',
      redo: 'redo',
      save: 'write',
      saveExit: 'wq',
      exit: 'quit',
      exitAll: 'qall',
      saveExitAll: 'wall|qall',
      discard: 'qall!',
      discardCurrent: 'quit!',
    };
    if (action === 'line') {
      if (!/^[1-9]\d{0,8}$/.test(value)) throw new Error('INVALID_LINE');
      return normal + ':' + value + '\r';
    }
    if (action === 'search') {
      if (!value || value.length > 512 || /[\x00-\x1f\x7f\u2028\u2029]/.test(value))
        throw new Error('INVALID_SEARCH');
      // Vim single-quoted expressions only escape single quotes; literal search escapes backslashes.
      const pattern = ('\\V' + value.replaceAll('\\', '\\\\')).replaceAll("'", "''");
      return normal + ":let @/ = '" + pattern + "'\r:call search(@/, 'w')\r";
    }
    if (!commands[action]) throw new Error('UNSUPPORTED_ACTION');
    return normal + ':' + commands[action] + '\r';
  }
  const keys: Partial<Record<EditorAction, string>> = {
    cancel: '\x03',
    first: '\x1b\\',
    last: '\x1b/',
    search: modern || nanoSearch === 'Ctrl+F' ? '\x06' : '\x17',
    next: modern ? '\x07' : nanoSearch === 'Ctrl+F' ? '\x1bf' : '\x1bw',
    line: modern ? '\x14' : '\x1bg',
    undo: modern ? '\x1a' : '\x1bu',
    redo: modern ? '\x19' : '\x1be',
    save: modern ? '\x13' : '\x0f',
    exit: modern ? '\x11' : '\x18',
  };
  if (!keys[action]) throw new Error('UNSUPPORTED_ACTION');
  return keys[action]!;
}
export function vimExitFromPrompt(lines: string[], action: EditorAction) {
  return (
    ['exit', 'saveExit', 'exitAll', 'saveExitAll', 'discard', 'discardCurrent'].includes(action) &&
    /Press ENTER|按.*(?:ENTER|回车)/i.test(lines.slice(-4).join('\n'))
  );
}
export function editorPromptBusy(lines: string[], kind: EditorKind) {
  const bottom = lines.slice(-4).join('\n');
  return kind === 'nano'
    ? /\^C\s*(?:Cancel|取消|Abbrechen)|(?:File Name to Write|Write to File|Save modified buffer|保存修改|写入文件名)\s*[:?]?/i.test(
        bottom,
      )
    : /Press ENTER|按.*(?:ENTER|回车)|--\s*More\s*--|--\s*更多\s*--/i.test(bottom);
}
