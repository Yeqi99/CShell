import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LinuxDesktop} from '../../src/ui/components/LinuxDesktop';
import {TabStrip} from '../../src/ui/components/TabStrip';
import '../../src/ui/styles.css';
(window as any).cshell={};
function Test(){
 const [revision,setRevision]=useState<number>();const[active,setActive]=useState(0),[count,setCount]=useState(4);
 return <><button id="request" onClick={()=>setRevision(v=>(v??0)+1)}>Open native desktop</button><button id="overflow" onClick={()=>{setCount(10);setActive(9)}}>Overflow tabs</button><button id="first" onClick={()=>setActive(0)}>First tab</button>
 <div className="tabbar" style={{width:600}}><div className="tabbar-controls">布局</div><TabStrip>{Array.from({length:count},(_,i)=><div key={i} className={'tab '+(i===active?'active':'')}><button onClick={()=>setActive(i)}>机器 {i+1}</button><button className="icon" aria-label={'关闭机器 '+(i+1)}>×</button></div>)}</TabStrip><button className="workbench-tool"><span>文件与机器信息</span>▤</button></div>
 <div style={{width:900,height:600}}><LinuxDesktop name="Test Linux" machine={{deviceId:'test',platform:'linux',desktopOnly:true}} target="test" active={true} call={async()=>({})} initialApp={revision?'native-desktop':undefined} initialAppRevision={revision} extraPanels={[{id:'native-desktop',label:'原生桌面',content:<div id="native-content">Native desktop entry fixture</div>}]}/></div></>;
}
createRoot(document.getElementById('root')!).render(<Test/>);
