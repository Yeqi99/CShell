import {mkdir,readFile,writeFile,access} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const commit='0c6885060c27134d1bf6a26b1132b6c90f80e4a4';
const pins={'src/core':'d12ec5962cbb777e087015db6aa73374014dd82e','third-part/hev-task-system':'ded55c412b3951bc7decb5cb3b9135701e762998','third-part/lwip':'8115cd6150ab32500db3d4d8bd8ad7ec6648534c','third-part/yaml':'0c82efd10dc67b9e7f159d2c7f5d1dc3c1b5bc11'};
const source=resolve('.local/hev-socks5-tunnel'),ndk=process.env.ANDROID_NDK_HOME;if(!ndk)throw Error('ANDROID_NDK_HOME must reference Android NDK 27.3.13750724');
const properties=await readFile(join(ndk,'source.properties'),'utf8');if(!properties.includes('27.3.13750724'))throw Error('Unexpected NDK revision');
function run(bin,args,options={}){const r=spawnSync(bin,args,{stdio:'inherit',windowsHide:true,...options});if(r.status!==0)throw Error(`${bin} failed (${r.status})`);}
try{await access(join(source,'.git'));}catch{await mkdir(resolve('.local'),{recursive:true});run('git',['clone','--no-checkout','https://github.com/heiher/hev-socks5-tunnel.git',source]);run('git',['-C',source,'checkout','--detach',commit]);run('git',['-C',source,'submodule','update','--init','--recursive']);}
const rev=path=>spawnSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout.trim();if(rev(source)!==commit)throw Error('Tunnel source pin mismatch');for(const [path,pin]of Object.entries(pins))if(rev(join(source,path))!==pin)throw Error('Submodule pin mismatch: '+path);
for(const path of [source,...Object.keys(pins).map(p=>join(source,p))])run('git',['-C',path,'diff','--exit-code','HEAD','--']);
const notices=[];for(const path of ['LICENSE',...Object.keys(pins).map(p=>p+'/LICENSE')])notices.push(path+'\n'+await readFile(join(source,path),'utf8'));
await mkdir('android/app/src/main/assets',{recursive:true});await writeFile('android/app/src/main/assets/VPN_THIRD_PARTY_NOTICES.txt',notices.join('\n\n'));
const output=resolve('android/app/src/main/jniLibs');await mkdir(output,{recursive:true});
const args=[`NDK_PROJECT_PATH=${resolve('.local/hev-android')}`,`APP_BUILD_SCRIPT=${join(source,'Android.mk')}`,`NDK_APPLICATION_MK=${join(source,'Application.mk')}`,`NDK_LIBS_OUT=${output}`,`NDK_OUT=${resolve('.local/hev-android/obj')}`,'APP_MODULES=hev-socks5-tunnel','-j4'];
run(join(ndk,process.platform==='win32'?'ndk-build.cmd':'ndk-build'),args,{shell:process.platform==='win32'});
const files=[];for(const abi of ['armeabi-v7a','arm64-v8a','x86','x86_64']){const b=await readFile(join(output,abi,'libhev-socks5-tunnel.so'));if(b[0]!==127||b.toString('ascii',1,4)!=='ELF')throw Error('Invalid native library');files.push({abi,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await writeFile(join(output,'build-info.json'),JSON.stringify({commit,pins,ndk:'27.3.13750724',files},null,2)+'\n');console.log('Pinned VPN native libraries built for four Android ABIs');
