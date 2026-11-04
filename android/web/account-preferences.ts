/** Only settings supported by the mobile renderer are consumed. Opaque desktop
 * preferences remain in the native encrypted bundle and are never rewritten. */
export function mobilePreferences(value:unknown){
 const p=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const number=(key:string,min:number,max:number,fallback:number)=>typeof p[key]==='number'&&Number.isFinite(p[key])?Math.max(min,Math.min(max,p[key] as number)):fallback;
 const font=(key:string,fallback:string)=>typeof p[key]==='string'&&(p[key] as string).length<=200?p[key] as string:fallback;
 return {uiFontSize:number('uiFontSize',9,20,14),uiFont:font('uiFont','system-ui, sans-serif'),fontSize:number('fontSize',8,28,14),fontFamily:font('terminalFont','monospace'),lineHeight:number('lineHeight',1,1.8,1.2)};
}
