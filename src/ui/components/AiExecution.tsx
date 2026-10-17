import { useEffect, useRef, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import type { AiThread } from '../../shared/ai';

export function AiExecution({ enabled, sessionId }: { enabled: boolean; sessionId?: string }) {
  const [items, setItems] = useState<NonNullable<AiThread['execution']>[]>([]);
  const [dismissed, setDismissed] = useState('');
  const viewport = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    return window.cshell.onAiThread((thread) => {
      if (!thread.execution) return;
      const execution = thread.execution;
      setItems((old) =>
        old.some((item) => item.id === execution.id)
          ? old.map((item) => (item.id === execution.id ? execution : item))
          : [...old, execution].slice(-12),
      );
    });
  }, [enabled]);
  const item = [...items].reverse().find((entry) => entry.sessionId === sessionId);
  useEffect(() => {
    follow.current = true;
  }, [item?.id]);
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [item?.output, item?.id]);
  if (!enabled || !item || item.id === dismissed) return null;
  return (
    <section className="ai-execution" aria-label="智能体执行过程">
      <header>
        <Terminal size={14} />
        <strong>智能体执行</strong>
        <span role="status">
          {item.state === 'running'
            ? '正在执行'
            : item.state === 'error'
              ? '执行出错'
              : '调用已返回'}
        </span>
        <button
          className="icon"
          title="收起本次执行过程"
          aria-label="收起本次执行过程"
          onClick={() => setDismissed(item.id)}
        >
          <X size={14} />
        </button>
      </header>
      <pre
        ref={viewport}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <code className="ai-execution-command">{'$ ' + item.input + '\n'}</code>
        {item.output || (item.state === 'running' ? '等待返回内容…' : '（无输出）')}
      </pre>
    </section>
  );
}
