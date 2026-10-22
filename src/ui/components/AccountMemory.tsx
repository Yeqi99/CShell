import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import type { AccountHabit } from '../../shared/account-memory';
export function AccountMemory() {
  const [items, setItems] = useState<AccountHabit[]>([]),
    [draft, setDraft] = useState(''),
    [editing, setEditing] = useState<string>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = () =>
      window.cshell
        .cloudMemory()
        .then((v) => {
          if (alive) setItems(v);
        })
        .catch(() => {});
    void read();
    const timer = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      setItems(await window.cshell.cloudRemember({ id: editing, text: draft }));
      setDraft('');
      setEditing(undefined);
    } catch (e) {
      setError('未能保存，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="account-section account-memory">
      <h2>
        用户习惯记忆 <span>{items.length}</span>
      </h2>
      <p className="memory-caption">你和智能体共同维护的长期偏好，随账号同步。</p>
      {items.map((item) => (
        <div className="memory-item" key={item.id}>
          <p>{item.text}</p>
          <button
            aria-label="编辑记忆"
            title="编辑记忆"
            onClick={() => {
              setEditing(item.id);
              setDraft(item.text);
            }}
          >
            <Pencil size={14} />
          </button>
          <button
            aria-label="删除记忆"
            title="删除记忆"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setItems(await window.cshell.cloudForget(item.id));
              } catch {
                setError('未能删除，请稍后重试。');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <textarea
          aria-label="习惯内容"
          placeholder="例如：默认使用中文，代码示例优先使用 TypeScript"
          maxLength={2000}
          required
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div>
          <button disabled={busy || !draft.trim()} type="submit">
            {editing ? <Check size={14} /> : <Plus size={14} />} {editing ? '保存修改' : '添加记忆'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(undefined);
                setDraft('');
              }}
            >
              <X size={14} />
              取消
            </button>
          )}
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
