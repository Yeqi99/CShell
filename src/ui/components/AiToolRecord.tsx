import type { AiMessage } from '../../shared/ai';
import { Activity, ChevronRight, Terminal } from 'lucide-react';
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
const toolLabels: Record<string, string> = {
  list_agents: '查看子任务',
  list_member_domains: '查询会员域名',
  connect_machine: '连接机器',
  spawn_agent: '创建子任务',
  member_site_workflow: '运行建站流程',
  wait_agent: '等待子任务',
  task_wait: '等待任务',
};

function readRecord(message: AiMessage) {
  if (message.tool) return message.tool;
  const [name = '', input = '', ...output] = message.content.split('\n');
  return { name, input, output: output.join('\n'), target: undefined };
}

export function conversationRows(messages: AiMessage[]) {
  const rows: { index: number; message: AiMessage; tools?: AiMessage[] }[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && !message.content.trim()) return;
    const previous = rows.at(-1);
    if (message.role === 'tool' && previous?.tools) previous.tools.push(message);
    else rows.push({ index, message, tools: message.role === 'tool' ? [message] : undefined });
  });
  return rows;
}

export function ToolActivity({ messages }: { messages: AiMessage[] }) {
  if (messages.length === 1) return <AiToolRecord message={messages[0]} />;
  const records = messages.map(readRecord);
  const failed = records.filter(record => record.output.startsWith('Error:')).length;
  const last = records[records.length - 1];
  return <details className="agent-activity">
    <summary><Activity size={14} /><strong>{messages.length} 项工具操作</strong>
      <span className={failed ? 'tool-failure' : ''}>{failed ? `${failed} 项失败` : toolLabels[last.name] ?? last.name}</span>
      <ChevronRight size={13} className="activity-chevron" />
    </summary>
    <div className="activity-steps">{messages.map((message, i) =>
      <AiToolRecord key={i} message={message} />)}</div>
  </details>;
}

export function AiToolRecord({ message }: { message: AiMessage }) {
  const record = readRecord(message);
  const parameters = toolInput(record.input);
  return (
    <details className="agent-tool">
      <summary>
        <Terminal size={13} />
        <span title={record.name}>{toolLabels[record.name] ?? record.name}</span>
        {record.output.startsWith('Error:') && <small className="tool-failure">失败</small>}
      </summary>
      {toolLabels[record.name] && <code className="agent-tool-target">{record.name}</code>}
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
