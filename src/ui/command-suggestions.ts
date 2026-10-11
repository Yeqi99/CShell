export const linuxCommands: Array<[string, string, string]> = [
  ['ls -lah', '查看文件', 'List files'],
  ['pwd', '当前目录', 'Working directory'],
  ['cd ', '切换目录', 'Change directory'],
  ['cat ', '查看文件内容', 'Read file'],
  ['less ', '分页查看', 'Page through file'],
  ['tail -f ', '跟踪日志', 'Follow logs'],
  ['head -n 20 ', '查看前 20 行', 'First 20 lines'],
  ['grep -n ', '搜索文本', 'Search text'],
  ['find . -name ', '查找文件', 'Find files'],
  ['mkdir -p ', '创建目录', 'Create directories'],
  ['cp -r ', '复制目录', 'Copy directory'],
  ['mv ', '移动或重命名', 'Move or rename'],
  ['du -sh ', '目录大小', 'Directory size'],
  ['df -h', '磁盘空间', 'Disk space'],
  ['free -h', '内存用量', 'Memory usage'],
  ['top', '进程监控', 'Process monitor'],
  ['ps aux', '进程列表', 'List processes'],
  ['ss -tulnp', '监听端口', 'Listening ports'],
  ['ip addr', '网络地址', 'Network addresses'],
  ['ping ', '测试连通性', 'Test connectivity'],
  ['curl -I ', '查看响应头', 'HTTP headers'],
  ['systemctl status ', '服务状态', 'Service status'],
  ['systemctl restart ', '重启服务', 'Restart service'],
  ['journalctl -u ', '服务日志', 'Service logs'],
  ['journalctl -f', '跟踪系统日志', 'Follow system logs'],
  ['chmod ', '修改权限', 'Change permissions'],
  ['chown ', '修改所有者', 'Change owner'],
  ['tar -czf ', '压缩归档', 'Create archive'],
  ['tar -xzf ', '解压归档', 'Extract archive'],
  ['uname -a', '系统信息', 'System information'],
  ['vim ', '编辑文件', 'Edit file'],
  ['nano ', '编辑文件', 'Edit file'],
  ['git status', '工作区状态', 'Working tree status'],
  ['git log --oneline', '提交记录', 'Commit history'],
  ['docker ps', '运行中的容器', 'Running containers'],
  ['docker ps -a', '全部容器', 'All containers'],
  ['docker images', '镜像列表', 'List images'],
  ['docker stats', '容器监控', 'Container statistics'],
  ['docker logs -f ', '跟踪容器日志', 'Follow container logs'],
  ['docker exec -it ', '进入容器', 'Execute in container'],
  ['docker start ', '启动容器', 'Start container'],
  ['docker stop ', '停止容器', 'Stop container'],
  ['docker inspect ', '容器详情', 'Inspect container'],
  ['docker compose ps', 'Compose 状态', 'Compose status'],
  ['docker compose up -d', '启动 Compose', 'Start Compose'],
  ['docker compose logs -f', 'Compose 日志', 'Compose logs'],
];
export function suggestCommands(input: string, commands = linuxCommands) {
  if (!input || input.length > 100 || /[\r\n\x00-\x1f;|&`$<>]/.test(input)) return [];
  const sudo = input.startsWith('sudo ') ? 'sudo ' : '';
  const query = input.slice(sudo.length);
  return commands
    .filter(([command]) => command.startsWith(query) && command !== query)
    .slice(0, 6)
    .map(([command, zh, en]) => ({ command: sudo + command, zh, en }));
}
export function shellPromptInput(line: string): string | null {
  // Suggestions require an ordinary prompt and recent typing; output/password prompts never suffice.
  if (/(?:password|passphrase|passcode|密码|口令)\s*[:：]/i.test(line)) return null;
  const match = line.match(/^(?:[^\r\n]*?)(?:[$#❯]) (.*)$/u);
  return match ? match[1] : null;
}
