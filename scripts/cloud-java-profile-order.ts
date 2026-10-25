import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const output=await mkdtemp(join(tmpdir(),'cshell-cloud-order-'));
const executable=(name:string)=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
try{
 execFileSync(executable('javac'),['-encoding','UTF-8','-d',output,'android/app/src/main/java/org/canpshell/mobile/CloudProfileOrder.java','android/app/src/test/java/org/canpshell/mobile/CloudProfileOrderTest.java'],{windowsHide:true,stdio:'inherit'});
 execFileSync(executable('java'),['-cp',output,'org.canpshell.mobile.CloudProfileOrderTest'],{windowsHide:true,stdio:'inherit'});
}finally{await rm(output,{recursive:true,force:true});}
