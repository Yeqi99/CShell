import {useState} from 'react';
import {FilePenLine} from 'lucide-react';
import {useI18n} from '../i18n';
import {ErrorNotice} from './ErrorNotice';

export function AccountMemory() {
  const cn = useI18n().locale === 'zh-CN';
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function open() {
    setBusy(true);
    setError('');
    try {
      await window.cshell.cloudOpenMemoryFile();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return <section className="account-section account-memory">
    <h2>{cn?'用户记忆':'Personal memory'}</h2>
    <p>{cn?'智能体将你的长期偏好记在这个 Markdown 文件中。你可以直接编辑，保存后随账号同步。':'Your agent keeps long-term preferences in this Markdown file. You can edit it directly. Saved changes sync with your account.'}</p>
    <button type="button" disabled={busy} onClick={()=>void open()}>
      <FilePenLine size={16}/> {cn?'编辑 MEMORY.md':'Edit MEMORY.md'}
    </button>
    {error && <ErrorNotice title={cn?'无法打开记忆文件':'Unable to open memory file'} error={error}/>}
  </section>;
}
