/** Only fixed diagnostic codes and numeric Win32 errors leave the native boundary. */
export function desktopInputFailure(error:string):{code:string;message:string}{
 const win32=error.match(/\bwin32=(\d{1,10})\b/)?.[1];
 if(error.includes('INPUT_LEASE_EXPIRED'))return {code:'INPUT_LEASE_EXPIRED',message:'输入心跳超过 5 秒，已释放按键；请重新连接以恢复控制'};
 if(error.includes('INPUT_PERMISSION_DENIED')||error==='input permission denied')return {code:'INPUT_PERMISSION_DENIED',message:'当前输入授权已失效，请重新连接'};
 if(/SECURE|DESKTOP_UNAVAILABLE|DIFFERENT_DESKTOP/.test(error))return {code:'INPUT_DESKTOP_UNAVAILABLE',message:'Windows 当前输入桌面不可访问，请检查锁屏或登录会话'};
 if(error.includes('UIPI'))return {code:'INPUT_OS_REJECTED',message:'Windows 拒绝注入键鼠输入'+(win32?'，Win32 '+win32:'')+'；请检查目标窗口权限及会话'};
 if(error.includes('DISPLAY_CHANGED'))return {code:'INPUT_DISPLAY_CHANGED',message:'显示器范围已变化，请重新连接以刷新坐标映射'};
 if(error.includes('CAPTURE_NOT_READY'))return {code:'INPUT_NOT_READY',message:'采集初始化尚未完成，请稍后重新连接'};
 if(error==='stale input event'||error==='stale input generation')return {code:'INPUT_STALE_EVENT',message:'输入事件属于旧会话状态，请重新连接'};
 if(error==='key not owned by session'||error==='button not owned by session')return {code:'INPUT_LATE_RELEASE',message:'收到已释放按键的松开事件，请更新远端 cagent'};
 return {code:'INPUT_INVALID_EVENT',message:'远端输入事件处理失败，请重新连接并查看此错误码'};
}
