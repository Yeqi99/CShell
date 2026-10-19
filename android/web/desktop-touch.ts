export type TouchInput = {kind:'move';x:number;y:number}|{kind:'button';button:number;down:boolean}|{kind:'wheel';delta:number;horizontal?:boolean};
/** Coordinates refer to the displayed video, excluding letterbox margins. */
export function videoPoint(x:number,y:number,rect:{left:number;top:number;width:number;height:number},width:number,height:number){
  const scale=Math.min(rect.width/width,rect.height/height),w=width*scale,h=height*scale;
  if(!Number.isFinite(scale)||scale<=0)return;
  const px=(x-rect.left-(rect.width-w)/2)/w,py=(y-rect.top-(rect.height-h)/2)/h;
  if(px<0||px>1||py<0||py>1)return;
  return {x:px,y:py};
}
export class DesktopTouch {
  private points=new Map<number,{x:number;y:number}>();
  private start?:{x:number;y:number};private drag=false;private multiple=false;private held=false;private long=false;
  private timer?:ReturnType<typeof setTimeout>;
  constructor(private emit:(input:TouchInput)=>void,private move:(x:number,y:number)=>boolean){}
  down(id:number,x:number,y:number){
    this.points.set(id,{x,y});
    if(this.points.size>1){this.multiple=true;clearTimeout(this.timer);if(this.held){this.emit({kind:'button',button:0,down:false});this.held=false;}return;}
    this.start={x,y};this.drag=false;this.long=false;this.multiple=false;
    if(!this.move(x,y)){this.points.delete(id);return;}
    this.timer=setTimeout(()=>{if(!this.drag&&!this.multiple&&this.points.size===1){this.long=true;this.emit({kind:'button',button:1,down:true});this.emit({kind:'button',button:1,down:false});}},550);
  }
  motion(id:number,x:number,y:number){const previous=this.points.get(id);if(!previous)return;this.points.set(id,{x,y});
    if(this.multiple){if(this.points.size===2){const delta=Math.round((y-previous.y)*3);if(delta)this.emit({kind:'wheel',delta:Math.max(-32768,Math.min(32767,delta))});}return;}
    if(this.long)return;
    if(this.start&&!this.drag&&Math.hypot(x-this.start.x,y-this.start.y)>7){clearTimeout(this.timer);this.drag=true;this.held=true;this.emit({kind:'button',button:0,down:true});}
    if(this.drag)this.move(x,y);
  }
  up(id:number){if(!this.points.delete(id))return;clearTimeout(this.timer);
    if(this.held){this.emit({kind:'button',button:0,down:false});this.held=false;}
    else if(!this.multiple&&!this.long&&!this.drag){this.emit({kind:'button',button:0,down:true});this.emit({kind:'button',button:0,down:false});}
    if(!this.points.size)this.start=undefined;
  }
  cancel(){clearTimeout(this.timer);if(this.held)this.emit({kind:'button',button:0,down:false});this.points.clear();this.held=false;this.start=undefined;}
}
