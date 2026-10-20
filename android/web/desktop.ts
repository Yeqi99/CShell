import {desktopScanCode,h264Codec} from '../../src/ui/desktop-keys';
import {DesktopTouch,videoPoint} from './desktop-touch';
type Bridge={desktopOpen(id:string,options:string):void;desktopClose(id:string):void;desktopCommand(id:string,command:string):void};
export class MobileDesktop {
  private root=document.createElement('section');private canvas=document.createElement('canvas');private message=document.createElement('p');
  private decoder?:VideoDecoder;private codec='';private pending?:{id:string;start:number};private timeout?:ReturnType<typeof setTimeout>;
  private id='';private control=false;private suspended=false;private unlimited=false;private allowed=false;private unicode=false;private touch:DesktopTouch;
  private options:{fps:number;bitrate:number;display:number;adaptive:boolean;unlimited?:boolean}={fps:60,bitrate:12_000_000,display:0,adaptive:true};
  private presetButtons:HTMLButtonElement[]=[];private qualityFields:HTMLInputElement[]=[];
  private refreshQuality(){this.qualityFields.forEach((f,i)=>{f.value=String(i?this.options.bitrate/1e6:this.options.fps);f.disabled=!!this.options.unlimited;});this.presetButtons.forEach((b,i)=>{b.disabled=i===4&&!this.unlimited;b.setAttribute('aria-pressed',String(i===4?!!this.options.unlimited:!this.options.unlimited&&this.options.fps===[24,30,60,90][i]&&this.options.bitrate===[2e6,5e6,12e6,30e6][i]));});}
  private toggle=document.createElement('input');private reportAt=0;
  constructor(private bridge:Bridge){
    this.root.className='mobile-desktop';this.root.hidden=true;this.root.setAttribute('aria-label','远程桌面');
    const bar=document.createElement('header');const title=document.createElement('strong');title.textContent='远程桌面';bar.append(title);
    const close=document.createElement('button');close.textContent='断开';close.onclick=()=>this.close();bar.append(close);
    const label=document.createElement('label');this.toggle.type='checkbox';label.append(this.toggle,'控制键鼠');bar.append(label);this.toggle.onchange=()=>{this.release();this.control=this.toggle.checked&&this.allowed;};
    const input=document.createElement('button');input.textContent='输入文字';bar.append(input);
    const text=document.createElement('textarea');text.placeholder='使用手机输入法输入文字';text.hidden=true;text.maxLength=512;text.setAttribute('aria-label','发送到远端的文字');
    const send=document.createElement('button');send.textContent='发送文字';send.hidden=true;
    input.onclick=()=>{if(!this.unicode){this.message.textContent='中文输入需要更新被控 CAgent 的远程桌面包';return;}text.hidden=!text.hidden;send.hidden=text.hidden;if(!text.hidden)text.focus();};
    send.onclick=()=>{if(text.value){this.input({kind:'text',text:text.value});text.value='';text.hidden=true;send.hidden=true;this.canvas.focus();}};
    const keyboard=document.createElement('div');keyboard.className='desktop-keys';
    for(const [label,codes] of [['Esc',['Escape']],['Tab',['Tab']],['Enter',['Enter']],['⌫',['Backspace']],['Ctrl+C',['ControlLeft','KeyC']],['Ctrl+V',['ControlLeft','KeyV']],['Alt+Tab',['AltLeft','Tab']],['Win',['MetaLeft']],['↑',['ArrowUp']],['↓',['ArrowDown']],['←',['ArrowLeft']],['→',['ArrowRight']]] as [string,string[]][]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{for(const code of codes)this.input({kind:'key',code:desktopScanCode(code),down:true});for(const code of [...codes].reverse())this.input({kind:'key',code:desktopScanCode(code),down:false});};keyboard.append(b);}
    const quality=document.createElement('details');const summary=document.createElement('summary');summary.textContent='画质';quality.append(summary);
    const presets=document.createElement('div');presets.className='desktop-presets';presets.setAttribute('aria-label','画质预设');for(const [i,name] of ['低','中','高','超高','无上限'].entries()){const b=document.createElement('button');b.textContent=name;b.title=i===4?'按网络和设备余量逐步提升，需要新版 CAgent':name+'画质';b.onclick=()=>{this.options={display:this.options.display,fps:[24,30,60,90,60][i],bitrate:[2e6,5e6,12e6,30e6,12e6][i],adaptive:true,...(i===4?{unlimited:true}:{})};this.refreshQuality();this.command({op:'quality',value:this.options});};this.presetButtons.push(b);presets.append(b);}quality.append(presets);
    for(const [key,label,divisor] of [['fps','帧率',1],['bitrate','码率 Mbps',1_000_000]] as const){const l=document.createElement('label');l.textContent=label;const field=document.createElement('input');field.type='number';field.min='1';field.value=String(this.options[key]/divisor);field.onchange=()=>{const n=Number(field.value)*divisor;if(Number.isSafeInteger(n)&&n>0&&n<=0xffffffff){this.options[key]=n;delete this.options.unlimited;this.refreshQuality();this.command({op:'quality',value:this.options});}};this.qualityFields.push(field);l.append(field);quality.append(l);}
    this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','远端画面，单指点击或拖动，长按右键，双指滚动');this.message.setAttribute('role','status');
    this.root.append(bar,quality,this.canvas,keyboard,text,send,this.message);document.body.append(this.root);
    const move=(x:number,y:number)=>{const p=videoPoint(x,y,this.canvas.getBoundingClientRect(),this.canvas.width,this.canvas.height);if(!p)return false;this.input({kind:'move',...p});return true;};
    this.touch=new DesktopTouch(v=>this.input(v),move);
    this.canvas.onpointerdown=e=>{e.preventDefault();this.canvas.focus();this.canvas.setPointerCapture(e.pointerId);if(e.pointerType==='mouse'){if(move(e.clientX,e.clientY))this.input({kind:'button',button:e.button===2?1:e.button===1?2:0,down:true});}else this.touch.down(e.pointerId,e.clientX,e.clientY);};
    this.canvas.onpointermove=e=>{if(e.pointerType==='mouse')move(e.clientX,e.clientY);else this.touch.motion(e.pointerId,e.clientX,e.clientY);};
    this.canvas.onpointerup=e=>{if(e.pointerType==='mouse')this.input({kind:'button',button:e.button===2?1:e.button===1?2:0,down:false});else this.touch.up(e.pointerId);};
    this.canvas.onpointercancel=()=>this.release();this.canvas.onlostpointercapture=()=>this.release();this.canvas.oncontextmenu=e=>e.preventDefault();
    this.canvas.onwheel=e=>{e.preventDefault();this.input({kind:'wheel',delta:Math.max(-32768,Math.min(32767,Math.round(-e.deltaY)))});};
    for(const type of ['keydown','keyup'] as const)this.canvas.addEventListener(type,e=>{const code=desktopScanCode(e.code);if(code&&!e.isComposing){e.preventDefault();this.input({kind:'key',code,down:type==='keydown'});}});
    window.addEventListener('blur',()=>this.release());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.close();});this.canvas.onblur=()=>this.release();
  }
  get visible(){return !this.root.hidden;}
  private command(value:unknown){if(this.id)this.bridge.desktopCommand(this.id,JSON.stringify(value));}
  private input(value:unknown){if(this.control&&!this.suspended)this.command({op:'input',value});}
  private release(){this.touch.cancel();this.command({op:'release-input'});}
  open(id:string,status:{controlAllowed?:boolean;inputFeatures?:string[];qualityModes?:string[]}){
    this.close();this.id=id;this.suspended=false;this.allowed=!!status.controlAllowed;this.control=this.allowed;this.unlimited=!!status.qualityModes?.includes('unlimited');if(!this.unlimited)delete this.options.unlimited;this.refreshQuality();this.unicode=!!status.inputFeatures?.includes('unicode-text');this.root.hidden=false;this.message.textContent='正在连接…';
    this.toggle.checked=this.control;this.toggle.disabled=!status.controlAllowed;
    if(typeof VideoDecoder==='undefined'){this.message.textContent='当前 Android System WebView 不支持视频解码，请更新系统 WebView';return;}
    this.bridge.desktopOpen(id,JSON.stringify({control:this.control,quality:this.options}));
  }
  close(){this.release();if(this.id)this.bridge.desktopClose(this.id);this.id='';this.root.hidden=true;this.reset();}
  private reset(){clearTimeout(this.timeout);try{this.decoder?.close();}catch{}this.decoder=undefined;this.codec='';this.pending=undefined;}
  event(id:string,type:string,value:string){if(id!==this.id)return;
    if(type==='desktop-error'||type==='desktop-closed'){this.suspended=true;this.release();this.reset();this.message.textContent=value||'桌面已断开，请返回机器后重新连接';return;}
    if(type==='desktop-video'){try{const info=JSON.parse(value);this.unlimited=info.unlimitedQuality===true;this.refreshQuality();}catch{}return;}
    if(type==='desktop-notice'){if(value.startsWith('INPUT_SUSPENDED: ')){this.suspended=true;this.release();}else if(value==='INPUT_RESUMED'){this.suspended=false;value='画面和控制已恢复';}else if(value.startsWith('INPUT_DISABLED: ')||value==='Control permission denied'){this.suspended=true;this.control=false;this.toggle.checked=false;this.release();}this.message.textContent=value.replace(/^INPUT_(SUSPENDED|DISABLED): /,'');return;}
    if(type!=='desktop-frame')return;
    try{const f=JSON.parse(value);const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));const next=h264Codec(bytes);
      if(next&&next!==this.codec){this.reset();this.codec=next;const instance=new VideoDecoder({output:frame=>{try{if(this.decoder!==instance)return;this.canvas.width=frame.displayWidth;this.canvas.height=frame.displayHeight;this.canvas.getContext('2d',{alpha:false})!.drawImage(frame,0,0);this.message.textContent=this.suspended?'控制暂不可用，等待远端恢复':this.control?'单指点击 / 拖动 · 长按右键 · 双指滚动':'仅查看';this.ack();}finally{frame.close();}},error:e=>{if(this.decoder!==instance)return;this.message.textContent='解码失败：'+e.message;this.ack();this.reset();this.command({op:'keyframe'});}});this.decoder=instance;this.decoder.configure({codec:next,optimizeForLatency:true});}
      if(!this.decoder){this.command({op:'ack',id:f.id});this.command({op:'keyframe'});return;}
      if(this.pending)throw new Error('视频帧积压');this.pending={id:f.id,start:performance.now()};this.timeout=setTimeout(()=>{this.ack();this.reset();this.command({op:'keyframe'});},2500);
      this.decoder.decode(new EncodedVideoChunk({type:f.key?'key':'delta',timestamp:f.timestamp,data:bytes}));
    }catch(e){this.message.textContent=String(e);this.ack();this.reset();this.command({op:'keyframe'});}
  }
  private ack(){clearTimeout(this.timeout);if(this.pending){const now=performance.now();if(now-this.reportAt>=2000){this.command({op:'feedback',value:{decodeMs:Math.max(0,now-this.pending.start),queueMs:Math.max(0,now-this.pending.start)}});this.reportAt=now;}this.command({op:'ack',id:this.pending.id});this.pending=undefined;}}
}
