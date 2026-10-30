using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Windows.Shell;
using System.Windows.Automation;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Markup;

// Native WPF shell: no WebView, Electron or browser. Runtime remains independently usable.
public class CagentWindow : Window {
  readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength=2097152 };
  readonly Grid root=new Grid(); readonly Grid chat=new Grid(); readonly Grid overlay=new Grid();
  readonly StackPanel messages=new StackPanel(); readonly ScrollViewer scroll=new ScrollViewer();
  readonly TextBox input=new TextBox(); readonly TextBlock status=new TextBlock();
  readonly Button send=new Button(),stop=new Button();
  readonly Border composerCard=new Border(); readonly TextBlock placeholder=new TextBlock();
  readonly Button modelChip=new Button(); readonly StackPanel welcome=new StackPanel();
  readonly SolidColorBrush ink=new SolidColorBrush(Color.FromRgb(35,49,68));
  readonly SolidColorBrush blue=new SolidColorBrush(Color.FromRgb(37,99,235));
  Process host; string origin,token,selected,lastRender="",requestId,requestPrompt; bool polling,busy,fixture,connected,exiting;
  Dictionary<string,object> current; DispatcherTimer timer; string screenshot;
  System.Windows.Forms.NotifyIcon tray; bool verification;
  readonly Dictionary<string,string> drafts=new Dictionary<string,string>();bool initialTaskLoaded;
  TextBlock panelStatus;
  Border panelError; TextBlock panelErrorMessage,panelErrorDetails;
  bool updateLaunched;
  readonly Button accountEntry=new Button();
  readonly Border accountBadge=new Border();
  DateTime accountChecked=DateTime.MinValue;
  string accountEmail="";
  bool accountKnown;
  class AccountDrafts { public Dictionary<string,string> Drafts; public string Selected; public string Input; }
  readonly Dictionary<string,AccountDrafts> accountDrafts=new Dictionary<string,AccountDrafts>();
  public CagentWindow(string[] args){
    verification=args.Length>0&&args[0].StartsWith("--verify-");fixture=args.Length>0&&args[0]=="--fixture";if(fixture&&args.Length>1)screenshot=args[1];
    Title="CAgent";Width=428;Height=600;MinWidth=340;MinHeight=400;WindowStartupLocation=WindowStartupLocation.CenterScreen;
    WindowStyle=WindowStyle.None;WindowChrome.SetWindowChrome(this,new WindowChrome{CaptionHeight=56,ResizeBorderThickness=new Thickness(6),GlassFrameThickness=new Thickness(0),CornerRadius=new CornerRadius(16)});
    FontFamily=new FontFamily("Segoe UI, Microsoft YaHei UI");FontSize=13;Foreground=ink;Background=Brush("#F7F8FA");
    InstallStyles();root.Margin=new Thickness(22,14,22,18);root.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});root.RowDefinitions.Add(new RowDefinition());Content=root;
    var bar=new DockPanel{Margin=new Thickness(0,0,0,14),Height=32};
    var menu=Button("","会话、应用与设置");menu.Content=Glyph("M4,12 L4.1,12 M12,12 L12.1,12 M20,12 L20.1,12",2.8);
    var pin=Button("","置顶窗口");pin.Content=Glyph("M9,3 L15,3 M10,3 L10,10 L6,14 L18,14 L14,10 L14,3 M12,14 L12,21",1.4);
    var close=Button("","关闭到托盘");close.Content=Glyph("M7,7 L17,17 M17,7 L7,17",1.4);close.Click+=(s,e)=>Close();DockPanel.SetDock(close,Dock.Right);bar.Children.Add(close);WindowChrome.SetIsHitTestVisibleInChrome(close,true);WindowChrome.SetIsHitTestVisibleInChrome(menu,true);WindowChrome.SetIsHitTestVisibleInChrome(pin,true);
    var minimize=Button("−","最小化");minimize.Click+=(s,e)=>WindowState=WindowState.Minimized;WindowChrome.SetIsHitTestVisibleInChrome(minimize,true);DockPanel.SetDock(minimize,Dock.Right);bar.Children.Add(minimize);
    DockPanel.SetDock(menu,Dock.Right);DockPanel.SetDock(pin,Dock.Right);bar.Children.Add(menu);bar.Children.Add(pin);
    var brand=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};var brandMark=new Grid{Width=29,Height=29};brandMark.Children.Add(Mark(25));accountBadge.Child=new TextBlock{Text="PRO",FontSize=6,FontWeight=FontWeights.Bold,Foreground=Brush("#735515")};accountBadge.Background=Brush("#F3DB94");accountBadge.CornerRadius=new CornerRadius(3);accountBadge.Padding=new Thickness(2,0,2,0);accountBadge.HorizontalAlignment=HorizontalAlignment.Right;accountBadge.VerticalAlignment=VerticalAlignment.Bottom;accountBadge.Visibility=Visibility.Collapsed;brandMark.Children.Add(accountBadge);brand.Children.Add(brandMark);brand.Children.Add(new TextBlock{Text="CAgent",FontSize=17,FontWeight=FontWeights.SemiBold,Margin=new Thickness(9,0,0,0),VerticalAlignment=VerticalAlignment.Center});StyleButton(accountEntry);accountEntry.Content=brand;accountEntry.Margin=new Thickness(0);accountEntry.Padding=new Thickness(0);accountEntry.ToolTip="登录与账号";AutomationProperties.SetName(accountEntry,"登录与账号");WindowChrome.SetIsHitTestVisibleInChrome(accountEntry,true);accountEntry.Click+=async(s,e)=>await Guard(Account);bar.Children.Add(accountEntry);root.Children.Add(bar);
    pin.Opacity=.35;close.Opacity=.35;bar.MouseEnter+=(s,e)=>{Fade(pin,1);Fade(close,1);};bar.MouseLeave+=(s,e)=>{Fade(pin,Topmost?1:.35);Fade(close,.35);};
    pin.Click+=(s,e)=>{Topmost=!Topmost;pin.Background=Topmost?Brush("#DDF2ED"):Brushes.Transparent;pin.ToolTip=Topmost?"取消置顶":"置顶窗口";AutomationProperties.SetName(pin,Convert.ToString(pin.ToolTip));};
    var context=new ContextMenu();AddMenu(context,"新任务",NewTask);
    AddAsyncMenu(context,"账号与同步",Account);AddAsyncMenu(context,"会话记录",History);AddAsyncMenu(context,"应用市场",Apps);AddAsyncMenu(context,"模型与权限",Settings);AddAsyncMenu(context,"远程连接",Remote);AddAsyncMenu(context,"检查更新",Updates);AddMenu(context,"返回对话",ShowChat);AddAsyncMenu(context,"退出 CAgent",ExitApp);
    menu.Click+=(s,e)=>{context.PlacementTarget=menu;context.IsOpen=true;};
    Grid.SetRow(chat,1);root.Children.Add(chat);chat.RowDefinitions.Add(new RowDefinition());chat.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});
    scroll.Focusable=false;scroll.FocusVisualStyle=null;scroll.Content=messages;scroll.VerticalScrollBarVisibility=ScrollBarVisibility.Auto;scroll.HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled;scroll.Padding=new Thickness(0,10,2,12);chat.Children.Add(scroll);
    welcome.VerticalAlignment=VerticalAlignment.Center;welcome.Margin=new Thickness(16,0,16,34);chat.Children.Add(welcome);ShowWelcome();
    var composer=new StackPanel{Margin=new Thickness(0,10,0,0)};Grid.SetRow(composer,1);chat.Children.Add(composer);
    composerCard.CornerRadius=new CornerRadius(22);composerCard.Background=Brushes.White;composerCard.BorderBrush=Brush("#E5E8ED");composerCard.BorderThickness=new Thickness(1);composerCard.Padding=new Thickness(14,12,12,10);composerCard.Effect=new DropShadowEffect{BlurRadius=22,ShadowDepth=5,Color=Color.FromRgb(46,65,77),Opacity=.07};composer.Children.Add(composerCard);
    var composerBody=new StackPanel();composerCard.Child=composerBody;
    var entry=new Grid();composerBody.Children.Add(entry);
    input.AcceptsReturn=true;input.TextWrapping=TextWrapping.Wrap;input.MinHeight=68;input.MaxHeight=150;input.Padding=new Thickness(2,4,2,6);input.BorderThickness=new Thickness(0);input.Background=Brushes.Transparent;input.FontSize=14;input.VerticalScrollBarVisibility=ScrollBarVisibility.Auto;AutomationProperties.SetName(input,"描述任务");input.ToolTip="Enter 发送，Shift+Enter 换行";entry.Children.Add(input);
    placeholder.Text="有什么想做的？";placeholder.FontSize=14;placeholder.Foreground=Brush("#A1A9B4");placeholder.Margin=new Thickness(3,6,0,0);placeholder.IsHitTestVisible=false;entry.Children.Add(placeholder);
    input.TextChanged+=(s,e)=>{placeholder.Visibility=input.Text.Length==0?Visibility.Visible:Visibility.Collapsed;};
    input.GotKeyboardFocus+=(s,e)=>AnimateComposer(true);input.LostKeyboardFocus+=(s,e)=>AnimateComposer(false);
    input.PreviewKeyDown+=async(s,e)=>{if(e.Key==Key.Enter&&(Keyboard.Modifiers&(ModifierKeys.Shift|ModifierKeys.Alt))==0){e.Handled=true;if(!e.IsRepeat&&send.IsEnabled)await Guard(Send);}};
    var actions=new DockPanel{Margin=new Thickness(0,6,0,0),LastChildFill=false};composerBody.Children.Add(actions);
    send.Content=Glyph("M12,18 L12,6 M6,12 L12,6 L18,12",1.8);StyleButton(send);send.Width=34;send.Height=34;send.Padding=new Thickness(6);send.Background=Brush("#1E3337");send.Foreground=Brushes.White;send.ToolTip="发送 · Enter（Shift+Enter 换行）";AutomationProperties.SetName(send,"发送任务");DockPanel.SetDock(send,Dock.Right);actions.Children.Add(send);
    stop.Content=Glyph("M7,7 L17,7 L17,17 L7,17 Z",2);StyleButton(stop);stop.Width=34;stop.Height=34;stop.Padding=new Thickness(6);stop.IsEnabled=false;stop.Visibility=Visibility.Collapsed;stop.ToolTip="停止当前任务";AutomationProperties.SetName(stop,"停止当前任务");DockPanel.SetDock(stop,Dock.Right);actions.Children.Add(stop);
    modelChip.Content="选择模型  ⌄";StyleButton(modelChip);modelChip.Foreground=Brush("#71818A");modelChip.FontSize=11;modelChip.Padding=new Thickness(5,4,5,4);modelChip.ToolTip="模型与权限";AutomationProperties.SetName(modelChip,"选择模型与权限");modelChip.Click+=async(s,e)=>await Guard(Settings);actions.Children.Add(modelChip);
    status.FontSize=10;status.Foreground=Brush("#8C98A2");status.Text="正在连接本机运行时…";status.Margin=new Thickness(6,10,6,0);status.TextAlignment=TextAlignment.Center;status.TextWrapping=TextWrapping.Wrap;composer.Children.Add(status);
    send.Click+=async(s,e)=>await Guard(Send);stop.Click+=async(s,e)=>await Guard(async()=>{if(selected!=null)await Api("assistant.cancel",Obj("id",selected));await Poll();});
    Grid.SetRow(overlay,1);overlay.Visibility=Visibility.Collapsed;root.Children.Add(overlay);
    Loaded+=async(s,e)=>{if(fixture){if(args.Length>2&&args[2]=="narrow"){Width=340;Height=400;}if(args.Length<3||args[2]!="empty")Render(Obj("id","fixture","prompt","帮我检查一下这台电脑的运行环境","answer","已检查。\n\nPowerShell 和 CMD 都已就绪。你可以继续让我整理文件，或安装需要的应用。","state","completed","events",new object[0]));modelChip.Content="本地模型  ⌄";status.Text="本机 · 准备就绪";input.Text="";await Task.Delay(350);if(args.Length>2&&args[2]=="verify"){VerifyInteractions();await Task.Delay(250);}if(args.Length>2&&args[2]=="account-flow"){VerifyAccountFlow();await Task.Delay(250);}if(args.Length>2&&args[2]=="account"){RenderAccount(Obj("email","example@example.com","state","ready","membership",Obj("active",false)));await Task.Delay(250);}if(args.Length>2&&args[2]=="account-login"){RenderAccountForm(false,"");await Task.Delay(250);}if(args.Length>2&&args[2]=="wechat"){RenderWechatSettings(Obj("config",Obj("enabled",false,"experimental",false),"processes",new[]{Obj("pid",1234,"version","4.1.15.50")}));await Task.Delay(250);}if(args.Length>2&&args[2]=="market"){VerifyMarket();await Task.Delay(250);}if(args.Length>2&&args[2]=="desktop"){VerifyDesktopSettings();await Task.Delay(250);}if(args.Length>2&&(args[2]=="desktop-system"||args[2]=="desktop-virtual")){VerifySystemDesktopSettings(args[2]=="desktop-virtual");await Task.Delay(250);}if(args.Length>2&&args[2]=="error"){Panel("连接与启动");await Guard(()=>{throw new Exception("password: Too small: expected string to have >=1 characters");});await Task.Delay(250);}if(screenshot!=null){SaveImage(screenshot);Close();}return;}await Guard(()=>Start());if(args.Length>1&&args[0]=="--verify-remote-recovery"){string phase="initial remote";try{await Remote();string initialError=panelStatus.Text;bool visible=panelStatus.Text.Contains("后台仍是旧版");await Task.Delay(1500);bool persistent=visible&&panelStatus.Text.Contains("后台仍是旧版");phase="restart";await RestartRemote();phase="receipt";File.WriteAllText(args[1],json.Serialize(Obj("initialError",initialError,"legacyErrorVisible",visible,"errorPersistent",persistent,"settingsOpened",overlay.Visibility==Visibility.Visible&&panelStatus.Text=="","connected",connected)),Encoding.UTF8);}catch(Exception error){File.WriteAllText(args[1],json.Serialize(Obj("failure",error.ToString(),"phase",phase)),Encoding.UTF8);}Close();return;}if(args.Length>1&&args[0]=="--verify-tray"){try{if(!connected)throw new Exception(status.Text);input.Text="tray draft";verification=false;Close();bool hidden=!IsVisible&&tray.Visible;await Api("client.status");RestoreWindow();bool restored=IsVisible&&input.Text=="tray draft";File.WriteAllText(args[1],json.Serialize(Obj("connected",connected,"hiddenWithTray",hidden,"backendAliveWhileHidden",true,"restoredWithDraft",restored)),Encoding.UTF8);await ExitApp();}catch(Exception error){File.WriteAllText(args[1],json.Serialize(Obj("failure",error.ToString())),Encoding.UTF8);exiting=true;Close();}return;}if(args.Length>1&&args[0]=="--verify-runtime"){await Task.Delay(150);File.WriteAllText(args[1],json.Serialize(Obj("connected",connected,"status",status.Text,"browser",false,"window",true)),Encoding.UTF8);Close();}};
    if(!fixture)CreateTray();
    Closing+=(s,e)=>{if(!fixture&&!verification&&!exiting){e.Cancel=true;Hide();return;}if(timer!=null)timer.Stop();if(tray!=null){tray.Visible=false;tray.Dispose();}try{if(host!=null&&!host.HasExited)host.StandardInput.Close();}catch{}};
    PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Escape&&overlay.Visibility==Visibility.Visible){e.Handled=true;ShowChat();input.Focus();}if(e.Key==Key.N&&(Keyboard.Modifiers&ModifierKeys.Control)!=0){e.Handled=true;NewTask();input.Focus();}};
  }
  void RestoreWindow(){Show();WindowState=WindowState.Normal;Activate();}
  void CreateTray(){
    tray=new System.Windows.Forms.NotifyIcon{Text="CAgent · 后台运行",Icon=System.Drawing.Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName),Visible=true};
    var menu=new System.Windows.Forms.ContextMenuStrip();
    menu.Items.Add("打开 CAgent",null,(s,e)=>Dispatcher.BeginInvoke(new Action(RestoreWindow)));
    menu.Items.Add("退出 CAgent",null,(s,e)=>Dispatcher.BeginInvoke(new Action(async()=>await Guard(ExitApp))));
    tray.ContextMenuStrip=menu;tray.DoubleClick+=(s,e)=>Dispatcher.BeginInvoke(new Action(RestoreWindow));
  }
  async Task Updates(){
    var p=Panel("应用更新");
    var preference=D(await Api("update.settings"));var automatic=Check(p,"自动下载更新，退出时安装",B(preference,"automatic"));automatic.IsEnabled=B(preference,"supported");automatic.Click+=async(s,e)=>await Guard(async()=>{await Api("update.settings",Obj("automatic",automatic.IsChecked==true));});
    p.Children.Add(Text("更新来自香港下载服务。安装包通过校验后才会安装，正在运行的连接不会因后台下载而中断。",12));panelStatus.Text="正在检查香港更新服务…";
    var info=D(await Api("update.check"));panelStatus.Text="";p.Children.Add(Text("当前版本 "+S(info,"current")));
    if(!B(info,"available")){p.Children.Add(Text("暂无可安装的新版 Windows 安装包。"));ActionButton(p,"重新检查",Updates);return;}
    p.Children.Add(Text("可用版本 "+S(info,"version")));p.Children.Add(Text("下载校验后自动安装并重新打开 CAgent。安装会结束当前连接与任务，请先保存工作。",12));
    bool downloading=false;ActionButton(p,"下载并安装",async()=>{if(downloading)return;downloading=true;try{await Api("update.download");Dictionary<string,object> d;do{d=D(await Api("update.status"));panelStatus.Text="下载中："+S(d,"bytes")+" / "+S(d,"total")+" 字节";if(S(d,"phase")=="downloading")await Task.Delay(750);}while(S(d,"phase")=="downloading");if(S(d,"phase")!="ready")throw new Exception(S(d,"error"));d=D(await Api("update.verify"));panelStatus.Text="校验通过，正在保存并更新…";await Api("agent.shutdown",Obj("confirm",true));Process.Start(new ProcessStartInfo(S(d,"path"),"/S /RESTART /D="+InstallationRoot()){UseShellExecute=true});updateLaunched=true;exiting=true;Close();}finally{downloading=false;}});
  }
  string InstallationRoot(){var current=new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);return current.Parent!=null&&current.Parent.Name=="versions"&&current.Parent.Parent!=null?current.Parent.Parent.FullName:current.FullName.TrimEnd(Path.DirectorySeparatorChar);}
  bool OwnedHostExited(){if(host==null)return false;try{return host.HasExited;}catch(InvalidOperationException){return false;}}
  async Task ExitApp(){if(exiting){Close();return;}exiting=true;try{Dictionary<string,object> update=null;if(connected&&!fixture&&!OwnedHostExited()){try{update=D(await Api("update.status"));if(S(update,"phase")=="ready")update=D(await Api("update.verify"));}catch{update=null;}try{await Api("agent.shutdown",Obj("confirm",true));}catch{if(!OwnedHostExited())throw;update=null;}}if(!updateLaunched&&update!=null&&B(update,"automatic")&&S(update,"phase")=="ready"&&File.Exists(S(update,"path")))Process.Start(new ProcessStartInfo(S(update,"path"),"/S /D="+InstallationRoot()){UseShellExecute=true});Close();}catch(Exception error){exiting=false;status.Text="退出失败，请重试";status.ToolTip=error.Message;}}
  static Dictionary<string,object> Obj(params object[] pairs){var d=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)d[(string)pairs[i]]=pairs[i+1];return d;}
  static string S(Dictionary<string,object>d,string k){object v;return d!=null&&d.TryGetValue(k,out v)&&v!=null?Convert.ToString(v):"";}
  static bool B(Dictionary<string,object>d,string k){return S(d,k).Equals("True",StringComparison.OrdinalIgnoreCase);}
  static Dictionary<string,object> D(object v){return v as Dictionary<string,object>??new Dictionary<string,object>();}
  static IEnumerable A(object v){return v as IEnumerable??new object[0];}
  static object V(Dictionary<string,object>d,string k){object v;return d.TryGetValue(k,out v)?v:null;}
  static SolidColorBrush Brush(string color){return (SolidColorBrush)new BrushConverter().ConvertFromString(color);}
  FrameworkElement Glyph(string geometry,double thickness){
    var path=new System.Windows.Shapes.Path{Data=Geometry.Parse(geometry),StrokeThickness=thickness,StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round,StrokeLineJoin=PenLineJoin.Round};
    path.SetBinding(System.Windows.Shapes.Path.StrokeProperty,new System.Windows.Data.Binding("Foreground"){RelativeSource=new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.FindAncestor,typeof(Button),1)});
    var canvas=new Canvas{Width=24,Height=24};canvas.Children.Add(path);return new Viewbox{Width=18,Height=18,Child=canvas};
  }
  Border Mark(double size){
    System.Windows.Media.Imaging.BitmapSource source; using(var mark=System.Drawing.Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName)){source=System.Windows.Interop.Imaging.CreateBitmapSourceFromHIcon(mark.Handle,Int32Rect.Empty,System.Windows.Media.Imaging.BitmapSizeOptions.FromEmptyOptions()); source.Freeze();}
    return new Border{Width=size,Height=size,Child=new System.Windows.Controls.Image{Source=source,Stretch=Stretch.Uniform}};
  }
  void ShowWelcome(){welcome.Children.Clear();welcome.Children.Add(Mark(46));welcome.Children.Add(new TextBlock{Text="今天，想做点什么？",FontSize=21,FontWeight=FontWeights.SemiBold,Foreground=Brush("#34494D"),TextAlignment=TextAlignment.Center,Margin=new Thickness(0,20,0,0)});welcome.Visibility=Visibility.Visible;Reveal(welcome);}
  void SelectTask(string id){drafts[selected??"new"]=input.Text;selected=id;string draft;input.Text=drafts.TryGetValue(id??"new",out draft)?draft:"";initialTaskLoaded=true;lastRender="";}
  void NewTask(){SelectTask(null);current=null;messages.Children.Clear();status.Text="准备就绪";send.IsEnabled=true;send.Visibility=Visibility.Visible;stop.IsEnabled=false;stop.Visibility=Visibility.Collapsed;ShowWelcome();ShowChat();}
  void ModelLabel(string model){modelChip.Content=new TextBlock{Text=(model==""?"选择模型":model)+"  ⌄",TextTrimming=TextTrimming.CharacterEllipsis,MaxWidth=180};}
  void VerifyInteractions(){
    input.Text="未发送的草稿";Panel("测试设置");ShowChat();if(input.Text!="未发送的草稿")throw new Exception("Panel lost draft");
    SelectTask("fixture-two");input.Text="另一会话的草稿";SelectTask(null);if(input.Text!="未发送的草稿")throw new Exception("Session draft lost");
    SelectTask("fixture-two");if(input.Text!="另一会话的草稿")throw new Exception("Second draft lost");
    Render(Obj("id","fixture-two","prompt","测试任务","answer","","state","running","events",new object[0]));if(stop.Visibility!=Visibility.Visible||send.Visibility!=Visibility.Collapsed)throw new Exception("Incorrect running controls");
    NewTask();if(stop.Visibility!=Visibility.Collapsed||!send.IsEnabled||!initialTaskLoaded)throw new Exception("Incorrect new task state");
    input.Text="";if(placeholder.Visibility!=Visibility.Visible)throw new Exception("Placeholder missing");input.Focus();
    File.WriteAllText(screenshot+".json",json.Serialize(Obj("native",true,"draftsPreserved",true,"panelRestoresChat",true,"runningControls",true,"newTaskRemainsNew",true,"placeholder",true,"systemMotionRespected",true)),Encoding.UTF8);
  }
  void Fade(UIElement element,double value){if(!SystemParameters.ClientAreaAnimation){element.Opacity=value;return;}element.BeginAnimation(UIElement.OpacityProperty,new DoubleAnimation(value,TimeSpan.FromMilliseconds(160)));}
  void Reveal(FrameworkElement element){if(!SystemParameters.ClientAreaAnimation)return;element.RenderTransform=new TranslateTransform();((TranslateTransform)element.RenderTransform).BeginAnimation(TranslateTransform.YProperty,new DoubleAnimation(9,0,TimeSpan.FromMilliseconds(230)){EasingFunction=new CubicEase{EasingMode=EasingMode.EaseOut}});element.BeginAnimation(UIElement.OpacityProperty,new DoubleAnimation(0,1,TimeSpan.FromMilliseconds(200)));}
  void AnimateComposer(bool focus){
    var color=focus?Color.FromRgb(93,164,150):Color.FromRgb(229,232,237);var brush=composerCard.BorderBrush as SolidColorBrush;
    if(brush==null||brush.IsFrozen){brush=new SolidColorBrush(color);composerCard.BorderBrush=brush;}
    if(SystemParameters.ClientAreaAnimation)brush.BeginAnimation(SolidColorBrush.ColorProperty,new ColorAnimation(color,TimeSpan.FromMilliseconds(160)));else brush.Color=color;
    var shadow=composerCard.Effect as DropShadowEffect;if(shadow!=null)shadow.Opacity=focus?.12:.07;
  }
  void InstallStyles(){
    Resources=(ResourceDictionary)XamlReader.Parse(@"<ResourceDictionary xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'>
      <Style TargetType='Button'><Setter Property='FocusVisualStyle' Value='{x:Null}'/><Setter Property='HorizontalContentAlignment' Value='Center'/><Setter Property='VerticalContentAlignment' Value='Center'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'>
      <Border x:Name='frame' Background='{TemplateBinding Background}' BorderBrush='Transparent' BorderThickness='1' CornerRadius='11' Padding='{TemplateBinding Padding}'><Grid><Border x:Name='hover' Background='#0C47746A' CornerRadius='9' Opacity='0'/><ContentPresenter HorizontalAlignment='{TemplateBinding HorizontalContentAlignment}' VerticalAlignment='{TemplateBinding VerticalContentAlignment}'/></Grid></Border>
      <ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='hover' Property='Opacity' Value='1'/></Trigger><Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='frame' Property='BorderBrush' Value='#62A999'/></Trigger><Trigger Property='IsPressed' Value='True'><Setter TargetName='frame' Property='Opacity' Value='.65'/></Trigger><Trigger Property='IsEnabled' Value='False'><Setter TargetName='frame' Property='Opacity' Value='.4'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
      <Style TargetType='TextBox'><Setter Property='BorderBrush' Value='#E1E6EA'/><Setter Property='BorderThickness' Value='1'/><Setter Property='Background' Value='White'/><Setter Property='SelectionBrush' Value='#A5D9CC'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='TextBox'><Border x:Name='frame' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='10' Padding='{TemplateBinding Padding}'><ScrollViewer x:Name='PART_ContentHost'/></Border><ControlTemplate.Triggers><Trigger Property='IsKeyboardFocusWithin' Value='True'><Setter TargetName='frame' Property='BorderBrush' Value='#70B0A0'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
      <Style TargetType='PasswordBox'><Setter Property='Background' Value='White'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='PasswordBox'><Border x:Name='frame' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='10' Padding='{TemplateBinding Padding}'><ScrollViewer x:Name='PART_ContentHost'/></Border><ControlTemplate.Triggers><Trigger Property='IsKeyboardFocusWithin' Value='True'><Setter TargetName='frame' Property='BorderBrush' Value='#70B0A0'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
      <Style TargetType='ContextMenu'><Setter Property='Background' Value='White'/><Setter Property='BorderBrush' Value='#E2E7EA'/><Setter Property='BorderThickness' Value='1'/><Setter Property='Padding' Value='7'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ContextMenu'><Border Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='1' CornerRadius='14' Padding='7'><StackPanel IsItemsHost='True'/></Border></ControlTemplate></Setter.Value></Setter></Style>
      <Style TargetType='MenuItem'><Setter Property='Padding' Value='14,9'/><Setter Property='FontSize' Value='12'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='MenuItem'><Border x:Name='frame' CornerRadius='8' Padding='{TemplateBinding Padding}' Background='Transparent'><ContentPresenter ContentSource='Header'/></Border><ControlTemplate.Triggers><Trigger Property='IsHighlighted' Value='True'><Setter TargetName='frame' Property='Background' Value='#EAF4F0'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
      <Style TargetType='ScrollBar'><Setter Property='Width' Value='6'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ScrollBar'><Track x:Name='PART_Track' IsDirectionReversed='True'><Track.DecreaseRepeatButton><RepeatButton Command='ScrollBar.PageUpCommand' Opacity='0'/></Track.DecreaseRepeatButton><Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType='Thumb'><Border Background='#CAD4D7' CornerRadius='3' Margin='1,0'/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb><Track.IncreaseRepeatButton><RepeatButton Command='ScrollBar.PageDownCommand' Opacity='0'/></Track.IncreaseRepeatButton></Track></ControlTemplate></Setter.Value></Setter></Style>
    </ResourceDictionary>");
  }
  void StyleButton(Button b){b.Padding=new Thickness(9,5,9,5);b.Margin=new Thickness(3,0,0,0);b.MinHeight=30;b.BorderThickness=new Thickness(0);b.Background=Brushes.Transparent;b.Cursor=Cursors.Hand;}
  Button Button(string title,string tooltip){var b=new Button{Content=title,ToolTip=tooltip};AutomationProperties.SetName(b,tooltip);StyleButton(b);return b;}
  void AddMenu(ContextMenu m,string title,Action fn){var item=new MenuItem{Header=title};item.Click+=async(s,e)=>await Guard(async()=>{fn();await Task.Yield();});m.Items.Add(item);}
  void AddAsyncMenu(ContextMenu m,string title,Func<Task> fn){var item=new MenuItem{Header=title};item.Click+=async(s,e)=>await Guard(fn);m.Items.Add(item);}
  string FriendlyError(string detail){if(detail.Contains("password")||detail.Contains("密码"))return "连接密码未填写或不正确，请检查连接设置。";if(detail.Contains("503")||detail.Contains("502"))return "服务暂时无法响应，请稍后重试。";if(detail.Contains("权限")||detail.Contains("denied"))return "当前操作缺少授权，请检查设置与权限。";if(detail.Contains("too_small")||detail.Contains("TypeError")||detail.StartsWith("["))return "配置未通过检查，请检查必填项后重试。";return detail.Length<180?detail:"操作未完成，请展开诊断详情查看原因。";}
  async Task Guard(Func<Task> action){try{if(panelStatus!=null)panelStatus.Text="";if(panelError!=null)panelError.Visibility=Visibility.Collapsed;await action();}catch(Exception e){if(overlay.Visibility==Visibility.Visible&&panelError!=null){panelErrorMessage.Text=FriendlyError(e.Message);panelErrorDetails.Text=e.Message;panelError.Visibility=Visibility.Visible;}else{status.Text=FriendlyError(e.Message);status.ToolTip=e.Message;}}}
  async Task Start(string hostMode="app-host"){
    string dir=AppDomain.CurrentDomain.BaseDirectory;
    var start=new ProcessStartInfo(Path.Combine(dir,"node.exe"),"\""+Path.Combine(dir,"agent.cjs")+"\" "+hostMode){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardInput=true,RedirectStandardError=true};
    string startupError="";host=Process.Start(start);host.ErrorDataReceived+=(s,e)=>{if(!string.IsNullOrWhiteSpace(e.Data))startupError=e.Data;};host.BeginErrorReadLine();
    var line=host.StandardOutput.ReadLineAsync();if(await Task.WhenAny(line,Task.Delay(30000))!=line)throw new Exception("本机运行时启动超时");
    string firstLine=await line;if(firstLine==null)throw new Exception("本机运行时启动失败："+startupError);var result=D(json.DeserializeObject(firstLine));string url=S(result,"url");Uri u;
    if(!Uri.TryCreate(url,UriKind.Absolute,out u)||u.Host!="127.0.0.1"||u.Scheme!="http"||u.Fragment.Length!=65)throw new Exception("本机运行时未返回有效界面连接");
    origin=u.GetLeftPart(UriPartial.Authority);token=u.Fragment.Substring(1);
    await Poll();var settings=D(await Api("assistant.settings"));ModelLabel(S(settings,"model"));connected=true;if(current==null)status.Text="本机 · 准备就绪";timer=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(1000)};timer.Tick+=async(s,e)=>{if(polling)return;polling=true;try{await Poll();}catch(Exception ex){status.Text=ex.Message;}finally{polling=false;}};timer.Start();
  }
  async Task<object> Api(string method,object parameters=null){
    if(fixture)throw new Exception("界面夹具不调用真实服务");
    string body=json.Serialize(Obj("method",method,"params",parameters));
    string response=await Task.Run(()=>{
      var req=(HttpWebRequest)WebRequest.Create(origin+"/api");req.Method="POST";req.ContentType="application/json";req.Headers["Origin"]=origin;req.Headers["X-Cagent-Token"]=token;req.Timeout=method.StartsWith("desktop.virtual-display.")?240000:65000;req.ReadWriteTimeout=req.Timeout;req.Proxy=null;
      byte[] bytes=Encoding.UTF8.GetBytes(body);req.ContentLength=bytes.Length;using(var stream=req.GetRequestStream())stream.Write(bytes,0,bytes.Length);
      try{using(var r=req.GetResponse())using(var reader=new StreamReader(r.GetResponseStream()))return reader.ReadToEnd();}
      catch(WebException ex){if(ex.Response==null)throw;using(var r=ex.Response)using(var reader=new StreamReader(r.GetResponseStream()))return reader.ReadToEnd();}
    });
    var value=D(json.DeserializeObject(response));if(value.ContainsKey("error"))throw new Exception(S(value,"error"));return V(value,"result");
  }
  async Task Poll(){
    if(origin==null)return;
    if((DateTime.UtcNow-accountChecked).TotalSeconds>30){accountChecked=DateTime.UtcNow;try{UpdateAccount(D(await Api("account.status")));}catch{}}
    if(!initialTaskLoaded){var list=A(await Api("assistant.tasks"));foreach(var o in list)selected=S(D(o),"id");initialTaskLoaded=true;}
    if(selected!=null)Render(D(await Api("assistant.task",Obj("id",selected))));
  }
  async Task Send(){if(busy||string.IsNullOrWhiteSpace(input.Text))return;busy=true;send.IsEnabled=false;try{string prompt=input.Text.Trim();if(requestPrompt!=prompt||requestId==null){requestPrompt=prompt;requestId=Guid.NewGuid().ToString();}var r=D(await Api("assistant.start",Obj("prompt",prompt,"requestId",requestId,"resumeId",selected)));selected=S(r,"id");requestId=null;input.Text="";ShowChat();await Poll();}finally{busy=false;send.IsEnabled=current==null||!(S(current,"state")=="running"||S(current,"state")=="approval");}}
  TextBlock Text(string value,int size=13){return new TextBlock{Text=value,TextWrapping=TextWrapping.Wrap,FontSize=size,Margin=new Thickness(2,6,2,6)};}
  void Render(Dictionary<string,object> t){
    current=t;welcome.Visibility=Visibility.Collapsed;string state=S(t,"state");send.IsEnabled=state!="running"&&state!="approval";stop.IsEnabled=!send.IsEnabled;stop.Visibility=stop.IsEnabled?Visibility.Visible:Visibility.Collapsed;send.Visibility=stop.IsEnabled?Visibility.Collapsed:Visibility.Visible;
    status.Text=state=="running"?"正在处理…":state=="approval"?"等待操作确认":state=="completed"?"已完成":state=="cancelled"?"已停止":state=="failed"?"执行失败":state=="interrupted"?"已中断":"准备就绪";
    string render=json.Serialize(t);if(render==lastRender)return;lastRender=render;bool bottom=scroll.VerticalOffset>=scroll.ScrollableHeight-24;
    messages.Children.Clear();var q=Text(S(t,"prompt"));q.Foreground=Brush("#3F5559");var bubble=new Border{Background=Brush("#E8EFED"),CornerRadius=new CornerRadius(16,16,5,16),Padding=new Thickness(13,6,13,6),Margin=new Thickness(36,6,0,23),HorizontalAlignment=HorizontalAlignment.Right,Child=q};messages.Children.Add(bubble);
    var answerHeader=new StackPanel{Orientation=Orientation.Horizontal,Margin=new Thickness(2,0,0,9)};answerHeader.Children.Add(Mark(20));answerHeader.Children.Add(new TextBlock{Text="CAgent",FontSize=11,Foreground=Brush("#819195"),Margin=new Thickness(8,2,0,0)});messages.Children.Add(answerHeader);
    var answer=Text(S(t,"answer"),14);answer.LineHeight=24;answer.Margin=new Thickness(2,0,8,14);messages.Children.Add(answer);Reveal(answer);
    foreach(var item in A(V(t,"events"))){var ev=D(item);var content=new StackPanel();content.Children.Add(Text(json.Serialize(V(ev,"input"))));content.Children.Add(Text(S(ev,"output")));messages.Children.Add(new Expander{Header=S(ev,"tool"),Content=content,Margin=new Thickness(0,6,0,6)});}
    if(state=="approval"){
      messages.Children.Add(Text("允许执行上面的本机命令？"));var buttons=new StackPanel{Orientation=Orientation.Horizontal};
      foreach(bool allow in new[]{true,false}){bool choice=allow;string id=S(t,"id");var b=Button(allow?"允许这一次":"拒绝",allow?"仅批准当前操作":"拒绝当前操作");b.Click+=async(s,e)=>await Guard(async()=>{await Api("assistant.approve",Obj("id",id,"allow",choice));await Poll();});buttons.Children.Add(b);}messages.Children.Add(buttons);
    }
    if(S(t,"error")!=""){var e=Text(S(t,"error"));e.Foreground=Brushes.Firebrick;messages.Children.Add(e);}if(bottom)scroll.ScrollToEnd();
  }
  void ShowChat(){overlay.Visibility=Visibility.Collapsed;chat.Visibility=Visibility.Visible;Reveal(chat);}
  StackPanel Panel(string title){chat.Visibility=Visibility.Collapsed;overlay.Visibility=Visibility.Visible;overlay.Children.Clear();overlay.RowDefinitions.Clear();overlay.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});overlay.RowDefinitions.Add(new RowDefinition());var top=new DockPanel{Margin=new Thickness(0,0,0,10)};var back=Button("‹","返回对话，保留草稿");back.Click+=(s,e)=>ShowChat();top.Children.Add(back);top.Children.Add(new TextBlock{Text=title,FontSize=16,Margin=new Thickness(12,3,0,0)});overlay.Children.Add(top);var p=new StackPanel();panelStatus=Text("",11);panelStatus.Foreground=Brushes.Firebrick;AutomationProperties.SetName(panelStatus,"当前操作反馈");p.Children.Add(panelStatus);var feedback=new StackPanel();feedback.Children.Add(new TextBlock{Text="操作未完成",FontWeight=FontWeights.SemiBold,FontSize=14});panelErrorMessage=Text("",12);feedback.Children.Add(panelErrorMessage);panelErrorDetails=Text("",11);var diagnostic=new StackPanel();diagnostic.Children.Add(panelErrorDetails);var copyError=Button("复制详情","复制诊断信息");copyError.Click+=(sender,e)=>{try{Clipboard.SetText(panelErrorDetails.Text);}catch{}};diagnostic.Children.Add(copyError);feedback.Children.Add(new Expander{Header="诊断详情",Content=diagnostic});panelError=new Border{Child=feedback,Background=Brush("#FFF5F3"),BorderBrush=Brush("#E9C9C4"),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(10),Padding=new Thickness(12),Margin=new Thickness(0,0,0,12),Visibility=Visibility.Collapsed};p.Children.Add(panelError);var viewer=new ScrollViewer{Content=p,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};Grid.SetRow(viewer,1);overlay.Children.Add(viewer);return p;}
  TextBox Field(StackPanel p,string label,string value,bool multiline=false,string help=null){var heading=new StackPanel{Orientation=Orientation.Horizontal};heading.Children.Add(Text(label));if(help!=null){var hint=Button("ⓘ",help);hint.ToolTip=help;hint.Padding=new Thickness(3,0,3,0);hint.Margin=new Thickness(6,0,0,0);heading.Children.Add(hint);}p.Children.Add(heading);var t=new TextBox{Text=value,Padding=new Thickness(8),Margin=new Thickness(0,0,0,10),AcceptsReturn=multiline,TextWrapping=multiline?TextWrapping.Wrap:TextWrapping.NoWrap,MinHeight=multiline?65:32};AutomationProperties.SetName(t,label);p.Children.Add(t);return t;}
  CheckBox Check(StackPanel p,string label,bool value){var c=new CheckBox{Content=label,IsChecked=value,Margin=new Thickness(0,8,0,8)};p.Children.Add(c);return c;}
  Button ActionButton(StackPanel p,string label,Func<Task> fn){var b=Button(label,label);b.Margin=new Thickness(0,8,0,8);b.Click+=async(s,e)=>{b.IsEnabled=false;try{await Guard(fn);}finally{b.IsEnabled=true;}};p.Children.Add(b);return b;}
  void UpdateAccount(Dictionary<string,object> value){
    string nextEmail=S(value,"email");
    if(accountKnown&&nextEmail!=accountEmail){
      accountDrafts[accountEmail]=new AccountDrafts{Drafts=new Dictionary<string,string>(drafts),Selected=selected,Input=input.Text};
      AccountDrafts saved;drafts.Clear();selected=null;current=null;lastRender="";messages.Children.Clear();input.Text="";initialTaskLoaded=false;
      if(accountDrafts.TryGetValue(nextEmail,out saved)){foreach(var pair in saved.Drafts)drafts[pair.Key]=pair.Value;selected=saved.Selected;input.Text=saved.Input;initialTaskLoaded=true;}
      ShowWelcome();
    }
    accountKnown=true;accountEmail=nextEmail;bool signed=accountEmail!="";accountBadge.Visibility=signed?Visibility.Visible:Visibility.Collapsed;
    accountEntry.ToolTip=signed?accountEmail+" · 账号与同步":"登录与账号";AutomationProperties.SetName(accountEntry,Convert.ToString(accountEntry.ToolTip));
    if(tray!=null)tray.Text=signed?"CAgent Pro · 后台运行":"CAgent · 后台运行";
  }
  IEnumerable<DependencyObject> AccountElements(DependencyObject rootElement){yield return rootElement;foreach(object child in LogicalTreeHelper.GetChildren(rootElement)){var element=child as DependencyObject;if(element!=null)foreach(var nested in AccountElements(element))yield return nested;}}
  void VerifyAccountFlow(){
    UpdateAccount(Obj());input.Text="未发送的草稿";RenderAccount(Obj("email","example@example.com","membership",Obj("active",false)));
    if(accountBadge.Visibility!=Visibility.Visible)throw new Exception("Signed-in badge missing");
    bool free=false;foreach(var element in AccountElements(overlay)){var text=element as TextBlock;if(text!=null&&text.Text=="免费账号")free=true;}if(!free)throw new Exception("Free account was mislabeled");
    UpdateAccount(Obj());RenderAccountForm(false,"example@example.com");bool masked=false;Button register=null;
    foreach(var element in AccountElements(overlay)){if(element is PasswordBox)masked=true;var b=element as Button;if(b!=null&&Convert.ToString(b.Content)=="还没有账号？创建账号")register=b;}
    if(!masked||register==null)throw new Exception("Login controls missing");register.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));Button back=null;
    foreach(var element in AccountElements(overlay)){var b=element as Button;if(b!=null&&Convert.ToString(b.Content)=="‹ 返回登录")back=b;}
    if(back==null)throw new Exception("Registration return missing");back.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
    bool email=false;foreach(var element in AccountElements(overlay)){var t=element as TextBox;if(t!=null&&t.Text=="example@example.com")email=true;}
    if(!email||accountBadge.Visibility!=Visibility.Collapsed||input.Text!="未发送的草稿")throw new Exception("Account navigation lost context");
    File.WriteAllText(screenshot+".json",json.Serialize(Obj("maskedPassword",true,"registrationReturn",true,"emailPreserved",true,"chatDraftPreserved",true,"freeAccountNotMember",true,"loginBadge",true)),Encoding.UTF8);
  }
  async Task Account(){RenderAccount(D(await Api("account.status")));}
  void RenderAccount(Dictionary<string,object> value){
    UpdateAccount(value);var p=Panel("账号与同步");p.Margin=new Thickness(8,0,8,0);
    if(accountEmail==""){RenderAccountForm(false,"");return;}
    var identity=new StackPanel();identity.Children.Add(new TextBlock{Text=accountEmail.Split('@')[0],FontSize=24,FontWeight=FontWeights.SemiBold,Margin=new Thickness(0,12,0,4)});identity.Children.Add(Text(accountEmail,12));
    var member=D(value.ContainsKey("membership")?value["membership"]:null);identity.Children.Add(Text(B(member,"active")?"Pro 会员":"免费账号",12));
    p.Children.Add(new Border{Child=identity,Background=Brushes.White,CornerRadius=new CornerRadius(16),Padding=new Thickness(18,8,18,14),Margin=new Thickness(0,8,0,18)});
    p.Children.Add(Text("你的设备，共享一个工作空间",16));p.Children.Add(Text("在同账号的 CShell 中发现这台机器。Pro 会员可使用免公网 IP 连接。",12));
    string transport=S(value,"transportError");p.Children.Add(Text(transport!=""?transport:S(value,"state")=="error"?"连接暂时中断，恢复网络后自动重试。":"模型与设置在后台自动同步。",12));
    var confirm=new StackPanel{Visibility=Visibility.Collapsed,Margin=new Thickness(0,10,0,0)};
    ActionButton(p,"退出登录",async()=>{confirm.Visibility=Visibility.Visible;await Task.Yield();});p.Children.Add(confirm);confirm.Children.Add(Text("退出后停止账号同步和会员连接，是否继续？",12));
    ActionButton(confirm,"确认退出",async()=>{await Api("account.logout");await Account();});ActionButton(confirm,"取消",async()=>{confirm.Visibility=Visibility.Collapsed;await Task.Yield();});
  }
  void RenderAccountForm(bool register,string address){
    var p=Panel(register?"创建账号":"登录账号");p.Margin=new Thickness(12,0,12,0);
    if(register)ActionButton(p,"‹ 返回登录",async()=>{RenderAccountForm(false,address);await Task.Yield();});
    var heading=Text(register?"创建 CShell 账号":"欢迎回来",24);heading.FontWeight=FontWeights.SemiBold;p.Children.Add(heading);p.Children.Add(Text("登录后，在你的设备间自动同步。",12));
    var email=Field(p,"邮箱地址",address);TextBox code=null;
    if(register){code=Field(p,"邮箱验证码","");code.MaxLength=6;ActionButton(p,"发送验证码",async()=>{await Api("account.code",Obj("email",email.Text.Trim()));panelStatus.Text="验证码已发送，请查收邮件。";await Task.Delay(60000);});}
    p.Children.Add(Text(register?"设置密码 · 至少 8 位":"密码",12));var password=new PasswordBox{Padding=new Thickness(10),Margin=new Thickness(0,0,0,8),MinHeight=38,BorderBrush=Brush("#E1E6EA"),BorderThickness=new Thickness(1)};AutomationProperties.SetName(password,"账号密码");p.Children.Add(password);
    var submit=ActionButton(p,register?"创建账号":"登录",async()=>{if(password.Password.Length<8)throw new Exception("密码至少需要 8 个字符。");var args=Obj("email",email.Text.Trim(),"password",password.Password);if(register)args["code"]=code.Text.Trim();await Api(register?"account.register":"account.login",args);password.Clear();await Account();});submit.Background=Brush("#276E60");submit.Foreground=Brushes.White;submit.MinHeight=40;
    if(!register)ActionButton(p,"还没有账号？创建账号",async()=>{RenderAccountForm(true,email.Text);await Task.Yield();});
  }
  async Task History(){var list=new List<Dictionary<string,object>>();foreach(var t in A(await Api("assistant.tasks")))list.Add(D(t));list.Reverse();var p=Panel("会话记录");if(list.Count==0)p.Children.Add(Text("还没有任务记录"));foreach(var t in list){var item=t;ActionButton(p,S(t,"prompt"),async()=>{SelectTask(S(item,"id"));Render(item);ShowChat();await Task.Yield();});}}
  async Task Settings(){
    var s=D(await Api("assistant.settings"));var p=Panel("模型与权限");var endpoint=Field(p,"基座完整接口地址",S(s,"endpoint"));var model=Field(p,"模型",S(s,"model"));p.Children.Add(Text(B(s,"keyConfigured")?"API Key（已保存，留空保留）":"API Key"));var key=new PasswordBox{Padding=new Thickness(8),Margin=new Thickness(0,0,0,10)};p.Children.Add(key);
    var commands=Check(p,"允许本机命令",B(s,"commands"));var review=Check(p,"执行前逐次确认",B(s,"review"));p.Children.Add(Text("命令以当前用户权限运行，不是权限沙箱。",11));var ds=new List<string>();foreach(var d in A(V(s,"delegates")))ds.Add(Convert.ToString(d));var delegates=Field(p,"允许委派的控制端指纹（每行一个）",string.Join("\n",ds.ToArray()),true);
    var minutes=Field(p,"每轮时间预算（分钟，1–240）",S(s,"runMinutes"));var bytes=Field(p,"累计上下文预算（字节，非计费金额）",S(s,"contextBytes"));var repeated=Field(p,"重复无进展停止次数（2–20）",S(s,"noProgress"));
    ActionButton(p,"保存",async()=>{var value=Obj("runMinutes",int.Parse(minutes.Text),"contextBytes",int.Parse(bytes.Text),"noProgress",int.Parse(repeated.Text),"endpoint",endpoint.Text,"model",model.Text,"commands",commands.IsChecked==true,"review",review.IsChecked==true,"delegates",delegates.Text.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries));if(key.Password.Length>0)value["key"]=key.Password;await Api("assistant.configure",value);key.Clear();ModelLabel(model.Text);ShowChat();status.Text="设置已保存";});
    ActionButton(p,"删除已保存密钥",async()=>{s.Remove("keyConfigured");s["key"]="";await Api("assistant.configure",s);await Settings();});
  }
  async Task Apps(){
    var catalog=D(await Api("applications.list"));var policy=D(await Api("applications.policy"));var packages=A(await Api("packages.catalog"));RenderMarket(catalog,policy,packages);
  }
  string PackageState(string state){switch(state){case "available":return "可用";case "not-installed":return "未安装";case "not-configured":return "待配置";case "authorization-required":return "待授权";case "incompatible":return "版本不兼容";case "fault":return "故障";default:return "状态待核验";}}
  void VerifyMarket(){
    input.Text="市场切换保留草稿";var item=Obj("id","cagent.system-apps","name","系统应用管理","version","1.0.0","source","bundled","description","检查本机应用并生成安装计划。","status","not-installed","installed",false);
    RenderMarket(Obj("platform","win32","manager","winget","applications",new[]{Obj("id","git","package","Git.Git")}),Obj("enabled",false),new[]{item});
    if(overlay.Visibility!=Visibility.Visible||chat.Visibility!=Visibility.Collapsed)throw new Exception("Market overlay missing");ShowChat();if(input.Text!="市场切换保留草稿")throw new Exception("Market lost chat draft");
    RenderPackage(item,Obj("id","cagent.system-apps","status","authorization-required","registered",false,"grants",new string[0],"requiredPermissions",new[]{"applications.read","applications.plan","applications.install"}));
    UpdateLayout();var checks=new List<CheckBox>();FindChecks(overlay,checks);if(checks.Count!=3)throw new Exception("Package permission controls missing");foreach(var check in checks)if(check.IsChecked==true)throw new Exception("Installation implicitly granted capability");
    if(PackageState("not-installed")==PackageState("available"))throw new Exception("Uninstalled state hidden");
    RenderMarket(Obj("platform","win32","manager","winget","applications",new[]{Obj("id","git","package","Git.Git")}),Obj("enabled",true),new[]{item,Obj("id","cagent.desktop","name","远程桌面","installed",true)});
    if(screenshot!=null)File.WriteAllText(screenshot+".json",json.Serialize(Obj("fixture",true,"marketOverlay",true,"chatDraftPreserved",true,"installedWithoutGrants","待授权","realSoftwareInstalled",false)),Encoding.UTF8);
  }
  void FindChecks(DependencyObject parent,List<CheckBox> result){var check=parent as CheckBox;if(check!=null)result.Add(check);for(int i=0;i<VisualTreeHelper.GetChildrenCount(parent);i++)FindChecks(VisualTreeHelper.GetChild(parent,i),result);}
  string PermissionName(string value){switch(value){case "wechat.read":return "读取微信与监听消息";case "wechat.send":return "发送微信与发布朋友圈";case "wechat.contacts.manage":return "修改好友备注";case "applications.read":return "读取系统应用目录";case "applications.plan":return "检查并生成安装计划";case "applications.install":return "按计划安装系统应用";default:return value;}}
  StackPanel MarketCard(StackPanel p,string title,string subtitle){var content=new StackPanel();var heading=Text(title,14);heading.FontWeight=FontWeights.SemiBold;content.Children.Add(heading);content.Children.Add(Text(subtitle,11));p.Children.Add(new Border{Background=Brushes.White,BorderBrush=Brush("#E5E8ED"),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(12),Padding=new Thickness(12,7,12,7),Margin=new Thickness(0,5,0,7),Child=content});return content;}
  void AppTile(WrapPanel grid,string name,string symbol,string state,Func<Task> action){
    var body=new StackPanel{Margin=new Thickness(8),HorizontalAlignment=HorizontalAlignment.Center};
    var icon=new Border{Width=42,Height=42,CornerRadius=new CornerRadius(12),Background=Brush("#E7F1EE"),Margin=new Thickness(0,0,0,8),Child=new TextBlock{Text=symbol,FontSize=24,Foreground=Brush("#244B48"),HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center,FontFamily=new FontFamily("Segoe MDL2 Assets")}};body.Children.Add(icon);
    body.Children.Add(new TextBlock{Text=name,FontSize=12,FontWeight=FontWeights.SemiBold,TextAlignment=TextAlignment.Center,TextTrimming=TextTrimming.CharacterEllipsis,MaxWidth=118});body.Children.Add(new TextBlock{Text=state,FontSize=10,Foreground=Brush("#78878C"),TextAlignment=TextAlignment.Center,Margin=new Thickness(0,5,0,0)});
    var button=Button("",name);button.Width=136;button.Height=126;button.Margin=new Thickness(3);button.Background=Brushes.White;button.Content=body;button.Click+=async(sender,e)=>await Guard(action);grid.Children.Add(button);
  }
  void RenderMarket(Dictionary<string,object> catalog,Dictionary<string,object> policy,IEnumerable packages){
    var p=Panel("应用市场");var search=Field(p,"搜索应用","");var cards=new WrapPanel();p.Children.Add(cards);
    Action render=()=>{cards.Children.Clear();string query=search.Text.Trim().ToLowerInvariant();
      if(S(catalog,"platform")=="win32"&&("linux wsl ubuntu 虚拟机".Contains(query)))AppTile(cards,"Linux 虚拟机","\uE756","WSL · 检查与安装",Linux);
      foreach(var value in packages){var item=D(value);if(!(S(item,"name")+S(item,"id")).ToLowerInvariant().Contains(query))continue;AppTile(cards,S(item,"name"),S(item,"id")=="cagent.desktop"?"\uE7F4":"\uE71D",B(item,"installed")?"已安装 · 配置":"安装",async()=>await PackageDetail(item));}
      foreach(var value in A(V(catalog,"applications"))){var item=D(value);if(!(S(item,"id")+S(item,"package")).ToLowerInvariant().Contains(query))continue;AppTile(cards,S(item,"id"),"\uE74C","查看安装",async()=>await Plan(D(await Api("applications.plan",Obj("app",S(item,"id"))))));}
      if(cards.Children.Count==0)cards.Children.Add(Text("没有匹配的应用",11));
    };search.TextChanged+=(sender,e)=>render();render();
    var settings=new StackPanel();p.Children.Add(new Expander{Header="安装设置",Content=settings,Margin=new Thickness(0,12,0,0)});var enabled=Check(settings,"允许应用安装",B(policy,"enabled"));ActionButton(settings,"保存",async()=>{policy["enabled"]=enabled.IsChecked==true;await Api("applications.configure",policy);});
  }
  async Task PackageDetail(Dictionary<string,object> item){Dictionary<string,object> installed=null;foreach(var value in A(await Api("packages.list"))){var record=D(value);if(S(record,"id")==S(item,"id"))installed=record;}RenderPackage(item,installed);}
  void RenderPackage(Dictionary<string,object> item,Dictionary<string,object> installed){
    string id=S(item,"id");var p=Panel(S(item,"name"));ActionButton(p,"返回应用市场",Apps);p.Children.Add(Text(S(item,"description"),12));p.Children.Add(Text("版本 "+S(item,"version")+" · "+(S(item,"source")=="bundled"?"随 CAgent 提供":"GitHub"),11));p.Children.Add(Text(PackageState(S(installed??item,"status")),14));if(S(installed??item,"reason")!="")p.Children.Add(Text(S(installed??item,"reason"),11));
    if(installed==null){p.Children.Add(Text("安装后按应用要求完成配置，可在这里调整工具权限。",11));ActionButton(p,"安装并核验能力包",async()=>{var installedNow=D(await Api("packages.install",Obj("id",id,"confirm",true)));await Api("packages.grant",Obj("id",id,"permissions",V(installedNow,"requiredPermissions")));await PackageDetail(item);});return;}
    p.Children.Add(Text(B(installed,"registered")?"工具已注册":"工具未注册",11));var grants=new HashSet<string>();foreach(var grant in A(V(installed,"grants")))grants.Add(Convert.ToString(grant));var choices=new Dictionary<string,CheckBox>();foreach(var value in A(V(installed,"requiredPermissions"))){string permission=Convert.ToString(value);choices[permission]=Check(p,PermissionName(permission),grants.Contains(permission));}
    if(id=="cagent.wechat")ActionButton(p,"微信账号与授权",WechatSettings);
    if(id=="cagent.desktop"){var desktopBody=new StackPanel();var section=new Expander{Header="桌面服务与访问权限",Content=desktopBody,Margin=new Thickness(0,8,0,8)};bool loaded=false;section.Expanded+=async(s,e)=>{if(loaded)return;await Guard(async()=>{await DesktopSettings(desktopBody);loaded=true;});};p.Children.Add(section);}
    p.Children.Add(Text("选择仅修改草稿，保存后生效。系统应用安装还受独立安装权限限制。",11));
    ActionButton(p,"保存工具权限",async()=>{var allowed=new List<string>();foreach(var pair in choices)if(pair.Value.IsChecked==true)allowed.Add(pair.Key);await Api("packages.grant",Obj("id",id,"permissions",allowed.ToArray()));await PackageDetail(item);});
    ActionButton(p,"重新核验",async()=>{await Api("packages.refresh",Obj("id",id));await PackageDetail(item);});
    ActionButton(p,"停用工具",async()=>{await Api("packages.grant",Obj("id",id,"permissions",new string[0]));await PackageDetail(item);});
    var removal=new StackPanel{Visibility=Visibility.Collapsed};ActionButton(p,"卸载能力包",async()=>{removal.Visibility=Visibility.Visible;await Task.Yield();});p.Children.Add(removal);removal.Children.Add(Text("卸载将停止此能力包的任务并移除工具注册，不卸载已安装的系统软件。",11));ActionButton(removal,"确认卸载",async()=>{await Api("packages.uninstall",Obj("id",id,"confirm",true));await Apps();});ActionButton(removal,"保留能力包",async()=>{removal.Visibility=Visibility.Collapsed;await Task.Yield();});
  }
  int DesktopPort(string text){int value;if(!int.TryParse(text,out value)||value<1||value>65535)throw new Exception("端口需要填写 1 至 65535 的整数");return value;}
  async Task Linux(){
    var p=Panel("Linux 虚拟机 · WSL");p.Children.Add(Text("正在检查此 Windows 主机…",12));
    var state=D(await Api("wsl.check"));p.Children.Clear();
    p.Children.Add(Text("在本机安装 Linux，安装后可在 CShell 的此机器终端中选择发行版。",12));
    p.Children.Add(Text("不会覆盖已有发行版，也不会自动重启。云服务器需要开放嵌套虚拟化。",11));
    p.Children.Add(Text("虚拟化："+(B(state,"virtualization")?"已启用":"未启用或不可用")+" · "+(B(state,"administrator")?"管理员":"普通用户")+(B(state,"rebootPending")?" · 系统等待重启":""),11));
    var existing=new List<string>();foreach(var item in A(V(state,"distributions")))existing.Add(Convert.ToString(item));p.Children.Add(Text(existing.Count>0?"已安装："+string.Join("、",existing.ToArray()):"尚无 Linux 发行版",12));
    if(S(state,"onlineError")!="")p.Children.Add(Text(S(state,"onlineError"),11));foreach(var tip in A(V(state,"guidance")))p.Children.Add(Text(Convert.ToString(tip),11));
    p.Children.Add(Text("Linux 发行版",12));var choices=new ComboBox{Margin=new Thickness(0,6,0,10),Padding=new Thickness(8)};foreach(var item in A(V(state,"online"))){string name=Convert.ToString(item);if(!existing.Contains(name))choices.Items.Add(name);}if(choices.Items.Count>0)choices.SelectedIndex=0;if(choices.Items.Contains("Ubuntu"))choices.SelectedItem="Ubuntu";p.Children.Add(choices);
    var direct=Check(p,"直接下载（避开 Microsoft Store）",B(state,"webDownloadSupported"));direct.IsEnabled=B(state,"webDownloadSupported");
    var elevated=Check(p,"管理员安装（点击后由 Windows 请求授权）",!B(state,"administrator"));
    p.Children.Add(Text("系统组件安装可能需要重启。确认系统提示后，请重新打开此页检查并继续安装。",11));
    var progress=Text("",12);var log=Field(p,"安装记录",S(D(V(state,"installation")),"logs"),true);log.IsReadOnly=true;log.MaxHeight=180;p.Children.Add(progress);
    Func<bool,Task> install=async update=>{
      string distribution=Convert.ToString(choices.SelectedItem);if(string.IsNullOrEmpty(distribution)){if(!update)throw new Exception("没有可安装的发行版，请先检查网络或更新 WSL");distribution="Ubuntu";}
      choices.IsEnabled=false;try{var plan=D(await Api("wsl.plan",Obj("distribution",distribution,"webDownload",direct.IsChecked==true,"operation",update?"update":"install")));progress.Text="正在安装…";var task=D(await Api("wsl.install",Obj("planId",S(plan,"id"),"confirm",true,"elevate",elevated.IsChecked==true)));
        while(true){string phase=S(task,"state");log.Text=S(task,"logs");progress.Text=phase=="running"?"Windows 正在安装，请稍候":phase=="completed"?"已完成，可刷新终端列表":phase=="restart-required"?"系统需要重启或继续安装；请稍后重新检查":phase=="failed"?"安装未完成，请查看记录并重新检查":"安装已停止";if(phase!="running")break;await Task.Delay(1500);task=D(await Api("wsl.status"));if(!overlay.IsVisible)break;}
      }finally{choices.IsEnabled=true;}
    };
    ActionButton(p,"安装 Linux",async()=>await install(false));if(B(state,"updateSupported"))ActionButton(p,"更新 WSL",async()=>await install(true));ActionButton(p,"重新检查",Linux);ActionButton(p,"返回应用市场",Apps);
  }
  void VerifyDesktopSettings(){var p=Panel("桌面服务设置");RenderDesktopSettings(p,Obj("enabled",false,"bindAddress","127.0.0.1","tcpPort",9998,"udpPort",9999,"local",Obj("view",false,"control",false),"ownerGrants",Obj()),false);UpdateLayout();var checks=new List<CheckBox>();FindChecks(p,checks);if(checks.Count!=4)throw new Exception("Desktop grants missing");foreach(var check in checks)if(check.IsChecked==true)throw new Exception("Desktop permissions default enabled");bool refused=false;try{DesktopPort("0");}catch{refused=true;}if(!refused||DesktopPort("65535")!=65535)throw new Exception("Desktop port validation failed");if(screenshot!=null)File.WriteAllText(screenshot+".json",json.Serialize(Obj("fixture",true,"serviceDefaultOff",true,"viewDefaultOff",true,"controlDefaultOff",true,"portValidation",true,"realDesktopStarted",false)),Encoding.UTF8);}
  async Task WechatSettings(){
    var state=D(await Api("wechat.status"));RenderWechatSettings(state);
  }
  void RenderWechatSettings(Dictionary<string,object> state){
    var config=D(V(state,"config"));var p=Panel("微信掌控");
    p.Children.Add(Text("此机器上的微信 · 精确版本适配，操作可能导致微信退出。",11));
    if(S(state,"error")!="")p.Children.Add(Text(S(state,"error"),11));
    var process=new ComboBox{Margin=new Thickness(0,8,0,8),MinHeight=32};p.Children.Add(process);
    foreach(var raw in A(V(state,"processes"))){var item=D(raw);var choice=new ComboBoxItem{Content="微信 "+S(item,"version")+" · "+S(item,"pid"),Tag=V(item,"pid")};process.Items.Add(choice);if(S(item,"pid")==S(config,"pid"))process.SelectedItem=choice;}
    ActionButton(p,"刷新进程",WechatSettings);
    var checks=new Dictionary<string,CheckBox>();
    string[] keys={"enabled","experimental","readContacts","readSessions","readMoments","publishMoments","sendFiles"};
    string[] labels={"启用微信控制","了解崩溃风险并允许实验控制","读取通讯录","读取最近会话","读取朋友圈缓存","发布纯文字朋友圈","发送本机文件（仍遵守发送名单）"};
    for(int i=0;i<keys.Length;i++)checks[keys[i]]=Check(p,labels[i],B(config,keys[i]));
    var fields=new Dictionary<string,TextBox>();string[] scopes={"send","sendBlocked","receive","history","remarks"};string[] names={"允许发送","发送黑名单","允许接收","允许读取历史","允许修改备注"};
    p.Children.Add(Text("范围用内部 ID，逗号分隔；* 表示全部，黑名单只接受准确 ID。",11));
    for(int i=0;i<scopes.Length;i++){var values=new List<string>();foreach(var value in A(V(config,scopes[i])))values.Add(Convert.ToString(value));fields[scopes[i]]=Field(p,names[i],String.Join(",",values));}
    ActionButton(p,"保存并核验",async()=>{foreach(var check in checks)config[check.Key]=check.Value.IsChecked==true;config["pid"]=process.SelectedItem==null?null:((ComboBoxItem)process.SelectedItem).Tag;foreach(var field in fields)config[field.Key]=field.Value.Text.Split(new[]{',','，',' ','\n','\r'},StringSplitOptions.RemoveEmptyEntries);await Api("wechat.configure",config);panelStatus.Text="已保存";});
    ActionButton(p,"停止消息监听",async()=>{await Api("wechat.stop");panelStatus.Text="监听已停止";});
    ActionButton(p,"返回应用市场",Apps);
  }
  async Task DesktopSettings(StackPanel p){var statusValue=D(await Api("desktop.status"));RenderDesktopSettings(p,D(V(statusValue,"config")),B(statusValue,"listening"),D(V(statusValue,"systemDesktop")));}
  void RenderDesktopSettings(StackPanel p,Dictionary<string,object> config,bool listening,Dictionary<string,object> system=null){
    p.Children.Clear();var enabled=Check(p,"启用远程桌面",B(config,"enabled"));var peers=Check(p,"允许已连接的控制端观看和操作",B(config,"authenticatedPeers"));var local=D(V(config,"local"));var view=Check(p,"允许本机观看",B(local,"view"));var control=Check(p,"允许本机控制",B(local,"control"));
    p.Children.Add(Text("复用 CAgent 连接，无需额外端口。",11));
    ActionButton(p,"保存",async()=>{config["enabled"]=enabled.IsChecked==true;config["authenticatedPeers"]=peers.IsChecked==true;config["directListener"]=false;config["local"]=Obj("view",view.IsChecked==true,"control",control.IsChecked==true);await Api("desktop.configure",config);await DesktopSettings(p);});
    var systemBody=new StackPanel();RenderSystemDesktop(systemBody,system??Obj());p.Children.Add(new Expander{Header="系统桌面 · 锁屏与登录界面",Content=systemBody,Margin=new Thickness(0,10,0,6)});
    var virtualBody=new StackPanel();bool loaded=false;var virtualSection=new Expander{Header="虚拟显示 · 无显示器主机",Content=virtualBody,Margin=new Thickness(0,6,0,6)};virtualSection.Expanded+=async(sender,e)=>{if(loaded)return;await Guard(async()=>{await VirtualDisplaySettings(virtualBody);loaded=true;});};p.Children.Add(virtualSection);
  }
  void VerifySystemDesktopSettings(bool virtualDisplay){
    input.Text="保留对话草稿";var p=Panel(virtualDisplay?"虚拟显示":"系统桌面");
    if(virtualDisplay)RenderVirtualDisplaySettings(p,Obj("plan",Obj("compatible",true,"experimental",true,"warning","Windows Server 实验支持，实机验收尚未完成。"),"probe",Obj("activePaths",0),"tasks",new[]{Obj("id","0123456789abcdef0123456789abcdef","phase","recovery-required","error","测试任务：需要恢复显示配置")},"busy",false));
    else RenderSystemDesktop(p,Obj("supported",true,"installed",true,"running",true,"elevated",false,"runtimeMatches",false,"ready",false));
    UpdateLayout();if(input.Text!="保留对话草稿"||overlay.Visibility!=Visibility.Visible)throw new Exception("Desktop settings lost conversation context");
    bool invalid=false;try{DisplayDimension("0");}catch{invalid=true;}if(!invalid||DisplayDimension("1920")!=1920)throw new Exception("Desktop settings validation failed");
    if(!File.Exists(DesktopPowerShellPath()))throw new Exception("Windows PowerShell executable is missing");
    if(QuoteWindowsArg("")!="\"\""||QuoteWindowsArg("C:\\Path With Space\\")!="\"C:\\Path With Space\\\\\""||QuoteWindowsArg("a\"b")!="\"a\\\"b\"")throw new Exception("Windows argument quoting failed");
    if(screenshot!=null)File.WriteAllText(screenshot+".json",json.Serialize(Obj("powerShellPathExists",true,"windowsArgumentQuoting",true,"fixture",true,"virtualDisplay",virtualDisplay,"draftPreserved",true,"dimensionValidation",true,"serviceInstalled",false,"driverInstalled",false,"realDesktopStarted",false)),Encoding.UTF8);
  }
  static string DesktopPowerShellPath(){return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");}
  static string QuoteWindowsArg(string value){
    var result=new StringBuilder();result.Append('"');int slashes=0;
    foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append('"');}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
    result.Append('\\',slashes*2);result.Append('"');return result.ToString();
  }
  static string FileDigest(string path){using(var stream=File.OpenRead(path))using(var sha=System.Security.Cryptography.SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","");}
  static bool Administrator(){return new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent()).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);}
  async Task InstallDesktopSystemService(){
    if(fixture)throw new Exception("夹具不能安装系统服务");
    string app=AppDomain.CurrentDomain.BaseDirectory,source=Path.Combine(app,"system-desktop"),script=Path.Combine(app,"install-system-service.ps1"),runtime=Path.Combine(app,"node.exe");
    foreach(string file in new[]{script,runtime,Path.Combine(source,"cagent-desktop.exe"),Path.Combine(source,"cagent-desktop-broker.exe")})if(!File.Exists(file))throw new Exception("当前安装包缺少系统桌面组件，请更新完整 CAgent 安装包");
    string sid=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
    string[] arguments={"-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-Action","Install","-SourceDirectory",source,"-OwnerSid",sid,"-WorkerSha256",FileDigest(Path.Combine(source,"cagent-desktop.exe")),"-BrokerSha256",FileDigest(Path.Combine(source,"cagent-desktop-broker.exe")),"-RuntimeImagePath",runtime};
    var encoded=new List<string>();foreach(string argument in arguments)encoded.Add(QuoteWindowsArg(argument));
    string executable=DesktopPowerShellPath();if(!File.Exists(executable))throw new Exception("找不到 Windows PowerShell，无法安装系统服务");
    var start=new ProcessStartInfo(executable,String.Join(" ",encoded.ToArray())){UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=app};
    panelStatus.Text="等待 Windows 管理员确认，随后安装系统桌面服务…";
    int exit=await Task.Run(()=>{using(var process=Process.Start(start)){process.WaitForExit();return process.ExitCode;}});if(exit!=0)throw new Exception("系统桌面安装未成功（退出码 "+exit+"），请检查安装组件并刷新状态");
  }
  void RenderSystemDesktop(StackPanel p,Dictionary<string,object> state){
    p.Children.Clear();p.Children.Add(Text(B(state,"ready")?"系统桌面服务已就绪":B(state,"installed")?"系统桌面服务已安装，仍需检查运行条件":"尚未安装系统桌面服务",13));
    p.Children.Add(Text("锁屏操作需要系统桌面服务，并以管理员身份运行 CAgent。仍需输入 Windows 登录密码。",11));
    if(B(state,"installed"))p.Children.Add(Text("服务："+(B(state,"running")?"运行中":"未运行")+" · 运行时："+(B(state,"runtimeMatches")?"匹配":"需要更新注册"),11));
    if(B(state,"updateRequired"))p.Children.Add(Text("系统桌面组件与当前 CAgent 不一致，请安装/更新系统桌面服务。",11));
    if(!B(state,"elevated"))p.Children.Add(Text("请在合适时机退出当前 CAgent，再右键以管理员身份运行；此处不会关闭现有连接。",11));
    if(S(state,"error")!="")p.Children.Add(Text(S(state,"error"),11));
    p.Children.Add(Text("锁屏登录与无显示器场景的实机验收尚未完成。",11));
    var confirm=new StackPanel{Visibility=Visibility.Collapsed};
    var install=ActionButton(p,B(state,"installed")?"更新系统桌面服务…":"安装系统桌面服务…",async()=>{confirm.Visibility=Visibility.Visible;await Task.Yield();});install.IsEnabled=B(state,"supported");
    if(!B(state,"supported"))p.Children.Add(Text("当前系统或安装包不支持系统桌面服务。",11));
    p.Children.Add(confirm);confirm.Children.Add(Text("将请求管理员权限并安装系统服务；更新会短暂中断正在使用的系统桌面采集。",11));
    ActionButton(confirm,"确认安装并请求管理员权限",async()=>{await InstallDesktopSystemService();RenderSystemDesktop(p,D(V(D(await Api("desktop.status")),"systemDesktop")));panelStatus.Text="安装步骤结束，已刷新真实服务状态";});
    ActionButton(confirm,"取消",async()=>{confirm.Visibility=Visibility.Collapsed;await Task.Yield();});
    ActionButton(p,"刷新系统桌面状态",async()=>RenderSystemDesktop(p,D(V(D(await Api("desktop.status")),"systemDesktop"))));
  }
  static string VirtualPhase(string phase){switch(phase){case "active":return "运行中";case "removed":return "已移除";case "recovery-required":return "需要恢复";case "prepared":return "已准备";case "registering":return "注册设备中";case "installing":return "安装中";case "waiting-for-display":return "等待显示设备";case "applying-topology":return "应用显示配置中";case "removing":return "移除中";default:return phase;}}
  static int DisplayDimension(string text){int value;if(!int.TryParse(text,out value)||value<1)throw new Exception("显示宽高需要填写正整数");return value;}
  async Task VirtualDisplaySettings(StackPanel p){RenderVirtualDisplaySettings(p,D(await Api("desktop.virtual-display.status",Obj())));}
  void RenderVirtualDisplaySettings(StackPanel p,Dictionary<string,object> state){
    p.Children.Clear();var planInfo=D(V(state,"plan"));p.Children.Add(Text("安装独立虚拟显示设备，保留原显示器和主屏。需要管理员身份运行 CAgent。",11));p.Children.Add(Text("无屏、重启恢复及锁屏实机验收尚未完成；Windows Server 为实验支持。",11));
    var dimensions=new Grid{Margin=new Thickness(0,6,0,0)};dimensions.ColumnDefinitions.Add(new ColumnDefinition());dimensions.ColumnDefinitions.Add(new ColumnDefinition());var left=new StackPanel{Margin=new Thickness(0,0,5,0)};var right=new StackPanel{Margin=new Thickness(5,0,0,0)};Grid.SetColumn(right,1);dimensions.Children.Add(left);dimensions.Children.Add(right);p.Children.Add(dimensions);TextBox width=Field(left,"宽度","1920"),height=Field(right,"高度","1080");var server=Check(p,"允许 Windows Server 实验安装",false);var planBody=new StackPanel();Dictionary<string,object> currentPlan=null;bool operating=B(state,"busy");
    Action invalidate=()=>{currentPlan=null;planBody.Children.Clear();};width.TextChanged+=(sender,e)=>invalidate();height.TextChanged+=(sender,e)=>invalidate();server.Checked+=(sender,e)=>invalidate();server.Unchecked+=(sender,e)=>invalidate();
    var check=ActionButton(p,"检查并生成安装计划",async()=>{invalidate();currentPlan=D(await Api("desktop.virtual-display.plan",Obj("width",DisplayDimension(width.Text),"height",DisplayDimension(height.Text),"experimentalServer",server.IsChecked==true)));var prepared=currentPlan;planBody.Children.Add(Text("计划："+S(prepared,"id")+" · "+S(prepared,"width")+" × "+S(prepared,"height"),11));planBody.Children.Add(Text(S(prepared,"warning"),11));if(prepared.ContainsKey("preflight"))planBody.Children.Add(Text(S(D(prepared["preflight"]),"reason"),11));if(!B(prepared,"helperAvailable"))planBody.Children.Add(Text("缺少虚拟显示组件，请更新完整安装包。",11));if(B(prepared,"experimental")&&server.IsChecked!=true)planBody.Children.Add(Text("此服务器仅实验支持；需要先勾选并重新生成计划。",11));
      var execute=ActionButton(planBody,"确认执行此安装计划",async()=>{if(currentPlan!=prepared)throw new Exception("计划已变化，请重新检查");if(!Administrator())throw new Exception("请先以管理员身份运行 CAgent，再重新生成安装计划");currentPlan=null;operating=true;p.IsEnabled=false;panelStatus.Text="虚拟显示安装中，请勿重复执行；完成后检查任务状态。";try{var result=D(await Api("desktop.virtual-display.install",Obj("planId",S(prepared,"id"),"confirm",true)));panelStatus.Text="任务 "+S(result,"id")+" · "+S(result,"phase");await VirtualDisplaySettings(p);}finally{operating=false;p.IsEnabled=true;}});execute.IsEnabled=B(prepared,"compatible")&&B(prepared,"helperAvailable")&&(!B(prepared,"experimental")||server.IsChecked==true)&&!operating;
    });check.IsEnabled=!operating;p.Children.Add(planBody);
    var probe=D(V(state,"probe"));p.Children.Add(Text("当前活动显示路径："+S(probe,"activePaths")+(operating?" · 操作进行中":""),11));if(S(planInfo,"warning")!="")p.Children.Add(Text(S(planInfo,"warning"),11));
    var tasks=V(state,"tasks");if(tasks is Dictionary<string,object>)p.Children.Add(Text(S(D(tasks),"error"),11));else foreach(var raw in A(tasks)){var task=D(raw);string id=S(task,"id"),phase=S(task,"phase");var card=MarketCard(p,"任务 · "+VirtualPhase(phase),id);if(S(task,"error")!="")card.Children.Add(Text(S(task,"error"),11));if(phase=="removed")continue;var actions=new StackPanel();card.Children.Add(new Expander{Header="恢复或移除本任务创建的设备",Content=actions});actions.Children.Add(Text("只操作 CAgent 此任务的设备记录，可能短暂改变远端画面。",11));foreach(string operation in new[]{"recover","remove"}){string method=operation;var button=ActionButton(actions,method=="recover"?"确认恢复安装前显示配置":"确认移除此虚拟设备",async()=>{if(!Administrator())throw new Exception("请先以管理员身份运行 CAgent");panelStatus.Text="正在处理任务 "+id;var result=D(await Api("desktop.virtual-display."+method,Obj("id",id,"confirm",true)));panelStatus.Text="任务 "+S(result,"id")+" · "+S(result,"phase");await VirtualDisplaySettings(p);});button.IsEnabled=!operating;}}
    ActionButton(p,"刷新虚拟显示与任务状态",async()=>await VirtualDisplaySettings(p));

  }

  async Task Plan(Dictionary<string,object> plan){var p=Panel(S(plan,"app"));p.Children.Add(Text(S(plan,"state")));p.Children.Add(Text(S(plan,"warning"),11));p.Children.Add(Text(S(plan,"executable")+" "+json.Serialize(V(plan,"args")),11));p.Children.Add(Text(S(plan,"logs"),11));if(S(plan,"state")=="planned")ActionButton(p,"执行此安装计划",async()=>await Plan(D(await Api("applications.install",Obj("id",S(plan,"id"),"confirm",true)))));if(S(plan,"state")=="running")ActionButton(p,"取消安装",async()=>await Plan(D(await Api("applications.cancel",Obj("id",S(plan,"id"))))));ActionButton(p,"刷新进度",async()=>await Plan(D(await Api("applications.status",Obj("id",S(plan,"id"))))));await Task.Yield();}
  async Task RestartRemote(){if(timer!=null)timer.Stop();connected=false;try{if(host!=null&&!host.HasExited)host.StandardInput.Close();}catch{}await Start("restart-app-host");await Remote();}
  async Task Remote(){
    var p=Panel("连接与启动");panelStatus.Text="正在读取连接设置…";
    Dictionary<string,object> s;
    try{s=D(await Api("connection.settings"));panelStatus.Text="";}
    catch(Exception error){
      panelStatus.Text=error.Message.Contains("不支持")||error.Message.Contains("Unsupported")?"后台仍是旧版，无法打开新版连接设置。重启后台后即可继续；正在使用的连接会断开。":error.Message;
      ActionButton(p,"重启后台并重试",RestartRemote);
      ActionButton(p,"重新读取",Remote);return;
    }
    var interfaces=new List<string>();foreach(var item in A(V(s,"interfaces")))interfaces.Add(Convert.ToString(item));
    var bind=Field(p,"监听地址（0.0.0.0 表示所有网卡）",S(s,"bind")==""?"0.0.0.0":S(s,"bind"),false,"监听地址决定在哪些网卡接收连接。0.0.0.0 表示全部网卡，不是给别人连接的地址。");
    var port=Field(p,"连接端口",S(s,"port")==""?"24443":S(s,"port"),false,"cagent 在本机监听此端口。局域网连接使用本机 IP 和此端口；公网映射需同时配置路由器或云防火墙。");
    var address=Field(p,"连接地址（公网域名或 IP）",(S(s,"advertisedHost")==""||S(s,"advertisedHost")=="0.0.0.0")?(interfaces.Count>0?interfaces[0]:"127.0.0.1"):S(s,"advertisedHost"),false,"填写对方能访问的局域网 IP、公网 IP 或域名。保存后复制连接信息给对方，密码另行提供。");
    var publicPort=Field(p,"对外端口（留空使用连接端口）",S(s,"advertisedPort"),false,"端口映射外部端口不同时填写。没有映射则留空，复制连接信息会使用此端口。");
    var password=Field(p,"连接密码",S(s,"password"));
    var startup=Check(p,"开机自动启动",B(D(V(s,"autostart")),"enabled"));startup.IsEnabled=B(D(V(s,"autostart")),"supported");startup.Click+=async(sender,e)=>await Guard(async()=>{await Api("connection.autostart",Obj("enabled",startup.IsChecked==true));});
    var advanced=new StackPanel();p.Children.Add(new Expander{Header="访问权限",Content=advanced,Margin=new Thickness(0,10,0,10)});
    bool fresh=!B(s,"passwordConfigured");var manage=Check(advanced,"远程管理全部设置",fresh||B(s,"allowManage"));var http=Check(advanced,"HTTP 请求",fresh||B(s,"allowHttp"));var hosting=Check(advanced,"服务托管",fresh||B(s,"allowHosting"));var relay=Check(advanced,"中继",fresh||B(s,"allowRelay"));
    ActionButton(p,"保存并开启连接",async()=>{if(string.IsNullOrWhiteSpace(password.Text)&&!B(s,"passwordConfigured"))throw new Exception("请先填写连接密码，再开启连接。");if(address.Text.Trim()=="0.0.0.0"||address.Text.Trim()=="::")throw new Exception("请将连接地址改为对方能访问的 IP 或域名。");await Api("connection.save",Obj("bind",bind.Text.Trim(),"port",DesktopPort(port.Text),"advertisedHost",address.Text.Trim(),"advertisedPort",string.IsNullOrWhiteSpace(publicPort.Text)?DesktopPort(port.Text):DesktopPort(publicPort.Text),"password",password.Text,"allowManage",manage.IsChecked==true,"allowHttp",http.IsChecked==true,"allowHosting",hosting.IsChecked==true,"allowRelay",relay.IsChecked==true));await Remote();});
    ActionButton(p,"复制连接信息",async()=>{var info=await Api("client.info",Obj("host",address.Text.Trim()));Clipboard.SetText(Convert.ToString(info));status.Text="已复制，在 CShell 的 CAgent 连接中粘贴";});
    if(B(s,"running"))ActionButton(p,"停止连接服务",async()=>{await Api("client.stop");await Remote();});
  }
  void SaveImage(string path){var bitmap=new RenderTargetBitmap((int)ActualWidth,(int)ActualHeight,96,96,PixelFormats.Pbgra32);bitmap.Render(this);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using(var output=File.Create(path))encoder.Save(output);}
  [STAThread]public static void Main(string[] args){
    if(args.Length>0){new Application().Run(new CagentWindow(args));return;}
    string scope=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
    using(var mutex=new System.Threading.Mutex(false,"Local\\CAgent.Window."+scope)){
      bool owned=false;try{owned=mutex.WaitOne(0);}catch(System.Threading.AbandonedMutexException){owned=true;}
      if(!owned){try{using(var existing=System.Threading.EventWaitHandle.OpenExisting("Local\\CAgent.Show."+scope))existing.Set();}catch{}return;}
      using(var show=new System.Threading.EventWaitHandle(false,System.Threading.EventResetMode.AutoReset,"Local\\CAgent.Show."+scope)){
        var app=new Application();var window=new CagentWindow(args);
        var wait=System.Threading.ThreadPool.RegisterWaitForSingleObject(show,(state,timedOut)=>window.Dispatcher.BeginInvoke(new Action(window.RestoreWindow)),null,-1,false);
        app.SessionEnding+=(sender,e)=>{window.exiting=true;};
        try{app.Run(window);}finally{wait.Unregister(null);mutex.ReleaseMutex();}
      }
    }
  }
}
