import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Files } from 'lucide-react';
import './visual-ssh-terminal.css';

/** The shared PTY host stays mounted; collapsing tools only changes layout and sampling visibility. */
export function VisualSshTerminal({ active, closed, children, tools }: { active: boolean; closed: boolean; children: ReactNode; tools: (active: boolean) => ReactNode }) {
  const [open,setOpen]=useState(false),[visited,setVisited]=useState(false);
  return <section className="visual-ssh-terminal" aria-label="SSH 终端与机器工具">
    <div className="visual-ssh-tools-bar"><button aria-expanded={open} onClick={()=>{setOpen(value=>!value);setVisited(true);}}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<Files size={14}/>文件与机器信息</button>{closed&&<span role="status">连接已断开</span>}</div>
    <div className={'visual-ssh-split'+(open&&!closed?' tools-open':'')}><div className="visual-ssh-output">{children}</div><div className="visual-ssh-tools" hidden={!open||closed} inert={!open||closed}>{visited&&tools(active&&open&&!closed)}</div></div>
  </section>;
}
