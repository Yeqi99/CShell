import type { McpSettings } from '../../shared/contracts';
import { useI18n } from '../i18n';
import { useState } from 'react';

export function ApiFileRoots({
  value,
  change,
}: {
  value: McpSettings['localFileRoots'];
  change: (value: NonNullable<McpSettings['localFileRoots']>) => void;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  return (
    <details>
      <summary>{cn ? '本机文件读取范围' : 'Local file read scope'}</summary>
      <p className="muted">
        {cn
          ? '所选目录及子目录默认只读，仅对当前调用方生效。修改操作须逐项授权并保存；不授予终端权限。'
          : 'Selected directories and descendants default to read-only for this caller. Grant and save mutation actions separately. No terminal access.'}
      </p>
      {(value ?? []).map((root) => (
        <div key={root.id}>
          <span>{root.path}</span>{' '}
          <button
            type="button"
            onClick={() => change((value ?? []).filter((r) => r.id !== root.id))}
          >
            {cn ? '移除范围' : 'Remove scope'}
          </button>
          <details>
            <summary>{cn ? '修改操作授权' : 'Mutation permissions'}</summary>
            {(['create', 'write', 'rename', 'delete', 'mkdir', 'rmdir', 'renameDirectory'] as const).map(
              (action, index) => (
                <label key={action}>
                  <input
                    type="checkbox"
                    checked={root.mutations?.includes(action) ?? false}
                    onChange={(event) =>
                      change(
                        (value ?? []).map((r) =>
                          r.id !== root.id
                            ? r
                            : {
                                ...r,
                                mutations: event.target.checked
                                  ? [...(r.mutations ?? []), action]
                                  : (r.mutations ?? []).filter((a) => a !== action),
                              },
                        ),
                      )
                    }
                  />
                  {cn
                    ? ['创建文件', '写入文件', '重命名文件', '删除文件', '创建目录', '删除空目录', '移动目录树'][
                        index
                      ]
                    : action}
                </label>
              ),
            )}
          </details>
        </div>
      ))}
      <button
        type="button"
        disabled={choosing || (value?.length ?? 0) >= 32}
        onClick={async () => {
          setChoosing(true);
          setError('');
          try {
            const root = await window.cshell.mcpChooseFileRoot();
            if (root && !(value ?? []).some((r) => r.path === root.path))
              change([...(value ?? []), root]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setChoosing(false);
          }
        }}
      >
        {cn ? '选择只读目录' : 'Choose read-only directory'}
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
