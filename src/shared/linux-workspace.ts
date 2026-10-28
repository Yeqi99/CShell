import {ideMethods} from './ide';
import {codingMethods} from './coding';
export type LinuxWorkspacePlan = {
  id: string;
  installed: boolean;
  platform: string;
  arch: string;
  user: string;
  installDirectory: string;
  diskInfo: string;
  steps: string[];
};
export interface LinuxWorkspaceBridge {
  nativeDesktopSetup(id:string,action:'inspect'|'start'|'install-start'|'stop'):Promise<{sessions?:{display:string}[];installed?:boolean;canInstall?:boolean;running?:boolean;socket:string;message?:string}>;
  nativeDesktopOpen(id:string,endpoint:{port:number}|{socket:string}):Promise<string>;
  nativeDesktopRead(id:string):Promise<Uint8Array|null>;
  nativeDesktopWrite(id:string,data:Uint8Array):Promise<void>;
  nativeDesktopClose(id:string):Promise<void>;
  linuxWorkspacePlan(id: string, directory?: string): Promise<LinuxWorkspacePlan>;
  linuxWorkspaceInstall(id: string, planId: string): Promise<import('./plugins').RemoteJob>;
  linuxWorkspaceJob(
    id: string,
    jobId: string,
    cancel?: boolean,
  ): Promise<import('./plugins').RemoteJob>;
}

export const linuxWorkspaceMethods = new Set([
  'network.probe','machine.snapshot',
  ...codingMethods,
  ...ideMethods,
  'client.status',
  'agent.shells',
  'files.roots',
  'files.list',
  'files.read',
  'files.action',
  'files.uploadStart',
  'files.uploadChunk',
  'files.uploadFinish',
  'files.uploadCancel',
  'visual.status',
  'visual.launch',
  'visual.frame',
  'visual.input',
  'visual.close',
  'applications.list',
  'applications.plan',
  'applications.install',
  'applications.status',
  'applications.cancel',
  'applications.policy',
  'packages.catalog',
  'packages.list',
]);
