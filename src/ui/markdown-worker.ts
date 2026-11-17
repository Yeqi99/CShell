import { parseMarkdown } from './markdown-document';
self.onmessage = ({ data }: MessageEvent<{ id: number; text: string }>) => {
  try { self.postMessage({ id: data.id, tree: parseMarkdown(data.text) }); }
  catch { self.postMessage({ id: data.id, tree: null }); }
};
