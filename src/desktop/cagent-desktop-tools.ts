import { desktopCapturer, screen } from 'electron';
import { z } from 'zod';
import { AgentTerminalProvider } from '../core/agent-terminal';
import type { ConnectionTool } from '../core/connections/contracts';

const fraction = z.number().min(0).max(1);
const position = z
  .object({ x: fraction, y: fraction, screenshot: z.boolean().default(false) })
  .strict();
const action = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['inspect', 'windows']) }).strict(),
  z.object({ action: z.literal('focus'), handle: z.string().regex(/^\d{1,16}$/) }).strict(),
  z.object({ action: z.literal('controls'), handle: z.string().regex(/^\d{1,16}$/) }).strict(),
  z.object({ action: z.literal('type'), text: z.string().min(1).max(1500) }).strict(),
  z.object({ action: z.literal('keys'), keys: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.enum(['rightClick', 'doubleClick']), x: fraction, y: fraction }).strict(),
  z
    .object({ action: z.literal('drag'), x: fraction, y: fraction, toX: fraction, toY: fraction })
    .strict(),
  z
    .object({
      action: z.literal('scroll'),
      x: fraction,
      y: fraction,
      ticks: z.number().int().min(-30).max(30),
    })
    .strict(),
]);
const interaction = z
  .object({ operation: action, screenshot: z.boolean().default(false) })
  .strict();
const commandInput = z
  .object({
    shell: z.enum(['powershell', 'cmd', 'sh', 'bash', 'zsh']).default(process.platform === 'win32' ? 'powershell' : 'sh'),
    command: z.string().min(1).max(16384),
    timeoutMs: z.number().int().min(1).max(300000).default(30000),
  })
  .strict();

export function cagentDesktopTools(enabled: () => boolean) {
  const terminal = new AgentTerminalProvider(() => {});
  const capture = async () => {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1440, height: 1080 },
    });
    const primary =
      sources.find((s) => s.display_id === String(display.id)) ??
      (sources.length === 1 ? sources[0] : undefined);
    if (!primary || primary.thumbnail.isEmpty()) throw Error('无法读取主屏幕');
    return {mimeType:'image/jpeg',dataBase64:primary.thumbnail.toJPEG(75).toString('base64'),...primary.thumbnail.getSize(),target:'本机主屏幕',frameId:crypto.randomUUID(),capturedAt:Date.now()};
  };
  const tools: ConnectionTool[] = [
    {
      name: 'local_desktop_screenshot',
      capability: 'local.desktop',
      description: 'Capture LOCAL primary display.',
      input: z.object({}).strict(),
      needsReview: () => false,
      invoke: async()=>JSON.stringify(await capture()),
    },
    {
      name: 'local_desktop_command',
      capability: 'local.desktop',
      description:
        'Run a command on the LOCAL CShell computer as the current user. Use for local keyboard, application, and file operations. A remote session uses execute_command instead.',
      input: commandInput,
      needsReview: () => true,
      invoke: async (input, signal) =>
        JSON.stringify(await terminal.execute(commandInput.parse(input), signal)),
    },
  ];
  async function interact(
    operation: Record<string, unknown>,
    screenshot: boolean,
    signal: AbortSignal,
  ) {
    const payload = Buffer.from(JSON.stringify(operation)).toString('base64');
    const command = `
        $ErrorActionPreference='Stop'
        Add-Type -Namespace CShell -Name Mouse -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n);
[StructLayout(LayoutKind.Sequential)] public struct Input { public uint type;public Union u; }
[StructLayout(LayoutKind.Explicit)] public struct Union {[FieldOffset(0)]public Key k;[FieldOffset(0)]public MouseInfo m;}
[StructLayout(LayoutKind.Sequential)] public struct MouseInfo { public int x,y;public uint data,flags,time;public UIntPtr extra; }
[StructLayout(LayoutKind.Sequential)] public struct Key { public ushort vk,scan;public uint flags,time;public UIntPtr extra; }
[DllImport("user32.dll")] static extern uint SendInput(uint n,Input[] input,int size);
public static void Text(string s){foreach(char c in s){Input[] a=new Input[2];for(int i=0;i<2;i++){a[i].type=1;a[i].u.k.scan=c;a[i].u.k.flags=(uint)(4+2*i);}if(SendInput(2,a,Marshal.SizeOf(typeof(Input)))!=2)throw new Exception("Windows rejected text input");}}
public static void Move(double x,double y){if(!SetCursorPos((int)Math.Round((GetSystemMetrics(0)-1)*x),(int)Math.Round((GetSystemMetrics(1)-1)*y)))throw new Exception("Cannot position pointer");}
public delegate bool WindowCallback(IntPtr h,IntPtr unused);
[DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback cb,IntPtr p);
[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] static extern bool AttachThreadInput(uint first,uint second,bool attach);
[DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h,int cmd);
public static bool Focus(IntPtr target){
 if(!IsWindowVisible(target))return false;
 if(IsIconic(target))ShowWindowAsync(target,9);
 if(GetForegroundWindow()==target||SetForegroundWindow(target))return true;
 uint pid;uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out pid),own=GetCurrentThreadId();
 bool attached=foreground!=own&&AttachThreadInput(own,foreground,true);
 try{return SetForegroundWindow(target)||GetForegroundWindow()==target;}finally{if(attached)AttachThreadInput(own,foreground,false);}
}
public class Item{public string handle,MainWindowTitle;public uint pid;}
public static Item[] Windows(){var list=new System.Collections.Generic.List<Item>();EnumWindows(delegate(IntPtr h,IntPtr p){if(IsWindowVisible(h)){var s=new System.Text.StringBuilder(1024);if(GetWindowText(h,s,1024)>0){uint pid;GetWindowThreadProcessId(h,out pid);list.Add(new Item{handle=h.ToInt64().ToString(),MainWindowTitle=s.ToString(),pid=pid});}}return list.Count<100;},IntPtr.Zero);return list.ToArray();}
public static void Button(uint f,int n){mouse_event(f,0,0,unchecked((uint)n),UIntPtr.Zero);}
'@
        [void][CShell.Mouse]::SetProcessDPIAware()
        $o=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json
        if($null -ne $o.x){[CShell.Mouse]::Move($o.x,$o.y)}
        switch($o.action){
          'click' {[CShell.Mouse]::Button(2,0);[CShell.Mouse]::Button(4,0)}
          'doubleClick' {1..2|%{[CShell.Mouse]::Button(2,0);[CShell.Mouse]::Button(4,0);Start-Sleep -Milliseconds 35}}
          'rightClick' {[CShell.Mouse]::Button(8,0);[CShell.Mouse]::Button(16,0)}
          'scroll' {[CShell.Mouse]::Button(2048,120*$o.ticks)}
          'drag' {[CShell.Mouse]::Button(2,0);try{1..12|%{[CShell.Mouse]::Move($o.x+($o.toX-$o.x)*$_/12,$o.y+($o.toY-$o.y)*$_/12);Start-Sleep -Milliseconds 12}}finally{[CShell.Mouse]::Button(4,0)}}
          'type' {[CShell.Mouse]::Text($o.text)}
          'keys' {Add-Type -AssemblyName System.Windows.Forms;[Windows.Forms.SendKeys]::SendWait($o.keys)}
          'focus' {if(![CShell.Mouse]::Focus([IntPtr][long]$o.handle)){throw 'Windows 拒绝激活窗口'}}
        }
        Start-Sleep -Milliseconds 120
        $h=[CShell.Mouse]::GetForegroundWindow()
        $title=New-Object Text.StringBuilder 1024
        [void][CShell.Mouse]::GetWindowText($h,$title,1024)
        $r=@{action=$o.action;windowTitle=$title.ToString();handle=$h.ToInt64().ToString()}
        if($o.action -eq 'windows'){$r.windows=@([CShell.Mouse]::Windows())}
        if($o.action -eq 'controls'){
          $win=[CShell.Mouse]::Windows() | Where-Object handle -eq $o.handle | Select-Object -First 1
          if(!$win){throw '目标窗口已关闭或不可见'}
          Add-Type -AssemblyName UIAutomationClient
          $root=[Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$o.handle)
          $walker=[Windows.Automation.TreeWalker]::ControlViewWalker
          $w=[CShell.Mouse]::GetSystemMetrics(0);$ht=[CShell.Mouse]::GetSystemMetrics(1)
          $queue=New-Object System.Collections.Queue
          $queue.Enqueue($root);$found=@();$visited=0
          while($queue.Count -gt 0 -and $visited -lt 80 -and $found.Count -lt 32){
            $parent=$queue.Dequeue();$child=$walker.GetFirstChild($parent)
            while($null -ne $child -and $visited -lt 80 -and $found.Count -lt 32){
              $visited++;$queue.Enqueue($child);$c=$child.Current;$b=$c.BoundingRectangle
              if(!$c.IsOffscreen -and $b.Width -gt 0 -and $b.Height -gt 0){
                $cx=($b.Left+$b.Width/2)/[Math]::Max(1,$w-1);$cy=($b.Top+$b.Height/2)/[Math]::Max(1,$ht-1)
                $editable=$c.IsPassword -or $c.ControlType.ProgrammaticName -eq 'ControlType.Edit' -or $c.ClassName -match '(?i)edit'
                $item=@{role=$c.ControlType.ProgrammaticName.Replace('ControlType.','');id=$c.AutomationId;class=$c.ClassName;enabled=$c.IsEnabled}
                if(!$editable -and $c.Name){$item.label=$c.Name.Substring(0,[Math]::Min(80,$c.Name.Length))}
                if($cx -ge 0 -and $cx -le 1 -and $cy -ge 0 -and $cy -le 1){$item.x=[Math]::Round($cx,5);$item.y=[Math]::Round($cy,5)}
                $found+=$item
              }
              $child=$walker.GetNextSibling($child)
            }
          }
          $r.targetHandle=$o.handle;$r.targetTitle=$win.MainWindowTitle;$r.controls=$found
        }
        if($o.action -eq 'inspect'){Add-Type -AssemblyName UIAutomationClient;$el=[Windows.Automation.AutomationElement]::FocusedElement;if($el){$r.focusedControl=@{name=$(if(!$el.Current.IsPassword -and $el.Current.ClassName -notmatch '(?i)edit' -and $el.Current.ControlType.ProgrammaticName -ne 'ControlType.Edit'){$el.Current.Name});id=$el.Current.AutomationId;type=$el.Current.ControlType.ProgrammaticName}}}
        $r|ConvertTo-Json -Compress -Depth 4`;
    const result = await terminal.execute(
      { shell: 'powershell', command, timeoutMs: 15000 },
      signal,
    );
    if (result.exitCode) throw Error(result.stderr || '本机点击失败');

    const state = JSON.parse(result.stdout.trim());
    if (operation.action === 'click') state.message = '已单击本机主屏幕';
    signal.throwIfAborted();
    if (screenshot) state.image = await capture();
    return JSON.stringify(state);
  }
  if (process.platform === 'win32')
    tools.push(
      {
        name: 'local_desktop_click',
        capability: 'local.desktop',
        description:
          'Click normalized primary-screen coordinates and return foreground title and handle. Request screenshot to inspect the resulting UI.',
        input: position,
        needsReview: () => true,
        invoke: (a, s) => {
          const p = position.parse(a);
          return interact({ action: 'click', x: p.x, y: p.y }, p.screenshot, s);
        },
      },
      {
        name: 'local_desktop_interact',
        capability: 'local.desktop',
        description:
          'Test native Windows UI. Use windows to find a handle, focus that window, then controls with that handle for visible roles, labels and normalized click coordinates. Inspect focus, type Unicode, send shortcuts (Windows Forms SendKeys), scroll, drag or double/right click. Coordinates normalized to primary display.',
        input: interaction,
        needsReview: (a) => !['inspect', 'windows', 'controls'].includes(interaction.parse(a).operation.action),
        invoke: (a, s) => {
          const p = interaction.parse(a);
          return interact(p.operation, p.screenshot, s);
        },
      },
    );
  return { tools: () => (enabled() ? tools : []), dispose: () => terminal.dispose() };
}
