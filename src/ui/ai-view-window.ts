import type {AiThread} from '../shared/ai';
/** Open a saved layout referencing the existing conversation, never copy its permissions or secrets. */
export async function openAiViewWindow(thread: AiThread) {
  const displays=await window.cshell.viewDisplays();
  const display=displays.find(d=>d.primary) ?? displays[0];
  if (!display) throw Error('No display is available');
  const id=crypto.randomUUID();
  await window.cshell.saveMonitorView({id,name:thread.title.slice(0,80)||'AI',mode:'tile',tiles:[{
    id:crypto.randomUUID(),profileId:'',kind:'ai',threadId:thread.id,label:thread.title.slice(0,80)||'AI',
    displayId:display.id,column:0,row:0,width:12,height:12,directory:'',command:'',screen:''
  }]});
  await window.cshell.openMonitorView(id);
}
