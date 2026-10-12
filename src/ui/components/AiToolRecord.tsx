import type { AiMessage } from '../../shared/ai';
import { Terminal } from 'lucide-react';
import { CopyButton } from './AiCopyButton';
export function toolInput(value: string) {
  try {
    const input = JSON.parse(value);
    if (input && typeof input === 'object' && !Array.isArray(input) && !Object.keys(input).length)
      return '';
    return JSON.stringify(input, null, 2);
  } catch {
    return value;
  }
}
export function AiToolRecord({ message }: { message: AiMessage }) {
  const [name = '', input = '', ...output] = message.content.split('\n');
  const record = message.tool ?? { name, input, output: output.join('\n') };
  const parameters = toolInput(record.input);
  return (
    <details className="agent-tool">
      <summary>
        <Terminal size={13} />
        <span>{record.name}</span>
        <small>{record.output.startsWith('Error:') ? '执行失败' : '执行结果'}</small>
      </summary>
      {record.target && <div className="agent-tool-target">目标 · {record.target}</div>}
      {parameters && (
        <section>
          <header>
            输入
            <CopyButton content={parameters} />
          </header>
          <pre>{parameters}</pre>
        </section>
      )}
      <section>
        <header>
          返回
          <CopyButton content={record.output} />
        </header>
        <pre>{record.output}</pre>
      </section>
    </details>
  );
}
