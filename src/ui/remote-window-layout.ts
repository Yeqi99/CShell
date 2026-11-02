/** Size a phone viewer around its video plus its title bar, inside its desktop. */
export function aspectWindowBounds(ratio:number,size:{w:number;h:number},previous?:{x:number;y:number;w:number;h:number}) {
  const safeRatio=Number.isFinite(ratio)&&ratio>0?ratio:9/16;
  const chrome=36, margin=Math.min(20,size.w/8,size.h/8);
  const availableW=Math.max(1,size.w-margin*2),availableH=Math.max(1,size.h-margin*2);
  const videoH=Math.max(1,Math.min(availableH-chrome,720,availableW/safeRatio));
  const w=Math.min(availableW,Math.max(Math.min(280,availableW),videoH*safeRatio));
  const h=Math.min(availableH,videoH+chrome);
  const cx=previous?previous.x+previous.w/2:size.w/2,cy=previous?previous.y+previous.h/2:size.h/2;
  return {w,h,x:Math.max(margin,Math.min(cx-w/2,size.w-margin-w)),y:Math.max(margin,Math.min(cy-h/2,size.h-margin-h))};
}
