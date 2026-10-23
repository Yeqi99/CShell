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
