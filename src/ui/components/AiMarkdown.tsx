import { Children, isValidElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyButton } from './AiCopyButton';

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
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </Markdown>
    </div>
  );
}
