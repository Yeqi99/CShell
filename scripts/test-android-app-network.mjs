import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const output=resolve('.local/android-app-network-test');mkdirSync(output,{recursive:true});
const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
for(const [name,args] of [['javac',['-d',output,'android/app/src/main/java/org/canpshell/mobile/AndroidAppNetwork.java','android/app/src/test/java/org/canpshell/mobile/AndroidAppNetworkTest.java']],['java',['-cp',output,'org.canpshell.mobile.AndroidAppNetworkTest']]]){
 const r=spawnSync(bin(name),args,{stdio:'inherit',windowsHide:true});if(r.status!==0)throw Error(`${name} failed`);
}
