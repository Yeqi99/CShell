import { useI18n } from '../i18n';
import './capability-selection.css';
/** Only changes the supplied capability array, never scopes or service state. */
export function CapabilitySelection<T extends string>({options,value=[],change}:{options:readonly T[];value?:readonly T[];change:(value:T[])=>void}){
 const {locale}=useI18n(),cn=locale==='zh-CN';
 const count=options.filter(option=>value.includes(option)).length;
 return <div className="capability-selection"><span aria-live="polite">{cn?'已选':'Selected'} {count}/{options.length}</span><button type="button" disabled={count===options.length} onClick={()=>change([...options])}>{cn?'全选能力':'Select all capabilities'}</button><button type="button" disabled={!count} onClick={()=>change([])}>{cn?'清空能力':'Clear capabilities'}</button></div>;
}
