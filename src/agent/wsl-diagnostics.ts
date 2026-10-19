/** Microsoft WSL troubleshooting codes; guidance never changes the host. */
export function wslGuidance(log:string):string[]{
 const result:string[]=[];
 if(/0x80370102|HCS_E_HYPERV_NOT_INSTALLED/i.test(log))result.push('检查 BIOS/UEFI 虚拟化和 Windows 虚拟机平台；云服务器还需要宿主机开放嵌套虚拟化。');
 if(/0x8007019e|WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED/i.test(log))result.push('缺少 Windows 的 WSL 组件，请使用管理员安装并按系统提示重启后重新检查。');
 if(/0x800701bc|WSL_E_WSL2_KERNEL_REQUIRED/i.test(log))result.push('WSL 内核需要更新，使用“更新 WSL”后重试。');
 if(/0x80072|0x800704cf|download|下载|network/i.test(log))result.push('检查目标机器网络与代理；可选择“直接下载”避开 Microsoft Store 下载链路。');
 if(/0x80070005|access is denied|拒绝访问|administrator|管理员|elevation/i.test(log))result.push('安装需要管理员权限；在该 Windows 主机确认管理员安装，或以管理员身份启动 CAgent。');
 return result;
}
export function wslInstallArgs(distribution:string,webDownload:boolean,update=false){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(distribution))throw Error('Invalid distribution');
 return [...(update?['--update']:['--install','--distribution',distribution,'--no-launch']),...(webDownload?['--web-download']:[])];
}
