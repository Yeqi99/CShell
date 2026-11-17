import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildManagedWechatManifest} from '../../src/agent/managed-wechat-capability';
const [folder,out]=process.argv.slice(2);
const runtime=JSON.parse(readFileSync(join(folder,'manifest.json'),'utf8'));
const version='0.3.0', releaseTag='wechat-toolkit-v'+version,repository='https://github.com/Yeqi99/CShell';
const manifest=buildManagedWechatManifest({wechatVersion:runtime.wechatVersion,version,methods:runtime.exposedMethods,source:{repository,releaseTag,assetUrl:repository+'/releases/download/'+releaseTag+'/Weixin-'+runtime.wechatVersion+'-'+version+'.cagent-package.json'},files:[{path:'WeixinToolkit.exe',bytes:0,sha256:runtime.files['WeixinToolkit.exe']}]});
writeFileSync(out,JSON.stringify(manifest));


