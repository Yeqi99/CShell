import { Children, isValidElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkCjkStrong } from '../markdown-strong';
import { CopyButton } from './AiCopyButton';
import { navigatePermission } from '../permission-navigation';
import { parsePermissionHref } from '../../shared/permission-links';

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
    return <a href={href}>{children}</a>;
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
export function AiMarkdown({ text }: { text: string }) {
  return (
    <div className="agent-markdown">
      <Markdown remarkPlugins={[remarkGfm, remarkCjkStrong]} skipHtml components={components}>
        {text}
      </Markdown>
    </div>
  );
}
