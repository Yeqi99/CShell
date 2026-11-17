import { BrowserWindow, clipboard, dialog, shell } from 'electron';

export async function chooseConversationLink(value: unknown, english: boolean) {
  if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid link');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported link');
  }
  const options = {
    title: english ? 'Web link' : '网页链接',
    message: url.hostname,
    detail: url.href,
    buttons: english ? ['Open in default browser', 'Copy link', 'Cancel'] : ['用默认浏览器打开', '复制链接', '取消'],
    defaultId: 0, cancelId: 2, noLink: true,
  };
  const parent = BrowserWindow.getFocusedWindow();
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response === 0) await shell.openExternal(url.href);
  if (response === 1) clipboard.writeText(url.href);
}
