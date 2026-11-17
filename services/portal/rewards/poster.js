const loadImage = src => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('海报素材加载失败，请刷新后重试'));image.src=src;});
const assets=new Map();
function asset(name){if(!assets.has(name))assets.set(name,loadImage(new URL('./art/'+name,import.meta.url).href).catch(e=>{assets.delete(name);throw e;}));return assets.get(name);}
function box(ctx,x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();}
function text(ctx,value,x,y,size,color='#f4f8ff',weight=500){ctx.font=weight+' '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif';ctx.fillStyle=color;ctx.fillText(value,x,y);}
function wrap(ctx,value,x,y,width,size,color,weight=500){ctx.font=weight+' '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif';let line='',row=0;for(const c of value){if(ctx.measureText(line+c).width>width){text(ctx,line,x,y+row*size*1.45,size,color,weight);line='';row++;}line+=c;}if(line)text(ctx,line,x,y+row*size*1.45,size,color,weight);return row+1;}
export async function drawPoster(canvas,{type,code,label,origin=location.origin,path=location.pathname}){
 if(!['invite','gift'].includes(type)||!(type==='gift'?/^[a-f0-9]{32}$/i:/^[a-f0-9]{24}$/i).test(code))throw Error('海报兑换码或邀请码无效');
 const [background,hero,logo]=await Promise.all([asset('midnight-v1.webp'),asset(type==='gift'?'gift-v1.webp':'workspace-v1.webp'),loadImage(new URL('../icon.svg',import.meta.url).href)]);
 await document.fonts.ready;
 canvas.width=1080;canvas.height=1440;const ctx=canvas.getContext('2d');
 ctx.drawImage(background,0,0,1080,1440);
 const shade=ctx.createLinearGradient(0,0,0,1440);shade.addColorStop(0,'#06101e88');shade.addColorStop(.45,'#06101e00');shade.addColorStop(1,'#06101ebb');ctx.fillStyle=shade;ctx.fillRect(0,0,1080,1440);
 ctx.drawImage(logo,64,59,54,54);text(ctx,'CShell',134,102,39,'#fff',700);
 text(ctx,type==='gift'?'GIFT COLLECTION':'WORK, CONNECTED.',64,169,19,type==='gift'?'#edcea2':'#91bce8',600);
 text(ctx,type==='gift'?'一份心意':'把想法',60,266,83,'#fff',750);
 text(ctx,type==='gift'?'即刻开启。':'交给智能体。',60,368,83,'#fff',750);
 wrap(ctx,type==='gift'?label:'连接设备 · 运行任务 · 沉淀知识',66,427,948,29,type==='gift'?'#f1d7b2':'#bcd4ec');
 ctx.drawImage(hero,30,440,1020,680);
 box(ctx,64,962,952,62,16,'#07172bd9');
 text(ctx,type==='gift'?'CShell 数字礼品卡':'好友充值后，邀请人获 5% 点数奖励',88,1003,25,type==='gift'?'#f4dcb8':'#c5e5ff',600);
 box(ctx,64,1050,952,306,26,'#f8fbff');
 const link=new URL(path,origin);link.hash=new URLSearchParams({[type]:code});
 const qr=globalThis.qrcode(0,'M');qr.addData(link.href);qr.make();
 const n=qr.getModuleCount(),scale=Math.floor(248/(n+8)),size=(n+8)*scale,x=88+Math.floor((260-size)/2),y=1073+Math.floor((260-size)/2);
 ctx.fillStyle='#fff';ctx.fillRect(x,y,size,size);ctx.fillStyle='#0a172b';
 for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))ctx.fillRect(x+(c+4)*scale,y+(r+4)*scale,scale,scale);
 text(ctx,type==='gift'?'扫码领取礼遇':'扫码加入 CShell',384,1135,36,'#142338',700);
 wrap(ctx,type==='gift'?'登录或注册后，确认兑换到当前账号。':'一个账号，连接你的多端智能体。',384,1190,580,23,'#53677d');
 text(ctx,type==='gift'?'兑换码':'专属邀请',384,1265,19,'#6b7d90');
 ctx.font='20px ui-monospace, Consolas, monospace';ctx.fillStyle='#233953';ctx.fillText(type==='gift'?code:'CShell · '+code.slice(-6).toUpperCase(),384,1301);
 text(ctx,'shell.canp.ai',64,1400,20,'#a2bad0');text(ctx,'CSHELL / CANP AGENT',751,1400,17,'#7895af',600);
 return {url:link.href,width:1080,height:1440,qr:{x,y,size}};
}
