import fs from 'node:fs/promises';
import path from 'node:path';
// Portal HTML is the editable source. Never regenerate it from stale release copy.
const root = path.resolve('services/portal');
const pages = ['index.html', 'downloads.html', ...(await fs.readdir(path.join(root, 'docs'))).filter(name => name.endsWith('.html')).map(name => 'docs/' + name)];
for (const name of pages) {
  const html = await fs.readFile(path.join(root, name), 'utf8');
  if (!/<html\b/i.test(html) || !/<h1\b/i.test(html)) throw new Error('Invalid portal page: ' + name);
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*\.html)(?:[?#][^"]*)?"/g)) {
    await fs.access(path.join(root, href));
  }
}
console.log(`Validated ${pages.length} portal pages; deploy services/portal directly.`);
// Search data is derived from the same editable articles, never maintained separately.
const plain = value => value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const sections=[];
for(const name of pages.filter(p=>p.startsWith('docs/'))){
 const html=await fs.readFile(path.join(root,name),'utf8');
 const article=/<article[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1];
 if(!article)throw Error('Missing article: '+name);
 const title=plain(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(article)?.[1]??'');
 for(const m of article.matchAll(/<h2[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/g))sections.push({title,heading:plain(m[2]),text:plain(m[3]),url:'/'+name+'#'+m[1]});
}
await fs.writeFile(path.join(root,'docs-index.json'),JSON.stringify(sections));
console.log(`Indexed ${sections.length} documentation sections.`);
