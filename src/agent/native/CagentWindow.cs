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
  Process host; string origin,token,selected,lastRender="",requestId,requestPrompt; bool polling,busy,fixture,connected;
  Dictionary<string,object> current; DispatcherTimer timer; string screenshot;
  readonly Dictionary<string,string> drafts=new Dictionary<string,string>();bool initialTaskLoaded;
  TextBlock panelStatus;
  public CagentWindow(string[] args){
    fixture=args.Length>0&&args[0]=="--fixture";if(fixture&&args.Length>1)screenshot=args[1];
    Title="cagent";Width=428;Height=600;MinWidth=340;MinHeight=400;WindowStartupLocation=WindowStartupLocation.CenterScreen;
    WindowStyle=WindowStyle.None;WindowChrome.SetWindowChrome(this,new WindowChrome{CaptionHeight=56,ResizeBorderThickness=new Thickness(6),GlassFrameThickness=new Thickness(0),CornerRadius=new CornerRadius(16)});
    FontFamily=new FontFamily("Segoe UI, Microsoft YaHei UI");FontSize=13;Foreground=ink;Background=Brush("#F7F8FA");
    InstallStyles();root.Margin=new Thickness(22,14,22,18);root.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});root.RowDefinitions.Add(new RowDefinition());Content=root;
    var bar=new DockPanel{Margin=new Thickness(0,0,0,14),Height=32};
    var menu=Button("","会话、应用与设置");menu.Content=Glyph("M4,12 L4.1,12 M12,12 L12.1,12 M20,12 L20.1,12",2.8);
    var pin=Button("","置顶窗口");pin.Content=Glyph("M9,3 L15,3 M10,3 L10,10 L6,14 L18,14 L14,10 L14,3 M12,14 L12,21",1.4);
    var close=Button("","关闭窗口（后台任务继续运行）");close.Content=Glyph("M7,7 L17,17 M17,7 L7,17",1.4);close.Click+=(s,e)=>Close();DockPanel.SetDock(close,Dock.Right);bar.Children.Add(close);WindowChrome.SetIsHitTestVisibleInChrome(close,true);WindowChrome.SetIsHitTestVisibleInChrome(menu,true);WindowChrome.SetIsHitTestVisibleInChrome(pin,true);
    DockPanel.SetDock(menu,Dock.Right);DockPanel.SetDock(pin,Dock.Right);bar.Children.Add(menu);bar.Children.Add(pin);
    var brand=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};brand.Children.Add(Mark(25));brand.Children.Add(new TextBlock{Text="cagent",FontSize=17,FontWeight=FontWeights.SemiBold,Margin=new Thickness(9,0,0,0),VerticalAlignment=VerticalAlignment.Center});bar.Children.Add(brand);root.Children.Add(bar);
    pin.Opacity=.35;close.Opacity=.35;bar.MouseEnter+=(s,e)=>{Fade(pin,1);Fade(close,1);};bar.MouseLeave+=(s,e)=>{Fade(pin,Topmost?1:.35);Fade(close,.35);};
    pin.Click+=(s,e)=>{Topmost=!Topmost;pin.Background=Topmost?Brush("#DDF2ED"):Brushes.Transparent;pin.ToolTip=Topmost?"取消置顶":"置顶窗口";AutomationProperties.SetName(pin,Convert.ToString(pin.ToolTip));};
    var context=new ContextMenu();AddMenu(context,"新任务",NewTask);
    AddAsyncMenu(context,"会话记录",History);AddAsyncMenu(context,"应用市场",Apps);AddAsyncMenu(context,"模型与权限",Settings);AddAsyncMenu(context,"远程连接",Remote);AddMenu(context,"返回对话",ShowChat);
    menu.Click+=(s,e)=>{context.PlacementTarget=menu;context.IsOpen=true;};
    Grid.SetRow(chat,1);root.Children.Add(chat);chat.RowDefinitions.Add(new RowDefinition());chat.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});
    scroll.Content=messages;scroll.VerticalScrollBarVisibility=ScrollBarVisibility.Auto;scroll.HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled;scroll.Padding=new Thickness(0,10,2,12);chat.Children.Add(scroll);
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
    Loaded+=async(s,e)=>{if(fixture){if(args.Length>2&&args[2]=="narrow"){Width=340;Height=400;}if(args.Length<3||args[2]!="empty")Render(Obj("id","fixture","prompt","帮我检查一下这台电脑的运行环境","answer","已检查。\n\nPowerShell 和 CMD 都已就绪。你可以继续让我整理文件，或安装需要的应用。","state","completed","events",new object[0]));modelChip.Content="本地模型  ⌄";status.Text="本机 · 准备就绪";input.Text="";await Task.Delay(350);if(args.Length>2&&args[2]=="verify"){VerifyInteractions();await Task.Delay(250);}if(args.Length>2&&args[2]=="market"){VerifyMarket();await Task.Delay(250);}if(args.Length>2&&args[2]=="desktop"){VerifyDesktopSettings();await Task.Delay(250);}if(screenshot!=null){SaveImage(screenshot);Close();}return;}await Guard(Start);if(args.Length>1&&args[0]=="--verify-runtime"){await Task.Delay(150);File.WriteAllText(args[1],json.Serialize(Obj("connected",connected,"status",status.Text,"browser",false,"window",true)),Encoding.UTF8);Close();}};
    Closing+=(s,e)=>{if(timer!=null)timer.Stop();try{if(host!=null&&!host.HasExited)host.StandardInput.Close();}catch{};};
    PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Escape&&overlay.Visibility==Visibility.Visible){e.Handled=true;ShowChat();input.Focus();}if(e.Key==Key.N&&(Keyboard.Modifiers&ModifierKeys.Control)!=0){e.Handled=true;NewTask();input.Focus();}};
  }
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
  async Task Start(){
    string dir=AppDomain.CurrentDomain.BaseDirectory;
    var start=new ProcessStartInfo(Path.Combine(dir,"node.exe"),"\""+Path.Combine(dir,"agent.cjs")+"\" app-host"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardInput=true,RedirectStandardError=true};
    host=Process.Start(start);host.ErrorDataReceived+=(s,e)=>{};host.BeginErrorReadLine();
    var line=host.StandardOutput.ReadLineAsync();if(await Task.WhenAny(line,Task.Delay(30000))!=line)throw new Exception("本机运行时启动超时");
    var result=D(json.DeserializeObject(await line??"{}"));string url=S(result,"url");Uri u;
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
    if(screenshot!=null)File.WriteAllText(screenshot+".json",json.Serialize(Obj("fixture",true,"marketOverlay",true,"chatDraftPreserved",true,"installedWithoutGrants","待授权","realSoftwareInstalled",false)),Encoding.UTF8);
  }
  void FindChecks(DependencyObject parent,List<CheckBox> result){var check=parent as CheckBox;if(check!=null)result.Add(check);for(int i=0;i<VisualTreeHelper.GetChildrenCount(parent);i++)FindChecks(VisualTreeHelper.GetChild(parent,i),result);}
  string PermissionName(string value){switch(value){case "applications.read":return "读取系统应用目录";case "applications.plan":return "检查并生成安装计划";case "applications.install":return "按计划安装系统应用";default:return value;}}
  StackPanel MarketCard(StackPanel p,string title,string subtitle){var content=new StackPanel();var heading=Text(title,14);heading.FontWeight=FontWeights.SemiBold;content.Children.Add(heading);content.Children.Add(Text(subtitle,11));p.Children.Add(new Border{Background=Brushes.White,BorderBrush=Brush("#E5E8ED"),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(12),Padding=new Thickness(12,7,12,7),Margin=new Thickness(0,5,0,7),Child=content});return content;}
  void RenderMarket(Dictionary<string,object> catalog,Dictionary<string,object> policy,IEnumerable packages){
    var p=Panel("应用市场");var search=Field(p,"搜索应用与能力包","");var cards=new StackPanel();p.Children.Add(cards);
    Action render=()=>{cards.Children.Clear();string query=search.Text.Trim().ToLowerInvariant();cards.Children.Add(Text("能力工具包",14));int count=0;
      foreach(var value in packages){var item=D(value);if(!(S(item,"name")+S(item,"id")).ToLowerInvariant().Contains(query))continue;count++;var card=MarketCard(cards,S(item,"name"),S(item,"version")+" · "+PackageState(S(item,"status")));card.Children.Add(Text(S(item,"description"),11));if(S(item,"reason")!="")card.Children.Add(Text(S(item,"reason"),11));ActionButton(card,"查看配置",async()=>await PackageDetail(item));}
      if(count==0)cards.Children.Add(Text("没有匹配的能力工具包",11));
      var systems=new StackPanel();var expander=new Expander{Header="系统应用",Content=systems,Margin=new Thickness(0,12,0,0),IsExpanded=query.Length>0};cards.Children.Add(expander);systems.Children.Add(Text(S(catalog,"platform")+" · "+(S(catalog,"manager")==""?"未检测到包管理器":S(catalog,"manager")),11));var enabled=Check(systems,"允许本机应用安装",B(policy,"enabled"));ActionButton(systems,"保存安装权限",async()=>{policy["enabled"]=enabled.IsChecked==true;await Api("applications.configure",policy);await Apps();});
      foreach(var value in A(V(catalog,"applications"))){var item=D(value);if(!(S(item,"id")+S(item,"package")).ToLowerInvariant().Contains(query))continue;ActionButton(systems,S(item,"id")+" · "+S(item,"package"),async()=>await Plan(D(await Api("applications.plan",Obj("app",S(item,"id"))))));}
    };search.TextChanged+=(s,e)=>render();render();ActionButton(p,"刷新市场",Apps);
  }
  async Task PackageDetail(Dictionary<string,object> item){Dictionary<string,object> installed=null;foreach(var value in A(await Api("packages.list"))){var record=D(value);if(S(record,"id")==S(item,"id"))installed=record;}RenderPackage(item,installed);}
  void RenderPackage(Dictionary<string,object> item,Dictionary<string,object> installed){
    string id=S(item,"id");var p=Panel(S(item,"name"));ActionButton(p,"返回应用市场",Apps);p.Children.Add(Text(S(item,"description"),12));p.Children.Add(Text("版本 "+S(item,"version")+" · "+(S(item,"source")=="bundled"?"随 cagent 提供":"GitHub"),11));p.Children.Add(Text(PackageState(S(installed??item,"status")),14));if(S(installed??item,"reason")!="")p.Children.Add(Text(S(installed??item,"reason"),11));
    if(installed==null){p.Children.Add(Text("安装后先核验文件与兼容性，再单独选择工具权限。",11));ActionButton(p,"安装并核验能力包",async()=>{await Api("packages.install",Obj("id",id,"confirm",true));await PackageDetail(item);});return;}
    p.Children.Add(Text(B(installed,"registered")?"工具已注册":"工具未注册",11));var grants=new HashSet<string>();foreach(var grant in A(V(installed,"grants")))grants.Add(Convert.ToString(grant));var choices=new Dictionary<string,CheckBox>();foreach(var value in A(V(installed,"requiredPermissions"))){string permission=Convert.ToString(value);choices[permission]=Check(p,PermissionName(permission),grants.Contains(permission));}
    if(id=="cagent.desktop"){var desktopBody=new StackPanel();var section=new Expander{Header="桌面服务与访问权限",Content=desktopBody,Margin=new Thickness(0,8,0,8)};bool loaded=false;section.Expanded+=async(s,e)=>{if(loaded)return;await Guard(async()=>{await DesktopSettings(desktopBody);loaded=true;});};p.Children.Add(section);}
    p.Children.Add(Text("选择仅修改草稿，保存后生效。系统应用安装还受独立安装权限限制。",11));
    ActionButton(p,"保存工具权限",async()=>{var allowed=new List<string>();foreach(var pair in choices)if(pair.Value.IsChecked==true)allowed.Add(pair.Key);await Api("packages.grant",Obj("id",id,"permissions",allowed.ToArray()));await PackageDetail(item);});
    ActionButton(p,"重新核验",async()=>{await Api("packages.refresh",Obj("id",id));await PackageDetail(item);});
    ActionButton(p,"停用工具",async()=>{await Api("packages.grant",Obj("id",id,"permissions",new string[0]));await PackageDetail(item);});
    var removal=new StackPanel{Visibility=Visibility.Collapsed};ActionButton(p,"卸载能力包",async()=>{removal.Visibility=Visibility.Visible;await Task.Yield();});p.Children.Add(removal);removal.Children.Add(Text("卸载将停止此能力包的任务并移除工具注册，不卸载已安装的系统软件。",11));ActionButton(removal,"确认卸载",async()=>{await Api("packages.uninstall",Obj("id",id,"confirm",true));await Apps();});ActionButton(removal,"保留能力包",async()=>{removal.Visibility=Visibility.Collapsed;await Task.Yield();});
  }
  int DesktopPort(string text){int value;if(!int.TryParse(text,out value)||value<1||value>65535)throw new Exception("端口需要填写 1 至 65535 的整数");return value;}
  void VerifyDesktopSettings(){var p=Panel("桌面服务设置");RenderDesktopSettings(p,Obj("enabled",false,"bindAddress","127.0.0.1","tcpPort",9998,"udpPort",9999,"local",Obj("view",false,"control",false),"ownerGrants",Obj()),false);UpdateLayout();var checks=new List<CheckBox>();FindChecks(p,checks);if(checks.Count!=3)throw new Exception("Desktop grants missing");foreach(var check in checks)if(check.IsChecked==true)throw new Exception("Desktop permissions default enabled");bool refused=false;try{DesktopPort("0");}catch{refused=true;}if(!refused||DesktopPort("65535")!=65535)throw new Exception("Desktop port validation failed");if(screenshot!=null)File.WriteAllText(screenshot+".json",json.Serialize(Obj("fixture",true,"serviceDefaultOff",true,"viewDefaultOff",true,"controlDefaultOff",true,"portValidation",true,"realDesktopStarted",false)),Encoding.UTF8);}
  async Task DesktopSettings(StackPanel p){var statusValue=D(await Api("desktop.status"));RenderDesktopSettings(p,D(V(statusValue,"config")),B(statusValue,"listening"));}
  void RenderDesktopSettings(StackPanel p,Dictionary<string,object> config,bool listening){
    p.Children.Clear();p.Children.Add(Text(listening?"服务已监听":"服务未监听",11));var enabled=Check(p,"启用桌面服务",B(config,"enabled"));var bind=Field(p,"监听 IP",S(config,"bindAddress"));var tcp=Field(p,"TCP 端口",S(config,"tcpPort"));var udp=Field(p,"UDP 端口",S(config,"udpPort"));var publicTcp=Field(p,"公网映射 TCP 端口（可留空）",S(config,"publicTcpPort"));var publicUdp=Field(p,"公网映射 UDP 端口（可留空）",S(config,"publicUdpPort"));var local=D(V(config,"local"));var view=Check(p,"允许本机观看",B(local,"view"));var control=Check(p,"允许本机键鼠控制",B(local,"control"));
    var views=new List<string>();var controls=new List<string>();foreach(var entry in D(V(config,"ownerGrants"))){var grant=D(entry.Value);if(B(grant,"view"))views.Add(entry.Key);if(B(grant,"control"))controls.Add(entry.Key);}
    var viewOwners=Field(p,"允许远程观看的控制端指纹（每行一个）",string.Join("\n",views.ToArray()),true);var controlOwners=Field(p,"允许远程控制的控制端指纹（每行一个）",string.Join("\n",controls.ToArray()),true);p.Children.Add(Text("观看与控制分别授权。修改仅为草稿；保存会重启桌面监听、中断当前桌面连接，不自动开放防火墙。",11));
    ActionButton(p,"保存并应用桌面配置",async()=>{var owners=new Dictionary<string,object>();foreach(string raw in viewOwners.Text.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries)){string owner=raw.Trim();if(owner.Length>0)owners[owner]=Obj("view",true,"control",false);}foreach(string raw in controlOwners.Text.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries)){string owner=raw.Trim();if(owner.Length==0)continue;Dictionary<string,object> grant;if(owners.ContainsKey(owner))grant=D(owners[owner]);else{grant=Obj("view",false,"control",false);owners[owner]=grant;}grant["control"]=true;}
      var value=Obj("enabled",enabled.IsChecked==true,"bindAddress",bind.Text.Trim(),"tcpPort",DesktopPort(tcp.Text),"udpPort",DesktopPort(udp.Text),"local",Obj("view",view.IsChecked==true,"control",control.IsChecked==true),"ownerGrants",owners);if(publicTcp.Text.Trim().Length>0)value["publicTcpPort"]=DesktopPort(publicTcp.Text);if(publicUdp.Text.Trim().Length>0)value["publicUdpPort"]=DesktopPort(publicUdp.Text);await Api("desktop.configure",value);await DesktopSettings(p);});
  }
  async Task Plan(Dictionary<string,object> plan){var p=Panel(S(plan,"app"));p.Children.Add(Text(S(plan,"state")));p.Children.Add(Text(S(plan,"warning"),11));p.Children.Add(Text(S(plan,"executable")+" "+json.Serialize(V(plan,"args")),11));p.Children.Add(Text(S(plan,"logs"),11));if(S(plan,"state")=="planned")ActionButton(p,"执行此安装计划",async()=>await Plan(D(await Api("applications.install",Obj("id",S(plan,"id"),"confirm",true)))));if(S(plan,"state")=="running")ActionButton(p,"取消安装",async()=>await Plan(D(await Api("applications.cancel",Obj("id",S(plan,"id"))))));ActionButton(p,"刷新进度",async()=>await Plan(D(await Api("applications.status",Obj("id",S(plan,"id"))))));await Task.Yield();}
  async Task Remote(){var s=D(await Api("client.status"));var p=Panel("远程连接");p.Children.Add(Text(B(s,"running")?"远程监听已开启":"远程监听关闭"));p.Children.Add(Text("设备 ID\n"+S(s,"deviceId"),11));p.Children.Add(Text("身份指纹\n"+S(s,"fingerprint"),11));var bind=Field(p,"监听地址",S(s,"bind")==""?"127.0.0.1":S(s,"bind"));var port=Field(p,"端口",S(s,"port")==""?"24443":S(s,"port"));ActionButton(p,"开启监听",async()=>{await Api("client.start",Obj("bind",bind.Text,"port",int.Parse(port.Text)));await Remote();});ActionButton(p,"关闭监听及会话",async()=>{await Api("client.stop");await Remote();});p.Children.Add(Text("连接密码与访问权限可通过本机 cagent CLI 或 CShell 的 cagent 配置修改。",11));}
  void SaveImage(string path){var bitmap=new RenderTargetBitmap((int)ActualWidth,(int)ActualHeight,96,96,PixelFormats.Pbgra32);bitmap.Render(this);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using(var output=File.Create(path))encoder.Save(output);}
  [STAThread]public static void Main(string[] args){new Application().Run(new CagentWindow(args));}
}
