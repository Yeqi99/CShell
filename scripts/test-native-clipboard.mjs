import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
if(process.platform!=='win32')throw Error('Native clipboard acceptance requires Windows');
const compiler=process.env.CAGENT_NATIVE_CXX;
if(!compiler)throw Error('Set CAGENT_NATIVE_CXX to the checksum-verified LLVM-MinGW compiler');
const output=resolve('test-results/native-clipboard');await mkdir(output,{recursive:true});
const executable=resolve(output,'clipboard-isolated-test.exe');
function run(file,args){return new Promise((done,reject)=>{const child=spawn(file,args,{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(`${file} exited ${code}`)));});}
await run(compiler,['-std=c++17','-O2','-static','tests/desktop-clipboard-native.cpp','-o',executable,'-luser32','-lshell32','-lgdiplus','-lgdi32','-lole32','-luuid','-lwtsapi32']);
// The test creates its own Window Station and Desktop before touching any
// clipboard format. It must never access the user's WinSta0 clipboard.
await run(executable,[]);
