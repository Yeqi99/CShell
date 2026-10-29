/** Public authentication diagnostics: never expose storage paths or submitted secrets. */
export function clientAuthError(error: unknown): string {
 const message = error instanceof Error ? error.message : '';
 switch (message) {
 case 'Invalid invitation': return 'CAgent 配对已失效，请在连接设置中使用密码重新认证';
 case 'Invalid password': return 'CAgent 密码认证失败，请检查密码或目标端是否修改了连接设置';
 case 'Authentication rate limited': return 'CAgent 认证尝试过多，请等待一分钟后重试';
 case 'Peer limit': return 'CAgent 已达到配对设备上限，请在目标端检查已配对设备';
 case 'Revoked': return 'CAgent 配对在认证期间被撤销，请核对目标端授权';
 case 'Already authenticated': return 'CAgent 此连接已完成认证，请重新建立连接';
 default: return 'CAgent 无法完成认证或保存配对，请检查目标端日志与存储状态';
 }
}
