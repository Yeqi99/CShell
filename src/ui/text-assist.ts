export type TextAssistTarget = {
  mode: 'translate' | 'compose';
  text: string;
  label: string;
  read?: () => string | null;
  apply?: (text: string) => void;
  copy?: string;
  cut?: () => void;
  paste?: () => void;
};
export function openTextAssist(target: TextAssistTarget) {
  window.dispatchEvent(new CustomEvent('cshell:text-assist', { detail: target }));
}
export function analysisDraft(text: string, locale: string) {
  return (
    text.trim() +
    '\n\n' +
    (locale === 'zh-CN'
      ? '以上是当前我想咨询的相关情况，我的问题：'
      : 'The above is the context I would like to ask about. My question is:') +
    '\n'
  );
}
export function analyzeSelection(text: string) {
  if (!text.trim()) return;
  window.dispatchEvent(new Event('cshell:open-ai'));
  window.dispatchEvent(
    new CustomEvent('cshell:analyze-selection', {
      detail: analysisDraft(text, document.documentElement.lang),
    }),
  );
}
export function translationChunks(text: string): string[] {
  const result: string[] = [];
  let chunk = '',
    lines = 0;
  for (const line of text.split('\n')) {
    if (lines === 20 || chunk.length + line.length > 6000) {
      if (chunk.trim()) result.push(chunk);
      chunk = '';
      lines = 0;
    }
    if (line.length > 6000) {
      for (let i = 0; i < line.length; i += 6000) result.push(line.slice(i, i + 6000));
    } else {
      chunk += (lines ? '\n' : '') + line;
      lines++;
    }
  }
  if (chunk.trim()) result.push(chunk);
  return result;
}
