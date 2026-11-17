import {useRef,useState} from 'react';

export function ProPurchase({email,active,balance,cn,refresh}:{
  email:string;active:boolean;balance?:number;cn:boolean;refresh:()=>void
}){
  const t=(zh:string,en:string)=>cn?zh:en;
  const key='cshell.pro-purchase.'+email;
  const [pending,setPending]=useState(()=>localStorage.getItem(key));
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const lock=useRef(false);
  const insufficient=balance!==undefined&&balance<3990;
  async function purchase(){
    if(lock.current)return;
    lock.current=true;
    setBusy(true);
    try{
      const requestId=localStorage.getItem(key)??crypto.randomUUID();
      localStorage.setItem(key,requestId);
      setPending(requestId);
      const receipt=await window.cshell.cloudPurchasePro(email,requestId);
      localStorage.removeItem(key);
      setPending(null);
      setConfirm(false);
      setNotice(t('Pro 有效至 ','Pro valid until ')+new Date(receipt.expiresAt*1000).toLocaleDateString());
      refresh();
    }catch(error){
      if(String(error).includes('可用点数不足')){
        localStorage.removeItem(key);
        setPending(null);
        setConfirm(false);
        refresh();
      }
      setNotice(String(error).replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/,''));
    }finally{
      lock.current=false;
      setBusy(false);
    }
  }
  return <div className="wallet-purchase">
    {confirm||pending ? <>
      <small>{pending?t('正在核对上次购买，可重试确认结果。','Retry to confirm your previous purchase.'):t('扣除 3,990 点，Pro 有效期增加 30 天。','Spend 3,990 points for 30 more days of Pro.')}</small>
      <div><button type="button" disabled={busy} onClick={()=>void purchase()}>{pending?t('核对购买结果','Check purchase'):t('确认购买','Confirm purchase')}</button>
      {!pending&&<button type="button" disabled={busy} onClick={()=>setConfirm(false)}>{t('取消','Cancel')}</button>}</div>
    </>:<><button type="button" disabled={balance===undefined||insufficient} onClick={()=>{setNotice('');setConfirm(true);}}>{active?t('续费 Pro','Renew Pro'):t('开通 Pro','Get Pro')} · 3,990 {t('点','pts')}</button>
      {insufficient&&<small>{t('还差 ','Need ')+(3990-balance!).toLocaleString()+t(' 点',' more points')}</small>}</>}
    {notice&&<small role="status">{notice}</small>}
  </div>;
}
