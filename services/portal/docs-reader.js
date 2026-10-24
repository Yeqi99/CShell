(() => {
 const input=document.querySelector('#doc-search'),article=document.querySelector('.doc-content');
 if(!input||!article)return;
 const panel=document.createElement('section');panel.className='doc-search-results';panel.hidden=true;panel.setAttribute('aria-label','文档搜索结果');
 const count=document.createElement('p');count.setAttribute('role','status');panel.append(count);
 const list=document.createElement('div');panel.append(list);input.after(panel);
 let indexPromise,sequence=0;
 const load=()=>indexPromise??=(fetch('/docs-index.json').then(r=>{if(!r.ok)throw Error();return r.json();}).catch(e=>{indexPromise=null;throw e;}));
 input.addEventListener('focus',()=>void load().catch(()=>{}));
 input.addEventListener('input',async()=>{
  const current=++sequence,q=input.value.trim().toLowerCase();panel.hidden=!q;list.replaceChildren();if(!q)return;count.textContent='正在查找…';
  try{
   const entries=await load();if(current!==sequence)return;
   const words=q.split(/\s+/).filter(Boolean);
   const matches=entries.map(e=>({...e,score:words.reduce((n,w)=>n+(e.heading.toLowerCase().includes(w)?5:0)+(e.title.toLowerCase().includes(w)?2:0),0)})).filter(e=>words.every(w=>(e.title+' '+e.heading+' '+e.text).toLowerCase().includes(w))).sort((a,b)=>b.score-a.score);
   count.textContent=matches.length?`找到 ${matches.length} 个相关章节`:'没有找到，试试功能名称或更短的关键词。';
   for(const e of matches){const a=document.createElement('a');a.href=e.url;const title=document.createElement('strong');title.textContent=e.heading;const context=document.createElement('small');context.textContent=e.title;const excerpt=document.createElement('span');const position=Math.max(0,e.text.toLowerCase().indexOf(words[0])-30);excerpt.textContent=(position?'…':'')+e.text.slice(position,position+110)+(e.text.length>position+110?'…':'');a.append(context,title,excerpt);list.append(a);}
  }catch{if(current===sequence)count.textContent='搜索暂时无法加载，可继续使用下方分类导航。';}
 });
 input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';input.dispatchEvent(new Event('input'));}if(e.key==='ArrowDown'){const a=list.querySelector('a');if(a){e.preventDefault();a.focus();}}});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();input.focus();input.select();}});
 const headings=[...article.querySelectorAll('h2[id]')];
 if(headings.length){const toc=document.createElement('nav');toc.className='doc-toc';toc.setAttribute('aria-label','本页目录');const title=document.createElement('strong');title.textContent='本页内容';toc.append(title);for(const h of headings){const a=document.createElement('a');a.href='#'+h.id;a.textContent=h.textContent;toc.append(a);}article.querySelector('h1').after(toc);}
})();
