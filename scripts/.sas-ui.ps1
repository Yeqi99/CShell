Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms,System.Drawing
$p=Get-Process |Where-Object {$_.MainWindowHandle -and $_.Path -eq 'E:\CShell\CShell Pro\CShell Pro.exe'}
$root=[Windows.Automation.AutomationElement]::FromHandle((Get-Process -Id 39644).MainWindowHandle)
function els{$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)}
function names{els | % {$_.Current.Name} | where {$_ -match '桌面工具|Alt\+Delete|远程控制|断开|德威云|桌面设置|重新连接|连接桌面'} | select -Last 35}
names

function el($n){els|where {$_.Current.Name.Trim() -eq $n}|select -First 1}
function press($n){$e=el $n;if(!$e){throw "Missing $n"};$e.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
function menu{(el '切换到远程控制').SetFocus();[System.Windows.Forms.SendKeys]::SendWait('+{F10}');Start-Sleep -Milliseconds 400}

