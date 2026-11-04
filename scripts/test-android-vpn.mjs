import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const output=resolve('.local/vpn-test');mkdirSync(output,{recursive:true});
const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
function run(name,args){const result=spawnSync(bin(name),args,{stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error(`${name} failed`);}
run('javac',['-d',output,'android/app/src/main/java/org/canpshell/mobile/AndroidVpnSocks.java','android/app/src/test/java/org/canpshell/mobile/AndroidVpnSocksTest.java']);
run('java',['-cp',output,'org.canpshell.mobile.AndroidVpnSocksTest']);
