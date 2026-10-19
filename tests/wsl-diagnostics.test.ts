import {test} from 'node:test';import assert from 'node:assert/strict';
import {wslGuidance,wslInstallArgs} from '../src/agent/wsl-diagnostics';
test('WSL plans use argument arrays, no distro launch or reboot and reject shell syntax',()=>{
 assert.deepEqual(wslInstallArgs('Ubuntu-24.04',true),['--install','--distribution','Ubuntu-24.04','--no-launch','--web-download']);
 assert.deepEqual(wslInstallArgs('Ubuntu',true,true),['--update','--web-download']);
 for(const name of ['Ubuntu;shutdown','-d','Ubuntu\nDebian','$(whoami)','../Ubuntu'])assert.throws(()=>wslInstallArgs(name,true));
});
test('WSL distinguishes virtualization, kernel, permission and download failures',()=>{
 assert.match(wslGuidance('0x80370102')[0],/嵌套虚拟化/);assert.match(wslGuidance('0x800701bc')[0],/内核/);assert.match(wslGuidance('0x80070005')[0],/管理员/);assert.match(wslGuidance('0x80072efd')[0],/网络/);assert.deepEqual(wslGuidance('installation completed'),[]);
});
