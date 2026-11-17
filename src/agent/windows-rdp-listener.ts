import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';

const listenerScript = `
$ErrorActionPreference='Stop'
$settings=Get-CimInstance -Namespace root/cimv2/TerminalServices -ClassName Win32_TSGeneralSetting -Filter "TerminalName='RDP-tcp'"
$pin=$settings.SSLCertificateSHA1Hash
if(!$pin -or (Get-Service TermService).Status -ne 'Running'){throw 'Listener unavailable'}
$cert=Get-ChildItem 'Cert:/LocalMachine/Remote Desktop','Cert:/LocalMachine/My' | Where-Object Thumbprint -eq $pin | Select-Object -First 1
if(!$cert){throw 'Certificate unavailable'}
$port=(Get-ItemProperty 'HKLM:/SYSTEM/CurrentControlSet/Control/Terminal Server/WinStations/RDP-Tcp' -Name PortNumber).PortNumber
$sha=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)).Replace('-','').ToLowerInvariant()
@{port=[int]$port;sha256=$sha}|ConvertTo-Json -Compress
`;
export async function windowsRdpListener() {
  if (process.platform !== 'win32') throw Error('此机器不支持 Windows RDP');
  const exe = join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const {stdout} = await promisify(execFile)(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(listenerScript,'utf16le').toString('base64')],{windowsHide:true,timeout:8000,maxBuffer:65536});
  return z.object({port:z.number().int().min(1).max(65535),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(JSON.parse(stdout.trim()));
}
export async function windowsRdpFingerprint() {
  const {sha256}=await windowsRdpListener();
  return {sha256};
}

/** Validate the accepted side of this exact TCP connection before forwarding any caller bytes. */
export async function ownsWindowsRdpSocket(port:number, sourcePort:number) {
  const portSchema=z.number().int().min(1).max(65535);
  const script=`$ErrorActionPreference='Stop'
$service=Get-CimInstance Win32_Service -Filter "Name='TermService'"
$connections=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort ${portSchema.parse(port)} -RemoteAddress '127.0.0.1' -RemotePort ${portSchema.parse(sourcePort)} -State Established)
if($service.State -eq 'Running' -and $service.ProcessId -gt 0 -and $connections.Count -eq 1 -and $connections[0].OwningProcess -eq $service.ProcessId){'owned'}`;
  const exe=join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=await promisify(execFile)(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:8000,maxBuffer:65536});
  return result.stdout.trim()==='owned';
}
