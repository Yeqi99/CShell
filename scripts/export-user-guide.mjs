import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('services/portal/docs');
const destination=path.resolve(process.argv[2]??'docs/manual');
await fs.mkdir(destination,{recursive:true});
const entries=[];
for(const name of (await fs.readdir(root)).filter(n=>n.endsWith('.html')).sort()){
 const source=await fs.readFile(path.join(root,name),'utf8');
 const article=/<article[^>]*>([\s\S]*?)<\/article>/.exec(source)?.[1];
 if(!article)throw Error('Missing article '+name);
 const title=/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(article)?.[1];
 if(!title)throw Error('Missing title '+name);
 const body=article.replace(/^[\s\S]*?<\/h1>/,'').replace(/<div class="doc-bottom">[\s\S]*$/,'')
 .replace(/href="(?!https?:|#)([^"]+)"/g,(_,url)=>`href="https://shell.canp.ai${url.startsWith('/')?url:'/docs/'+url}"`)
 .replace(/<h2 /g,'\n\n<h2 ').replace(/<\/h2>/g,'</h2>\n').replace(/<\/p>/g,'</p>\n');
 await fs.writeFile(path.join(destination,name.replace('.html','.md')),`# ${title}\n\n[在线阅读与全文搜索](https://shell.canp.ai/docs/${name})\n\n<!-- Derived from services/portal/docs/${name}; edit the portal source then export. -->\n\n${body}\n`);
 entries.push(`- [${title}](${name.replace('.html','.md')})`);
}
await fs.writeFile(path.join(destination,'README.md'),'# CShell 使用手册\n\n按任务查找：[文档首页](https://shell.canp.ai/docs/start.html)。网页提供正文搜索、章节导航和移动端目录。以下内容由官网同一份源文档导出，开源与 Pro 的适用范围在各页明确说明。\n\n'+entries.join('\n')+'\n');
console.log(`Exported ${entries.length} manuals to ${destination}`);
