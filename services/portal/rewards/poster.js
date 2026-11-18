const loadImage = src => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('海报素材加载失败，请刷新后重试'));image.src=src;});
const assets=new Map();
function asset(name){if(!assets.has(name))assets.set(name,loadImage((name==='gift-v1.webp'?new URL('./art/gift-v1.webp',import.meta.url):new URL('./art/workspace-v1.webp',import.meta.url)).href).catch(e=>{assets.delete(name);throw e;}));return assets.get(name);}
function box(ctx,x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();}
function text(ctx,value,x,y,size,color='#f4f8ff',weight=500){ctx.font=weight+' '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif';ctx.fillStyle=color;ctx.fillText(value,x,y);}
function wrap(ctx,value,x,y,width,size,color,weight=500){ctx.font=weight+' '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif';let line='',row=0;for(const c of value){if(ctx.measureText(line+c).width>width){text(ctx,line,x,y+row*size*1.45,size,color,weight);line='';row++;}line+=c;}if(line)text(ctx,line,x,y+row*size*1.45,size,color,weight);return row+1;}
function ticket(canvas, {type, code, label, origin, path, campaign}, hero, logo) {
 const invite=type==='invite';
 const width=1440,height=560,stub=1032;
 canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d');
 const ink=ctx.createLinearGradient(0,0,stub,height);
 ink.addColorStop(0,invite?'#092836':'#111c32');ink.addColorStop(1,invite?'#21566a':'#293a54');
 ctx.fillStyle=ink;ctx.fillRect(0,0,width,height);
 ctx.save();ctx.beginPath();ctx.rect(0,0,stub,height);ctx.clip();
 ctx.globalAlpha=.95;ctx.drawImage(hero,552,55,565,377);ctx.restore();
 ctx.drawImage(logo,54,43,42,42);text(ctx,'CShell',109,77,32,'#fff',700);
 text(ctx,invite?'好 友 邀 请':'数 字 礼 品 卡',55,171,23,'#e5c392',600);
 const title=invite?'邀请你加入 CShell':label||'CShell 礼品卡';
 ctx.font='700 63px "Microsoft YaHei", sans-serif';ctx.fillStyle='#fffbef';ctx.fillText(title,51,264,552);
 text(ctx,invite?'连接设备，与智能体一起工作':(campaign?'每账号限领一次 · 共 '+campaign+' 个名额':'扫码后，登录或注册即可领取'),55,329,25,'#cfdae8');
 ctx.fillStyle='#637184';ctx.fillRect(55,390,923,1);
 text(ctx,invite?'邀请奖励':'兑换码',55,439,23,'#d8c5a5');
 ctx.font='500 34px Consolas, monospace';ctx.fillStyle='#fff';if(invite)text(ctx,'好友充值后，邀请人获 5% 点数返奖',54,501,33,'#fff',600);
 else ctx.fillText(code.toUpperCase().match(/.{4}/g).join(' '),53,503,918);
 ctx.fillStyle='#faf5e9';ctx.fillRect(stub,0,width-stub,height);
 ctx.setLineDash([6,9]);ctx.strokeStyle='#a19a8b';ctx.beginPath();ctx.moveTo(stub+1,0);ctx.lineTo(stub+1,height);ctx.stroke();ctx.setLineDash([]);
 const link=new URL(path,origin);link.hash=new URLSearchParams({[type]:code});
 const qr=globalThis.qrcode(0,'M');qr.addData(link.href);qr.make();
 const n=qr.getModuleCount(),scale=Math.floor(310/(n+8)),size=(n+8)*scale;
 const x=stub+Math.floor((width-stub-size)/2),y=Math.floor((height-size)/2)-13;
 ctx.fillStyle='#fff';ctx.fillRect(x,y,size,size);ctx.fillStyle='#152237';
 for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))ctx.fillRect(x+(c+4)*scale,y+(r+4)*scale,scale,scale);
 ctx.textAlign='center';text(ctx,invite?'扫码注册':'扫码兑换',1236,y+size+55,32,'#1c2a3e',700);
 text(ctx,'shell.canp.ai',1236,y+size+92,22,'#566273');ctx.textAlign='left';
 return {url:link.href,width,height,qr:{x,y,size}};
}
export async function drawPoster(canvas,{type,code,label,campaign,origin=location.origin,path=location.pathname}){
 if(!['invite','gift'].includes(type)||!(type==='gift'?/^[a-f0-9]{32}$/i:/^[a-f0-9]{24}$/i).test(code))throw Error('海报兑换码或邀请码无效');
 const [hero,logo]=await Promise.all([asset(type==='gift'?'gift-v1.webp':'workspace-v1.webp'),loadImage(new URL('../icon.svg',import.meta.url).href)]);
 await document.fonts.ready;
 return ticket(canvas,{type,code,label,origin,path,campaign},hero,logo);
}