import { createElement, memo, useEffect, useRef, useState, Children, isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { parseMarkdown, type ParsedMarkdown } from '../markdown-document';
import { scheduleMarkdown } from '../markdown-queue';
import { CopyButton } from './AiCopyButton';
import { useI18n } from '../i18n';
import { navigatePermission } from '../permission-navigation';
import { parsePermissionHref } from '../../shared/permission-links';

function WebLink({ href, children }: {href: string; children: ReactNode}) {
  const {locale} = useI18n();
  const [failed, setFailed] = useState(false);
  return <><a href={href} onClick={event => {
    event.preventDefault();
    setFailed(false);
    void window.cshell.conversationLink(href, locale === 'en-US').catch(() => setFailed(true));
  }}>{children}</a>{failed && <small role="status">{locale === 'en-US' ? ' Could not open link options.' : ' 暂时无法打开链接选项。'}</small>}</>;
}

function textContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : String(child),
    )
    .join('');
}
const components: Components = {
  a({href,children}) {
    if(href && parsePermissionHref(href))return <a href={href} onClick={event=>{event.preventDefault();navigatePermission(href);}}>{children}</a>;
    if(href?.startsWith('#cshell-permission/'))return <span>{children}（权限链接无效）</span>;
    return href && /^https?:\/\//i.test(href) ? <WebLink href={href}>{children}</WebLink> : <span>{children}</span>;
  },
  pre({ children }) {
    const code = Children.toArray(children)[0];
    const language = isValidElement<{ className?: string }>(code)
      ? /language-(\S+)/.exec(code.props.className || '')?.[1]
      : undefined;
    const content = textContent(children).replace(/\n$/, '');
    return (
      <div className="agent-code">
        <header>
          <span>{language || '代码'}</span>
          <CopyButton content={content} />
        </header>
        <pre>{content}</pre>
      </div>
    );
  },
  table({ children }) {
    return (
      <div className="agent-table-scroll" tabIndex={0} role="region" aria-label="表格">
        <table>{children}</table>
      </div>
    );
  },
  // Model output must not load remote tracking images or execute embedded HTML.
  img({ alt }) {
    return <span className="agent-image-alt">{alt || '图片'}</span>;
  },
};
function renderTree(tree: ParsedMarkdown, key = 0): ReactNode {
  if (tree === null || typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(renderTree);
  const tag = components[tree.tag as keyof Components] ?? tree.tag;
  const children = renderTree(tree.children);
  return children == null || (Array.isArray(children) && !children.length)
    ? createElement(tag as React.ElementType, { ...tree.props, key })
    : createElement(tag as React.ElementType, { ...tree.props, key }, children);
}

export const AiMarkdown = memo(function AiMarkdown({ text }: { text: string }) {
  const key = useRef({});
  const latestText = useRef(text);
  latestText.current = text;
  const mounted = useRef(false);
  const [parsed, setParsed] = useState<{source: string; view: ReactNode}>();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => scheduleMarkdown(key.current, { text, accept: tree => {
    if (mounted.current && latestText.current.startsWith(text)) {
      setParsed({source: text, view: tree === null ? text : renderTree(tree)});
    }
  } }), [text]);
  const content = parsed && text.startsWith(parsed.source) ? parsed.view : text;
  return <div className="agent-markdown">{typeof window === 'undefined' ? renderTree(parseMarkdown(text)) : content}</div>;
});
