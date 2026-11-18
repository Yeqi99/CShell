export function drawPoster(canvas:HTMLCanvasElement,options:{type:'invite'|'gift';code:string;label?:string;origin:string;path:string}):Promise<{url:string;width:number;height:number;qr:{x:number;y:number;size:number}}>;

