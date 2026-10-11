export type EditorKind = 'vim' | 'nano';
export type EditorDetection = {
  kind: EditorKind;
  nanoModern: boolean;
  nanoSearch: 'Ctrl+W' | 'Ctrl+F';
};

/** Screen evidence only: never search scrollback or send a probe to the remote shell. */
export function detectEditor(lines: string[], alternate: boolean): EditorDetection | null {
  if (!alternate) return null;
  const top = lines.slice(0, 3).join('\n');
  const bottom = lines.slice(-3).join('\n');
  if (/\bGNU nano\b/i.test(top)) {
    return {
      kind: 'nano',
      nanoModern: /\^Q\s/.test(bottom) && /\^X\s/.test(bottom),
      nanoSearch: /\^F\s/.test(bottom) ? 'Ctrl+F' : 'Ctrl+W',
    };
  }
  const tildeRows = lines.filter((line) => /^\s*~\s*$/.test(line)).length;
  const welcome = /(?:VIM - Vi IMproved|NVIM v\d|type\s+:help|键入\s*:help)/i.test(
    lines.join('\n'),
  );
  const position = /\d+,\d+(?:-\d+)?\s+(?:All|Top|Bot|\d+%|全部|顶端|底端)\s*$/i.test(bottom);
  const mode =
    /^\s*-- (?:INSERT|REPLACE|VISUAL(?: LINE| BLOCK)?|插入|替换|可视(?: 行| 块)?) --/m.test(bottom);
  if (position || (tildeRows >= 2 && (welcome || mode)))
    return { kind: 'vim', nanoModern: false, nanoSearch: 'Ctrl+W' };
  return null;
}

/** A typed launch is just a hint and must coincide with entering a full-screen buffer. */
export function editorFromCommand(command: string): EditorKind | null {
  const match = command
    .trim()
    .match(/^(?:sudo\s+(?:-u\s+[\w-]+\s+)?)?(?:[\w./-]*\/)?(vim|nvim|vi|view|nano)(?:\s|$)/);
  if (!match || /[|;&\n\r]/.test(command)) return null;
  return match[1] === 'nano' ? 'nano' : 'vim';
}
