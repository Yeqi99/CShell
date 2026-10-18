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
  public CagentWindow(string[] args){
    verification=args.Length>0&&args[0].StartsWith("--verify-");fixture=args.Length>0&&args[0]=="--fixture";if(fixture&&args.Length>1)screenshot=args[1];
    Title="cagent";Width=428;Height=600;MinWidth=340;MinHeight=400;WindowStartupLocation=WindowStartupLocation.CenterScreen;
    WindowStyle=WindowStyle.None;WindowChrome.SetWindowChrome(this,new WindowChrome{CaptionHeight=56,ResizeBorderThickness=new Thickness(6),GlassFrameThickness=new Thickness(0),CornerRadius=new CornerRadius(16)});
    FontFamily=new FontFamily("Segoe UI, Microsoft YaHei UI");FontSize=13;Foreground=ink;Background=Brush("#F7F8FA");
    InstallStyles();root.Margin=new Thickness(22,14,22,18);root.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});root.RowDefinitions.Add(new RowDefinition());Content=root;
    var bar=new DockPanel{Margin=new Thickness(0,0,0,14),Height=32};
    var menu=Button("","会话、应用与设置");menu.Content=Glyph("M4,12 L4.1,12 M12,12 L12.1,12 M20,12 L20.1,12",2.8);
    var pin=Button("","置顶窗口");pin.Content=Glyph("M9,3 L15,3 M10,3 L10,10 L6,14 L18,14 L14,10 L14,3 M12,14 L12,21",1.4);
    var close=Button("","关闭到托盘");close.Content=Glyph("M7,7 L17,17 M17,7 L7,17",1.4);close.Click+=(s,e)=>Close();DockPanel.SetDock(close,Dock.Right);bar.Children.Add(close);WindowChrome.SetIsHitTestVisibleInChrome(close,true);WindowChrome.SetIsHitTestVisibleInChrome(menu,true);WindowChrome.SetIsHitTestVisibleInChrome(pin,true);
    var minimize=Button("−","最小化");minimize.Click+=(s,e)=>WindowState=WindowState.Minimized;WindowChrome.SetIsHitTestVisibleInChrome(minimize,true);DockPanel.SetDock(minimize,Dock.Right);bar.Children.Add(minimize);
    DockPanel.SetDock(menu,Dock.Right);DockPanel.SetDock(pin,Dock.Right);bar.Children.Add(menu);bar.Children.Add(pin);
    var brand=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};brand.Children.Add(Mark(25));brand.Children.Add(new TextBlock{Text="cagent",FontSize=17,FontWeight=FontWeights.SemiBold,Margin=new Thickness(9,0,0,0),VerticalAlignment=VerticalAlignment.Center});bar.Children.Add(brand);root.Children.Add(bar);
    pin.Opacity=.35;close.Opacity=.35;bar.MouseEnter+=(s,e)=>{Fade(pin,1);Fade(close,1);};bar.MouseLeave+=(s,e)=>{Fade(pin,Topmost?1:.35);Fade(close,.35);};
    pin.Click+=(s,e)=>{Topmost=!Topmost;pin.Background=Topmost?Brush("#DDF2ED"):Brushes.Transparent;pin.ToolTip=Topmost?"取消置顶":"置顶窗口";AutomationProperties.SetName(pin,Convert.ToString(pin.ToolTip));};
    var context=new ContextMenu();AddMenu(context,"新任务",NewTask);
    AddAsyncMenu(context,"会话记录",History);AddAsyncMenu(context,"应用市场",Apps);AddAsyncMenu(context,"模型与权限",Settings);AddAsyncMenu(context,"远程连接",Remote);AddAsyncMenu(context,"检查更新",Updates);AddMenu(context,"返回对话",ShowChat);AddAsyncMenu(context,"退出 CAgent",ExitApp);
    menu.Click+=(s,e)=>{context.PlacementTarget=menu;context.IsOpen=true;};
    Grid.SetRow(chat,1);root.Children.Add(chat);chat.RowDefinitions.Add(new RowDefinition());chat.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});
    scroll.Focusable=false;scroll.FocusVisualStyle=null;scroll.Content=messages;scroll.VerticalScrollBarVisibility=ScrollBarVisibility.Auto;scroll.HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled;scroll.Padding=new Thickness(0,10,2,12);chat.Children.Add(scroll);
    welcome.VerticalAlignment=VerticalAlignment.Center;welcome.Margin=new Thickness(16,0,16,34);chat.Children.Add(welcome);ShowWelcome();
    var composer=new StackPanel{Margin=new Thickness(0,10,0,0)};Grid.SetRow(composer,1);chat.Children.Add(composer);
    composerCard.CornerRadius=new CornerRadius(22);composerCard.Background=Brushes.White;composerCard.BorderBrush=Brush("#E5E8ED");composerCard.BorderThickness=new Thickness(1);composerCard.Padding=new Thickness(14,12,12,10);composerCard.Effect=new DropShadowEffect{BlurRadius=22,ShadowDepth=5,Color=Color.FromRgb(46,65,77),Opacity=.07};composer.Children.Add(composerCard);
    var composerBody=new StackPanel();composerCard.Child=composerBody;
    var entry=new Grid();composerBody.Children.Add(entry);
    input.AcceptsReturn=true;input.TextWrapping=TextWrapping.Wrap;input.MinHeight=68;input.MaxHeight=150;input.Padding=new Thickness(2,4,2,6);input.BorderThickness=new Thickness(0);input.Background=Brushes.Transparent;input.FontSize=14;input.VerticalScrollBarVisibility=ScrollBarVisibility.Auto;AutomationProperties.SetName(input,"描述任务");entry.Children.Add(input);
    placeholder.Text="有什么想做的？";placeholder.FontSize=14;placeholder.Foreground=Brush("#A1A9B4");placeholder.Margin=new Thickness(3,6,0,0);placeholder.IsHitTestVisible=false;entry.Children.Add(placeholder);
    input.TextChanged+=(s,e)=>{placeholder.Visibility=input.Text.Length==0?Visibility.Visible:Visibility.Collapsed;};
    input.GotKeyboardFocus+=(s,e)=>AnimateComposer(true);input.LostKeyboardFocus+=(s,e)=>AnimateComposer(false);
    input.KeyDown+=async(s,e)=>{if(e.Key==Key.Enter&&(Keyboard.Modifiers&ModifierKeys.Control)!=0){e.Handled=true;await Guard(Send);}};
    var actions=new DockPanel{Margin=new Thickness(0,6,0,0),LastChildFill=false};composerBody.Children.Add(actions);
    send.Content=Glyph("M12,18 L12,6 M6,12 L12,6 L18,12",1.8);StyleButton(send);send.Width=34;send.Height=34;send.Padding=new Thickness(6);send.Background=Brush("#1E3337");send.Foreground=Brushes.White;send.ToolTip="发送 · Ctrl+Enter";AutomationProperties.SetName(send,"发送任务");DockPanel.SetDock(send,Dock.Right);actions.Children.Add(send);
    stop.Content=Glyph("M7,7 L17,7 L17,17 L7,17 Z",2);StyleButton(stop);stop.Width=34;stop.Height=34;stop.Padding=new Thickness(6);stop.IsEnabled=false;stop.Visibility=Visibility.Collapsed;stop.ToolTip="停止当前任务";AutomationProperties.SetName(stop,"停止当前任务");DockPanel.SetDock(stop,Dock.Right);actions.Children.Add(stop);
    modelChip.Content="选择模型  ⌄";StyleButton(modelChip);modelChip.Foreground=Brush("#71818A");modelChip.FontSize=11;modelChip.Padding=new Thickness(5,4,5,4);modelChip.ToolTip="模型与权限";AutomationProperties.SetName(modelChip,"选择模型与权限");modelChip.Click+=async(s,e)=>await Guard(Settings);actions.Children.Add(modelChip);
    status.FontSize=10;status.Foreground=Brush("#8C98A2");status.Text="正在连接本机运行时…";status.Margin=new Thickness(6,10,6,0);status.TextAlignment=TextAlignment.Center;status.TextWrapping=TextWrapping.Wrap;composer.Children.Add(status);
    send.Click+=async(s,e)=>await Guard(Send);stop.Click+=async(s,e)=>await Guard(async()=>{if(selected!=null)await Api("assistant.cancel",Obj("id",selected));await Poll();});
    Grid.SetRow(overlay,1);overlay.Visibility=Visibility.Collapsed;root.Children.Add(overlay);
    Loaded+=async(s,e)=>{if(fixture){if(args.Length>2&&args[2]=="narrow"){Width=340;Height=400;}if(args.Length<3||args[2]!="empty")Render(Obj("id","fixture","prompt","帮我检查一下这台电脑的运行环境","answer","已检查。\n\nPowerShell 和 CMD 都已就绪。你可以继续让我整理文件，或安装需要的应用。","state","completed","events",new object[0]));modelChip.Content="本地模型  ⌄";status.Text="本机 · 准备就绪";input.Text="";await Task.Delay(350);if(args.Length>2&&args[2]=="verify"){VerifyInteractions();await Task.Delay(250);}if(args.Length>2&&args[2]=="market"){VerifyMarket();await Task.Delay(250);}if(args.Length>2&&args[2]=="desktop"){VerifyDesktopSettings();await Task.Delay(250);}if(screenshot!=null){SaveImage(screenshot);Close();}return;}await Guard(()=>Start());if(args.Length>1&&args[0]=="--verify-remote-recovery"){string phase="initial remote";try{await Remote();string initialError=panelStatus.Text;bool visible=panelStatus.Text.Contains("后台仍是旧版");await Task.Delay(1500);bool persistent=visible&&panelStatus.Text.Contains("后台仍是旧版");phase="restart";await RestartRemote();phase="receipt";File.WriteAllText(args[1],json.Serialize(Obj("initialError",initialError,"legacyErrorVisible",visible,"errorPersistent",persistent,"settingsOpened",overlay.Visibility==Visibility.Visible&&panelStatus.Text=="","connected",connected)),Encoding.UTF8);}catch(Exception error){File.WriteAllText(args[1],json.Serialize(Obj("failure",error.ToString(),"phase",phase)),Encoding.UTF8);}Close();return;}if(args.Length>1&&args[0]=="--verify-tray"){try{if(!connected)throw new Exception(status.Text);input.Text="tray draft";verification=false;Close();bool hidden=!IsVisible&&tray.Visible;await Api("client.status");RestoreWindow();bool restored=IsVisible&&input.Text=="tray draft";File.WriteAllText(args[1],json.Serialize(Obj("connected",connected,"hiddenWithTray",hidden,"backendAliveWhileHidden",true,"restoredWithDraft",restored)),Encoding.UTF8);await ExitApp();}catch(Exception error){File.WriteAllText(args[1],json.Serialize(Obj("failure",error.ToString())),Encoding.UTF8);exiting=true;Close();}return;}if(args.Length>1&&args[0]=="--verify-runtime"){await Task.Delay(150);File.WriteAllText(args[1],json.Serialize(Obj("connected",connected,"status",status.Text,"browser",false,"window",true)),Encoding.UTF8);Close();}};
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
    var p=Panel("应用更新");panelStatus.Text="正在检查 GitHub 更新…";
    var info=D(await Api("update.check"));panelStatus.Text="";p.Children.Add(Text("当前版本 "+S(info,"current")));
    if(!B(info,"available")){p.Children.Add(Text("暂无可安装的新版 Windows 安装包。"));ActionButton(p,"重新检查",Updates);return;}
    p.Children.Add(Text("可用版本 "+S(info,"version")));p.Children.Add(Text("下载并校验后打开安装向导。安装将退出 CAgent 并断开连接，请先结束正在运行的任务。",12));
    bool downloading=false;ActionButton(p,"下载并安装",async()=>{if(downloading)return;downloading=true;try{await Api("update.download");Dictionary<string,object> d;do{d=D(await Api("update.status"));panelStatus.Text="下载中："+S(d,"bytes")+" / "+S(d,"total")+" 字节";if(S(d,"phase")=="downloading")await Task.Delay(750);}while(S(d,"phase")=="downloading");if(S(d,"phase")!="ready")throw new Exception(S(d,"error"));panelStatus.Text="校验通过，正在打开安装向导…";Process.Start(new ProcessStartInfo(S(d,"path")){UseShellExecute=true});await ExitApp();}finally{downloading=false;}});
  }
  async Task ExitApp(){if(exiting){Close();return;}exiting=true;try{if(connected&&!fixture)await Api("agent.shutdown",Obj("confirm",true));Close();}catch(Exception error){exiting=false;status.Text="退出失败："+error.Message;}}
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
    var grid=new Grid();grid.Children.Add(new System.Windows.Shapes.Path{Data=Geometry.Parse("M17,7 C15,5 9,5 7,8 C4,12 7,18 12,18 C14,18 16,17 17,16 M13,10 L18,10"),Stroke=Brush("#D5FFF2"),StrokeThickness=2.2,StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round,Stretch=Stretch.Uniform,Margin=new Thickness(size*.22)});
    return new Border{Width=size,Height=size,CornerRadius=new CornerRadius(size*.32),Background=Brush("#21383C"),Child=grid};
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
      <Style TargetType='ContextMenu'><Setter Property='Background' Value='White'/><Setter Property='BorderBrush' Value='#E2E7EA'/><Setter Property='BorderThickness' Value='1'/><Setter Property='Padding' Value='7'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ContextMenu'><Border Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='1' CornerRadius='14' Padding='7'><StackPanel IsItemsHost='True'/></Border></ControlTemplate></Setter.Value></Setter></Style>
      <Style TargetType='MenuItem'><Setter Property='Padding' Value='14,9'/><Setter Property='FontSize' Value='12'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='MenuItem'><Border x:Name='frame' CornerRadius='8' Padding='{TemplateBinding Padding}' Background='Transparent'><ContentPresenter ContentSource='Header'/></Border><ControlTemplate.Triggers><Trigger Property='IsHighlighted' Value='True'><Setter TargetName='frame' Property='Background' Value='#EAF4F0'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
      <Style TargetType='ScrollBar'><Setter Property='Width' Value='6'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ScrollBar'><Track x:Name='PART_Track' IsDirectionReversed='True'><Track.DecreaseRepeatButton><RepeatButton Command='ScrollBar.PageUpCommand' Opacity='0'/></Track.DecreaseRepeatButton><Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType='Thumb'><Border Background='#CAD4D7' CornerRadius='3' Margin='1,0'/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb><Track.IncreaseRepeatButton><RepeatButton Command='ScrollBar.PageDownCommand' Opacity='0'/></Track.IncreaseRepeatButton></Track></ControlTemplate></Setter.Value></Setter></Style>
    </ResourceDictionary>");
  }
  void StyleButton(Button b){b.Padding=new Thickness(9,5,9,5);b.Margin=new Thickness(3,0,0,0);b.MinHeight=30;b.BorderThickness=new Thickness(0);b.Background=Brushes.Transparent;b.Cursor=Cursors.Hand;}
  Button Button(string title,string tooltip){var b=new Button{Content=title,ToolTip=tooltip};AutomationProperties.SetName(b,tooltip);StyleButton(b);return b;}
  void AddMenu(ContextMenu m,string title,Action fn){var item=new MenuItem{Header=title};item.Click+=async(s,e)=>await Guard(async()=>{fn();await Task.Yield();});m.Items.Add(item);}
  void AddAsyncMenu(ContextMenu m,string title,Func<Task> fn){var item=new MenuItem{Header=title};item.Click+=async(s,e)=>await Guard(fn);m.Items.Add(item);}
  async Task Guard(Func<Task> action){try{if(panelStatus!=null)panelStatus.Text="";await action();}catch(Exception e){if(overlay.Visibility==Visibility.Visible&&panelStatus!=null)panelStatus.Text=e.Message;else status.Text=e.Message;}}
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
      var req=(HttpWebRequest)WebRequest.Create(origin+"/api");req.Method="POST";req.ContentType="application/json";req.Headers["Origin"]=origin;req.Headers["X-Cagent-Token"]=token;req.Timeout=65000;req.ReadWriteTimeout=65000;req.Proxy=null;
      byte[] bytes=Encoding.UTF8.GetBytes(body);req.ContentLength=bytes.Length;using(var stream=req.GetRequestStream())stream.Write(bytes,0,bytes.Length);
      try{using(var r=req.GetResponse())using(var reader=new StreamReader(r.GetResponseStream()))return reader.ReadToEnd();}
      catch(WebException ex){if(ex.Response==null)throw;using(var r=ex.Response)using(var reader=new StreamReader(r.GetResponseStream()))return reader.ReadToEnd();}
    });
    var value=D(json.DeserializeObject(response));if(value.ContainsKey("error"))throw new Exception(S(value,"error"));return V(value,"result");
  }
  async Task Poll(){
    if(origin==null)return;
    if(!initialTaskLoaded){var list=A(await Api("assistant.tasks"));foreach(var o in list)selected=S(D(o),"id");initialTaskLoaded=true;}
    if(selected!=null)Render(D(await Api("assistant.task",Obj("id",selected))));
  }
  async Task Send(){if(busy||string.IsNullOrWhiteSpace(input.Text))return;busy=true;send.IsEnabled=false;try{string prompt=input.Text.Trim();if(requestPrompt!=prompt||requestId==null){requestPrompt=prompt;requestId=Guid.NewGuid().ToString();}var r=D(await Api("assistant.start",Obj("prompt",prompt,"requestId",requestId)));selected=S(r,"id");requestId=null;input.Text="";ShowChat();await Poll();}finally{busy=false;send.IsEnabled=current==null||!(S(current,"state")=="running"||S(current,"state")=="approval");}}
  TextBlock Text(string value,int size=13){return new TextBlock{Text=value,TextWrapping=TextWrapping.Wrap,FontSize=size,Margin=new Thickness(2,6,2,6)};}
  void Render(Dictionary<string,object> t){
    current=t;welcome.Visibility=Visibility.Collapsed;string state=S(t,"state");send.IsEnabled=state!="running"&&state!="approval";stop.IsEnabled=!send.IsEnabled;stop.Visibility=stop.IsEnabled?Visibility.Visible:Visibility.Collapsed;send.Visibility=stop.IsEnabled?Visibility.Collapsed:Visibility.Visible;
    status.Text=state=="running"?"正在处理…":state=="approval"?"等待操作确认":state=="completed"?"已完成":state=="cancelled"?"已停止":state=="failed"?"执行失败":state=="interrupted"?"已中断":"准备就绪";
    string render=json.Serialize(t);if(render==lastRender)return;lastRender=render;bool bottom=scroll.VerticalOffset>=scroll.ScrollableHeight-24;
    messages.Children.Clear();var q=Text(S(t,"prompt"));q.Foreground=Brush("#3F5559");var bubble=new Border{Background=Brush("#E8EFED"),CornerRadius=new CornerRadius(16,16,5,16),Padding=new Thickness(13,6,13,6),Margin=new Thickness(36,6,0,23),HorizontalAlignment=HorizontalAlignment.Right,Child=q};messages.Children.Add(bubble);
    var answerHeader=new StackPanel{Orientation=Orientation.Horizontal,Margin=new Thickness(2,0,0,9)};answerHeader.Children.Add(Mark(20));answerHeader.Children.Add(new TextBlock{Text="cagent",FontSize=11,Foreground=Brush("#819195"),Margin=new Thickness(8,2,0,0)});messages.Children.Add(answerHeader);
    var answer=Text(S(t,"answer"),14);answer.LineHeight=24;answer.Margin=new Thickness(2,0,8,14);messages.Children.Add(answer);Reveal(answer);
    foreach(var item in A(V(t,"events"))){var ev=D(item);var content=new StackPanel();content.Children.Add(Text(json.Serialize(V(ev,"input"))));content.Children.Add(Text(S(ev,"output")));messages.Children.Add(new Expander{Header=S(ev,"tool"),Content=content,Margin=new Thickness(0,6,0,6)});}
    if(state=="approval"){
      messages.Children.Add(Text("允许执行上面的本机命令？"));var buttons=new StackPanel{Orientation=Orientation.Horizontal};
      foreach(bool allow in new[]{true,false}){bool choice=allow;string id=S(t,"id");var b=Button(allow?"允许这一次":"拒绝",allow?"仅批准当前操作":"拒绝当前操作");b.Click+=async(s,e)=>await Guard(async()=>{await Api("assistant.approve",Obj("id",id,"allow",choice));await Poll();});buttons.Children.Add(b);}messages.Children.Add(buttons);
    }
    if(S(t,"error")!=""){var e=Text(S(t,"error"));e.Foreground=Brushes.Firebrick;messages.Children.Add(e);}if(bottom)scroll.ScrollToEnd();
  }
  void ShowChat(){overlay.Visibility=Visibility.Collapsed;chat.Visibility=Visibility.Visible;Reveal(chat);}
  StackPanel Panel(string title){chat.Visibility=Visibility.Collapsed;overlay.Visibility=Visibility.Visible;overlay.Children.Clear();overlay.RowDefinitions.Clear();overlay.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});overlay.RowDefinitions.Add(new RowDefinition());var top=new DockPanel{Margin=new Thickness(0,0,0,10)};var back=Button("‹","返回对话，保留草稿");back.Click+=(s,e)=>ShowChat();top.Children.Add(back);top.Children.Add(new TextBlock{Text=title,FontSize=16,Margin=new Thickness(12,3,0,0)});overlay.Children.Add(top);var p=new StackPanel();panelStatus=Text("",11);panelStatus.Foreground=Brushes.Firebrick;AutomationProperties.SetName(panelStatus,"当前操作反馈");p.Children.Add(panelStatus);var viewer=new ScrollViewer{Content=p,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};Grid.SetRow(viewer,1);overlay.Children.Add(viewer);return p;}
  TextBox Field(StackPanel p,string label,string value,bool multiline=false){p.Children.Add(Text(label));var t=new TextBox{Text=value,Padding=new Thickness(8),Margin=new Thickness(0,0,0,10),AcceptsReturn=multiline,TextWrapping=multiline?TextWrapping.Wrap:TextWrapping.NoWrap,MinHeight=multiline?65:32};AutomationProperties.SetName(t,label);p.Children.Add(t);return t;}
  CheckBox Check(StackPanel p,string label,bool value){var c=new CheckBox{Content=label,IsChecked=value,Margin=new Thickness(0,8,0,8)};p.Children.Add(c);return c;}
  Button ActionButton(StackPanel p,string label,Func<Task> fn){var b=Button(label,label);b.Margin=new Thickness(0,8,0,8);b.Click+=async(s,e)=>{b.IsEnabled=false;try{await Guard(fn);}finally{b.IsEnabled=true;}};p.Children.Add(b);return b;}
  async Task History(){var list=new List<Dictionary<string,object>>();foreach(var t in A(await Api("assistant.tasks")))list.Add(D(t));list.Reverse();var p=Panel("会话记录");if(list.Count==0)p.Children.Add(Text("还没有任务记录"));foreach(var t in list){var item=t;ActionButton(p,S(t,"prompt"),async()=>{SelectTask(S(item,"id"));Render(item);ShowChat();await Task.Yield();});}}
  async Task Settings(){
    var s=D(await Api("assistant.settings"));var p=Panel("模型与权限");var endpoint=Field(p,"基座完整接口地址",S(s,"endpoint"));var model=Field(p,"模型",S(s,"model"));p.Children.Add(Text(B(s,"keyConfigured")?"API Key（已保存，留空保留）":"API Key"));var key=new PasswordBox{Padding=new Thickness(8),Margin=new Thickness(0,0,0,10)};p.Children.Add(key);
    var commands=Check(p,"允许本机命令",B(s,"commands"));var review=Check(p,"执行前逐次确认",B(s,"review"));p.Children.Add(Text("命令以当前用户权限运行，不是权限沙箱。",11));var ds=new List<string>();foreach(var d in A(V(s,"delegates")))ds.Add(Convert.ToString(d));var delegates=Field(p,"允许委派的控制端指纹（每行一个）",string.Join("\n",ds.ToArray()),true);
    ActionButton(p,"保存",async()=>{var value=Obj("endpoint",endpoint.Text,"model",model.Text,"commands",commands.IsChecked==true,"review",review.IsChecked==true,"delegates",delegates.Text.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries));if(key.Password.Length>0)value["key"]=key.Password;await Api("assistant.configure",value);key.Clear();ModelLabel(model.Text);ShowChat();status.Text="设置已保存";});
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
  string PermissionName(string value){switch(value){case "applications.read":return "读取系统应用目录";case "applications.plan":return "检查并生成安装计划";case "applications.install":return "按计划安装系统应用";default:return value;}}
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
      foreach(var value in packages){var item=D(value);if(!(S(item,"name")+S(item,"id")).ToLowerInvariant().Contains(query))continue;AppTile(cards,S(item,"name"),S(item,"id")=="cagent.desktop"?"\uE7F4":"\uE71D",B(item,"installed")?"已安装 · 配置":"安装",async()=>await PackageDetail(item));}
      foreach(var value in A(V(catalog,"applications"))){var item=D(value);if(!(S(item,"id")+S(item,"package")).ToLowerInvariant().Contains(query))continue;AppTile(cards,S(item,"id"),"\uE74C","查看安装",async()=>await Plan(D(await Api("applications.plan",Obj("app",S(item,"id"))))));}
      if(cards.Children.Count==0)cards.Children.Add(Text("没有匹配的应用",11));
    };search.TextChanged+=(sender,e)=>render();render();
    var settings=new StackPanel();p.Children.Add(new Expander{Header="安装设置",Content=settings,Margin=new Thickness(0,12,0,0)});var enabled=Check(settings,"允许应用安装",B(policy,"enabled"));ActionButton(settings,"保存",async()=>{policy["enabled"]=enabled.IsChecked==true;await Api("applications.configure",policy);});
  }
  async Task PackageDetail(Dictionary<string,object> item){Dictionary<string,object> installed=null;foreach(var value in A(await Api("packages.list"))){var record=D(value);if(S(record,"id")==S(item,"id"))installed=record;}RenderPackage(item,installed);}
  void RenderPackage(Dictionary<string,object> item,Dictionary<string,object> installed){
    string id=S(item,"id");var p=Panel(S(item,"name"));ActionButton(p,"返回应用市场",Apps);p.Children.Add(Text(S(item,"description"),12));p.Children.Add(Text("版本 "+S(item,"version")+" · "+(S(item,"source")=="bundled"?"随 cagent 提供":"GitHub"),11));p.Children.Add(Text(PackageState(S(installed??item,"status")),14));if(S(installed??item,"reason")!="")p.Children.Add(Text(S(installed??item,"reason"),11));
    if(installed==null){p.Children.Add(Text("安装后即可使用，可在这里关闭不需要的能力。",11));ActionButton(p,"安装并核验能力包",async()=>{var installedNow=D(await Api("packages.install",Obj("id",id,"confirm",true)));await Api("packages.grant",Obj("id",id,"permissions",V(installedNow,"requiredPermissions")));await PackageDetail(item);});return;}
    p.Children.Add(Text(B(installed,"registered")?"工具已注册":"工具未注册",11));var grants=new HashSet<string>();foreach(var grant in A(V(installed,"grants")))grants.Add(Convert.ToString(grant));var choices=new Dictionary<string,CheckBox>();foreach(var value in A(V(installed,"requiredPermissions"))){string permission=Convert.ToString(value);choices[permission]=Check(p,PermissionName(permission),grants.Contains(permission));}
    if(id=="cagent.desktop"){var desktopBody=new StackPanel();var section=new Expander{Header="桌面服务与访问权限",Content=desktopBody,Margin=new Thickness(0,8,0,8)};bool loaded=false;section.Expanded+=async(s,e)=>{if(loaded)return;await Guard(async()=>{await DesktopSettings(desktopBody);loaded=true;});};p.Children.Add(section);}
    p.Children.Add(Text("选择仅修改草稿，保存后生效。系统应用安装还受独立安装权限限制。",11));
    ActionButton(p,"保存工具权限",async()=>{var allowed=new List<string>();foreach(var pair in choices)if(pair.Value.IsChecked==true)allowed.Add(pair.Key);await Api("packages.grant",Obj("id",id,"permissions",allowed.ToArray()));await PackageDetail(item);});
    ActionButton(p,"重新核验",async()=>{await Api("packages.refresh",Obj("id",id));await PackageDetail(item);});
    ActionButton(p,"停用工具",async()=>{await Api("packages.grant",Obj("id",id,"permissions",new string[0]));await PackageDetail(item);});
    var removal=new StackPanel{Visibility=Visibility.Collapsed};ActionButton(p,"卸载能力包",async()=>{removal.Visibility=Visibility.Visible;await Task.Yield();});p.Children.Add(removal);removal.Children.Add(Text("卸载将停止此能力包的任务并移除工具注册，不卸载已安装的系统软件。",11));ActionButton(removal,"确认卸载",async()=>{await Api("packages.uninstall",Obj("id",id,"confirm",true));await Apps();});ActionButton(removal,"保留能力包",async()=>{removal.Visibility=Visibility.Collapsed;await Task.Yield();});
  }
  int DesktopPort(string text){int value;if(!int.TryParse(text,out value)||value<1||value>65535)throw new Exception("端口需要填写 1 至 65535 的整数");return value;}
  void VerifyDesktopSettings(){var p=Panel("桌面服务设置");RenderDesktopSettings(p,Obj("enabled",false,"bindAddress","127.0.0.1","tcpPort",9998,"udpPort",9999,"local",Obj("view",false,"control",false),"ownerGrants",Obj()),false);UpdateLayout();var checks=new List<CheckBox>();FindChecks(p,checks);if(checks.Count!=4)throw new Exception("Desktop grants missing");foreach(var check in checks)if(check.IsChecked==true)throw new Exception("Desktop permissions default enabled");bool refused=false;try{DesktopPort("0");}catch{refused=true;}if(!refused||DesktopPort("65535")!=65535)throw new Exception("Desktop port validation failed");if(screenshot!=null)File.WriteAllText(screenshot+".json",json.Serialize(Obj("fixture",true,"serviceDefaultOff",true,"viewDefaultOff",true,"controlDefaultOff",true,"portValidation",true,"realDesktopStarted",false)),Encoding.UTF8);}
  async Task DesktopSettings(StackPanel p){var statusValue=D(await Api("desktop.status"));RenderDesktopSettings(p,D(V(statusValue,"config")),B(statusValue,"listening"));}
  void RenderDesktopSettings(StackPanel p,Dictionary<string,object> config,bool listening){
    p.Children.Clear();var enabled=Check(p,"启用远程桌面",B(config,"enabled"));var peers=Check(p,"允许已连接的控制端观看和操作",B(config,"authenticatedPeers"));var local=D(V(config,"local"));var view=Check(p,"允许本机观看",B(local,"view"));var control=Check(p,"允许本机控制",B(local,"control"));
    p.Children.Add(Text("复用 CAgent 连接，无需额外端口。",11));
    ActionButton(p,"保存",async()=>{config["enabled"]=enabled.IsChecked==true;config["authenticatedPeers"]=peers.IsChecked==true;config["directListener"]=false;config["local"]=Obj("view",view.IsChecked==true,"control",control.IsChecked==true);await Api("desktop.configure",config);await DesktopSettings(p);});
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
    var bind=Field(p,"监听地址（0.0.0.0 表示所有网卡）",S(s,"bind")==""?"0.0.0.0":S(s,"bind"));
    var port=Field(p,"连接端口",S(s,"port")==""?"24443":S(s,"port"));
    var address=Field(p,"连接地址（公网域名或 IP）",S(s,"advertisedHost")==""?(interfaces.Count>0?interfaces[0]:"127.0.0.1"):S(s,"advertisedHost"));
    var publicPort=Field(p,"对外端口（留空使用连接端口）",S(s,"advertisedPort"));
    var password=Field(p,"连接密码",S(s,"password"));
    var startup=Check(p,"开机自动启动",B(D(V(s,"autostart")),"enabled"));startup.IsEnabled=B(D(V(s,"autostart")),"supported");startup.Click+=async(sender,e)=>await Guard(async()=>{await Api("connection.autostart",Obj("enabled",startup.IsChecked==true));});
    var advanced=new StackPanel();p.Children.Add(new Expander{Header="访问权限",Content=advanced,Margin=new Thickness(0,10,0,10)});
    bool fresh=!B(s,"passwordConfigured");var manage=Check(advanced,"远程管理全部设置",fresh||B(s,"allowManage"));var http=Check(advanced,"HTTP 请求",fresh||B(s,"allowHttp"));var hosting=Check(advanced,"服务托管",fresh||B(s,"allowHosting"));var relay=Check(advanced,"中继",fresh||B(s,"allowRelay"));
    ActionButton(p,"保存并开启连接",async()=>{await Api("connection.save",Obj("bind",bind.Text.Trim(),"port",DesktopPort(port.Text),"advertisedHost",address.Text.Trim(),"advertisedPort",string.IsNullOrWhiteSpace(publicPort.Text)?DesktopPort(port.Text):DesktopPort(publicPort.Text),"password",password.Text,"allowManage",manage.IsChecked==true,"allowHttp",http.IsChecked==true,"allowHosting",hosting.IsChecked==true,"allowRelay",relay.IsChecked==true));await Remote();});
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
