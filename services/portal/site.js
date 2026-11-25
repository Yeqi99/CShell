const systems={"windows":{"name":"Windows","arch":"x64 · Windows 10 / 11","format":"EXE 安装程序","text":"独立安装 CShell Pro，登录后同步连接、模型和设置。可与开源版并存。","url":"/downloads/pro/v1.2.1/CShell-Pro-1.2.1-win-x64.exe","button":"下载 Windows Pro","status":"1.2.1"},"android":{"name":"Android","arch":"Android 10 及以上","format":"签名 APK","text":"在手机上访问机器、终端和文件。移动端采用独立交互，不包含全部桌面扩展。","url":"/downloads/pro/v1.0.10/CShell-Pro-1.0.10-android.apk","button":"下载 Android Pro","status":"1.0.10"},"macos":{"name":"macOS","arch":"Apple Silicon / Intel","format":"DMG 磁盘映像","text":"Pro 安装包已提供。请选择与你的 Mac 匹配的架构；尚未完成实体设备验收，未做 Apple 公证。","status":"1.0.11 · 未公证","button":"下载 macOS Pro","url":"/downloads/pro/v1.0.11/CShell-Pro-1.0.11-mac-arm64.dmg","variants":[["Apple Silicon · ARM64","/downloads/pro/v1.0.11/CShell-Pro-1.0.11-mac-arm64.dmg"],["Intel · x64","/downloads/pro/v1.0.11/CShell-Pro-1.0.11-mac-x64.dmg"]]},"linux":{"name":"Linux","arch":"x64 / ARM64","format":"AppImage / DEB","text":"Pro 安装包已提供。选择处理器架构及安装格式；尚未完成发行版与实体设备兼容性验收。","status":"1.0.11 · 未实机验证","button":"下载 Linux Pro","url":"/downloads/pro/v1.0.11/CShell-Pro-1.0.11-linux-x86_64.AppImage","variants":[["x64 · AppImage","/downloads/pro/v1.0.11/CShell-Pro-1.0.11-linux-x86_64.AppImage"],["ARM64 · AppImage","/downloads/pro/v1.0.11/CShell-Pro-1.0.11-linux-arm64.AppImage"],["x64 · Debian / Ubuntu","/downloads/pro/v1.0.11/CShell-Pro-1.0.11-linux-amd64.deb"],["ARM64 · Debian / Ubuntu","/downloads/pro/v1.0.11/CShell-Pro-1.0.11-linux-arm64.deb"]]}};
function selectSystem(id,focus=false){const item=systems[id];if(!item)return;document.querySelectorAll('[data-system]').forEach(b=>{const selected=b.dataset.system===id;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;if(selected&&focus)b.focus()});for(const key of ['name','arch','format','text','status'])document.querySelector('[data-field="'+key+'"]').textContent=item[key];const link=document.querySelector('[data-field="download"]');link.href=item.url;link.textContent=item.button;const variants=document.querySelector('#download-variant');variants.replaceChildren();variants.parentElement.hidden=!item.variants;for(const [label,url] of item.variants||[]){const option=document.createElement('option');option.textContent=label;option.value=url;variants.append(option)}variants.onchange=()=>{link.href=variants.value};document.querySelector('[data-field="guide"]').href='/docs/'+id+'.html';document.querySelector('#device-panel').setAttribute('aria-labelledby','tab-'+id)}
document.querySelectorAll('[data-system]').forEach(b=>{b.addEventListener('click',()=>selectSystem(b.dataset.system));b.addEventListener('keydown',e=>{const keys=Array.from(document.querySelectorAll('[data-system]')).map(el=>el.dataset.system);let i=keys.indexOf(b.dataset.system);if(e.key==='ArrowRight')i=(i+1)%4;else if(e.key==='ArrowLeft')i=(i+3)%4;else if(e.key==='Home')i=0;else if(e.key==='End')i=3;else return;e.preventDefault();selectSystem(keys[i],true)})});
if(document.querySelector('#device-panel')){const ua=navigator.userAgent;selectSystem(/Android/i.test(ua)?'android':/Macintosh/i.test(ua)?'macos':/Linux/i.test(ua)?'linux':'windows')}

async function refreshDownloadLinks() {
  const response = await fetch('/downloads/pro/releases.json', { cache: 'no-cache' });
  if (!response.ok) return;
  const releases = await response.json();
  const newest = new Map();
  for (const release of releases) {
    if (release.draft || release.prerelease || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(release.tag_name)) continue;
    const version = release.tag_name.slice(1);
    const prefix = 'CShell-Pro-' + version + '-';
    for (const asset of release.assets || []) {
      if (!asset.name.startsWith(prefix) || !/^[a-zA-Z0-9._-]+$/.test(asset.name)) continue;
      const platform = asset.name.slice(prefix.length);
      const path = '/downloads/pro/' + release.tag_name + '/' + asset.name;
      if (!newest.has(platform) && new URL(asset.browser_download_url, location.origin).href === location.origin + path) {
        newest.set(platform, path);
      }
    }
  }
  const resolve = path => newest.get(path.split('/').pop().replace(/^CShell-Pro-[0-9.]+-/, '')) || path;
  const active = document.querySelector('[data-system][aria-selected="true"]')?.dataset.system;
  const variants = document.querySelector('#download-variant');
  const selected = variants.selectedIndex;
  for (const item of Object.values(systems)) {
    item.url = resolve(item.url);
    item.status = item.status.replace(/^[0-9.]+/, item.url.split('/')[3].slice(1));
    for (const variant of item.variants || []) variant[1] = resolve(variant[1]);
  }
  selectSystem(active);
  if (selected >= 0 && selected < variants.options.length) {
    variants.selectedIndex = selected;
    variants.onchange();
  }
}
if (document.querySelector('#device-panel')) refreshDownloadLinks().catch(() => {});