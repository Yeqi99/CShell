import {useI18n} from '../i18n';
import {useSyncExternalStore} from 'react';
import {Copy,ClipboardPaste} from 'lucide-react';
type Selection={target:string;root:string;path:string;name:string;provider?:'sftp'|'ftp'};
let selection:Selection|undefined;
const listeners=new Set<()=>void>();
const subscribe=(callback:()=>void)=>{listeners.add(callback);return()=>{listeners.delete(callback);};};
export function MachineFileCopyActions({source,destination,disabled,onPaste}:{source?:Selection;destination:{target:string;root:string;path:string;provider?:'sftp'|'ftp'};disabled:boolean;onPaste:(source:Selection,destination:Selection)=>void}){
 const cn=useI18n().locale==='zh-CN'; const t=(zh:string,en:string)=>cn?zh:en;
 const current=useSyncExternalStore(subscribe,()=>selection);
 return <span className="machine-file-copy-actions"><button className="icon" title={t('复制到其他机器','Copy to another machine')} aria-label={t('复制到其他机器','Copy to another machine')} disabled={disabled||!source} onClick={()=>{selection=source;listeners.forEach(fn=>fn());}}><Copy size={17}/></button><button className="icon" title={current?t(`粘贴 ${current.name} 到当前目录`,`Paste ${current.name} into this folder`):t('先在来源机器选择并复制文件','Select and copy a source file first')} aria-label={t('粘贴机器文件','Paste machine file')} disabled={disabled||!current||(!destination.root&&!destination.provider)} onClick={()=>{if(current)onPaste(current,{...destination,path:(destination.path==='/'?'':destination.path)+'/'+current.name,name:current.name});}}><ClipboardPaste size={17}/></button></span>;
}
