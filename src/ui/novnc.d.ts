declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target:HTMLElement,channel:unknown,options?:{credentials?:{password?:string}});
    scaleViewport:boolean; resizeSession:boolean; viewOnly:boolean;
    disconnect():void; focus():void; sendCredentials(credentials:{password:string}):void;
  }
}

