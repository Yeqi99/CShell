import { isValidElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkCjkStrong } from './markdown-strong';

// Only Markdown's intrinsic elements and JSON-safe props cross the worker boundary.
export type ParsedMarkdown = string | null | ParsedMarkdown[] | {
  tag: string;
  props: Record<string, unknown>;
  children: ParsedMarkdown;
};

function serialize(node: ReactNode): ParsedMarkdown {
  if (Array.isArray(node)) return node.map(serialize);
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  const { children, ...props } = node.props;
  const nested = serialize(children as ReactNode);
  return typeof node.type === 'string' ? { tag: node.type, props, children: nested } : nested;
}
export function parseMarkdown(text: string) {
  return serialize(Markdown({ children: text, skipHtml: true, remarkPlugins: [remarkGfm, remarkCjkStrong] }));
}
