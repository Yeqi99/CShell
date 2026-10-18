// Physical Windows scan codes. Extended keys carry 0x100; no text/layout guessing.
const keys:Record<string,number>={Escape:1,Minus:12,Equal:13,Backspace:14,Tab:15,BracketLeft:26,BracketRight:27,Enter:28,ControlLeft:29,Semicolon:39,Quote:40,Backquote:41,ShiftLeft:42,Backslash:43,Comma:51,Period:52,Slash:53,ShiftRight:54,NumpadMultiply:55,AltLeft:56,Space:57,CapsLock:58,NumLock:69,ScrollLock:70,Numpad7:71,Numpad8:72,Numpad9:73,NumpadSubtract:74,Numpad4:75,Numpad5:76,Numpad6:77,NumpadAdd:78,Numpad1:79,Numpad2:80,Numpad3:81,Numpad0:82,NumpadDecimal:83,IntlBackslash:86,F11:87,F12:88,NumpadEnter:0x11c,ControlRight:0x11d,NumpadDivide:0x135,AltRight:0x138,Home:0x147,ArrowUp:0x148,PageUp:0x149,ArrowLeft:0x14b,ArrowRight:0x14d,End:0x14f,ArrowDown:0x150,PageDown:0x151,Insert:0x152,Delete:0x153,MetaLeft:0x15b,MetaRight:0x15c,ContextMenu:0x15d};
'1234567890'.split('').forEach((v,i)=>keys['Digit'+v]=i+2);
'QWERTYUIOP'.split('').forEach((v,i)=>keys['Key'+v]=i+16);
'ASDFGHJKL'.split('').forEach((v,i)=>keys['Key'+v]=i+30);
'ZXCVBNM'.split('').forEach((v,i)=>keys['Key'+v]=i+44);
for(let i=1;i<=10;i++)keys['F'+i]=58+i;
export const desktopScanCode=(code:string)=>keys[code];
export function h264Codec(data:Uint8Array):string|undefined{
  for(let i=0;i+7<data.length;i++){
    let n=-1;
    if(data[i]===0&&data[i+1]===0&&data[i+2]===1)n=i+3;
    else if(data[i]===0&&data[i+1]===0&&data[i+2]===0&&data[i+3]===1)n=i+4;
    if(n>=0&&(data[n]&31)===7&&n+3<data.length)return 'avc1.'+[data[n+1],data[n+2],data[n+3]].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
}
