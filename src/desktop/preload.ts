import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Bridge, SessionEvent } from '../shared/contracts';
const bridge: Bridge = {
  clientSetAccess: (options) => ipcRenderer.invoke('client:access', options),
  clientConnectionInfo: (host) => ipcRenderer.invoke('client:info', host),
  clientProbe: (endpoint) => ipcRenderer.invoke('client:probe', endpoint),
  clientPasswordPair: (info, password) =>
    ipcRenderer.invoke('client:password-pair', info, password),
  openRdp: (endpoint) => ipcRenderer.invoke('connection:rdp', endpoint),
  clientDownloadPage: () => ipcRenderer.invoke('client:download-page'),
  clientTheme: (theme) => ipcRenderer.invoke('client:theme', theme),
  clientDevices: () => ipcRenderer.invoke('client:devices'),
  clientPair: (invitation) => ipcRenderer.invoke('client:pair', invitation),
  clientForget: (id) => ipcRenderer.invoke('client:forget', id),
  clientConnect: (id, shell) => ipcRenderer.invoke('client:connect', id, shell),
  clientStatus: () => ipcRenderer.invoke('client:status'),
  clientStart: (options) => ipcRenderer.invoke('client:start', options),
  clientStop: () => ipcRenderer.invoke('client:stop'),
  clientInvite: (options) => ipcRenderer.invoke('client:invite', options),
  clientRevoke: (id) => ipcRenderer.invoke('client:revoke', id),
  activitySnapshot: () => ipcRenderer.invoke('activity:snapshot'),
  activityEnable: (enabled) => ipcRenderer.invoke('activity:enable', enabled),
  activityClear: () => ipcRenderer.invoke('activity:clear'),
  activityExport: (from, to, format) => ipcRenderer.invoke('activity:export', from, to, format),
  openFloating: (id, snapshot) => ipcRenderer.invoke('floating:open', id, snapshot),
  floatingInit: () => ipcRenderer.invoke('floating:init'),
  floatingInput: (data) => ipcRenderer.invoke('floating:input', data),
  floatingResize: (cols, rows) => ipcRenderer.invoke('floating:resize', cols, rows),
  floatingMode: (readOnly) => ipcRenderer.invoke('floating:mode', readOnly),
  floatingPin: (enabled) => ipcRenderer.invoke('floating:pin', enabled),
  floatingCopy: (text) => ipcRenderer.invoke('floating:copy', text),
  floatingPaste: () => ipcRenderer.invoke('floating:paste'),
  floatingClose: () => ipcRenderer.invoke('floating:close'),
  floatingRestore: () => ipcRenderer.invoke('floating:restore'),
  onFocusSession: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on('window:focus-session', handler);
    return () => ipcRenderer.removeListener('window:focus-session', handler);
  },
  onFloatingEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: SessionEvent) => listener(event);
    ipcRenderer.on('floating:event', handler);
    return () => ipcRenderer.removeListener('floating:event', handler);
  },
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:always-on-top', enabled),
  setMinimalMode: (enabled) => ipcRenderer.invoke('window:minimal', enabled),
  updateState: () => ipcRenderer.invoke('update:state'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  applicationCatalog: () => ipcRenderer.invoke('applications:catalog'),
  wslDistributions: () => ipcRenderer.invoke('local-terminal:wsl'),
  localTargets: () => ipcRenderer.invoke('local-terminal:targets'),
  wslAccountStatus: (name) => ipcRenderer.invoke('local-terminal:wsl-account', name),
  wslInitialize: (input) => ipcRenderer.invoke('local-terminal:wsl-initialize', input),
  wslInstall: (ubuntu) => ipcRenderer.invoke('local-terminal:wsl-install', ubuntu),
  wslInstallStatus: () => ipcRenderer.invoke('local-terminal:wsl-install-status'),
  localTerminal: (shell) => ipcRenderer.invoke('local-terminal:open', shell),
  localEnvironment: () => ipcRenderer.invoke('local-terminal:environment'),
  saveLocalEnvironment: (rows) => ipcRenderer.invoke('local-terminal:environment-save', rows),
  aiSnapshot: () => ipcRenderer.invoke('ai:snapshot'),
  aiProviderTest: (p, key) => ipcRenderer.invoke('ai:provider-test', p, key),
  onAiProvidersChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('ai:providers-changed', handler);
    return () => ipcRenderer.removeListener('ai:providers-changed', handler);
  },
  onAiThread: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, thread: import('../shared/ai').AiThread) =>
      listener(thread);
    ipcRenderer.on('ai:thread', handler);
    return () => ipcRenderer.removeListener('ai:thread', handler);
  },
  aiExtractConnection: (text, providerId) =>
    ipcRenderer.invoke('ai:extract-connection', text, providerId),
  aiProviderSave: (p, key) => ipcRenderer.invoke('ai:provider-save', p, key),
  aiProviderDelete: (id) => ipcRenderer.invoke('ai:provider-delete', id),
  onAiConnection: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: { sessionId: string; profile: import('../shared/contracts').Profile },
    ) => listener(value);
    ipcRenderer.on('ai:connected', handler);
    return () => ipcRenderer.removeListener('ai:connected', handler);
  },
  onMinimalHover: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => listener(value);
    ipcRenderer.on('window:minimal-hover', handler);
    return () => ipcRenderer.removeListener('window:minimal-hover', handler);
  },
  aiPolicySave: (p) => ipcRenderer.invoke('ai:policy', p),
  aiExtractionProviderSave: (id) => ipcRenderer.invoke('ai:extraction-provider', id),
  aiText: (input) => ipcRenderer.invoke('ai:text', input),
  aiTextProviderSave: (kind, id) => ipcRenderer.invoke('ai:text-provider', kind, id),
  aiPermissionSave: (p) => ipcRenderer.invoke('ai:permission', p),
  aiThreadCreate: (location, provider, mode, session) =>
    ipcRenderer.invoke('ai:create', location, provider, mode, session),
  aiThreadDelete: (id) => ipcRenderer.invoke('ai:delete', id),
  aiSend: (id, text) => ipcRenderer.invoke('ai:send', id, text),
  aiApprove: (id, request, allow) => ipcRenderer.invoke('ai:approve', id, request, allow),
  aiStop: (id) => ipcRenderer.invoke('ai:stop', id),
  aiMode: (id, mode) => ipcRenderer.invoke('ai:mode', id, mode),
  pythonReadFile: (id, path) => ipcRenderer.invoke('python:read', id, path),
  pythonSaveFile: (id, path, code, revision) =>
    ipcRenderer.invoke('python:save', id, path, code, revision),
  plugins: () => ipcRenderer.invoke('plugins:list'),
  pluginInstall: (id) => ipcRenderer.invoke('plugins:install', id),
  pluginToggle: (id, enabled) => ipcRenderer.invoke('plugins:toggle', id, enabled),
  pluginRemove: (id) => ipcRenderer.invoke('plugins:remove', id),
  pluginSource: () => ipcRenderer.invoke('plugins:source'),
  pluginCatalog: (url) => ipcRenderer.invoke('plugins:catalog', url),
  pluginDownload: (entry) => ipcRenderer.invoke('plugins:download', entry),
  environments: (id) => ipcRenderer.invoke('environments:list', id),
  environmentAction: (id, action) => ipcRenderer.invoke('environments:action', id, action),
  environmentTerminal: (id, conda, prefix) =>
    ipcRenderer.invoke('environments:terminal', id, conda, prefix),
  environmentPackages: (id, python) => ipcRenderer.invoke('environments:packages', id, python),
  pythonAnalyze: (id, python, code, line, column, path) =>
    ipcRenderer.invoke('python:analyze', id, python, code, line, column, path),
  applicationPlan: (id, request) => ipcRenderer.invoke('applications:plan', id, request),
  applicationInstall: (id) => ipcRenderer.invoke('applications:install', id),
  jobs: (id) => ipcRenderer.invoke('jobs:list', id),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', id),
  jupyterStatus: (id, python) => ipcRenderer.invoke('jupyter:status', id, python),
  jupyterStart: (id, python, port) => ipcRenderer.invoke('jupyter:start', id, python, port),
  jupyterStop: (id, python) => ipcRenderer.invoke('jupyter:stop', id, python),
  configureTools: (settings) => ipcRenderer.invoke('tools:configure', settings),
  dockerSnapshot: (id) => ipcRenderer.invoke('docker:snapshot', id),
  dockerStats: (id, container) => ipcRenderer.invoke('docker:stats', id, container),
  dockerDetails: (id, container) => ipcRenderer.invoke('docker:details', id, container),
  dockerAction: (id, action) => ipcRenderer.invoke('docker:action', id, action),
  config: () => ipcRenderer.invoke('config'),
  presets: () => ipcRenderer.invoke('presets:list'),
  savePreset: (name, preferences) => ipcRenderer.invoke('presets:save', name, preferences),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),
  exportPreset: (preferences) => ipcRenderer.invoke('presets:export', preferences),
  importPreset: () => ipcRenderer.invoke('presets:import'),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpConfigure: (settings) => ipcRenderer.invoke('mcp:configure', settings),
  mcpCopyToken: () => ipcRenderer.invoke('mcp:copy-token'),
  mcpRotateToken: () => ipcRenderer.invoke('mcp:rotate-token'),
  systemFonts: () => ipcRenderer.invoke('appearance:fonts'),
  importAppearance: (kind, token) => ipcRenderer.invoke('appearance:import', kind, token),
  appearanceData: (id) => ipcRenderer.invoke('appearance:data', id),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  manageGroup: (action) => ipcRenderer.invoke('group:manage', action),
  preferences: (value) => ipcRenderer.invoke('preferences', value),
  pickKey: () => ipcRenderer.invoke('key:pick'),
  connect: (id, credentials) => ipcRenderer.invoke('connect', id, credentials),
  connectTemporary: (profile, credentials) =>
    ipcRenderer.invoke('connect:temporary', profile, credentials),
  disconnect: (id) => ipcRenderer.invoke('disconnect', id),
  input: (id, data) => ipcRenderer.invoke('input', id, data),
  acknowledge: (id, characters) => ipcRenderer.invoke('acknowledge', id, characters),
  resize: (id, cols, rows) => ipcRenderer.invoke('resize', id, cols, rows),
  list: (id, path) => ipcRenderer.invoke('list', id, path),
  fileAction: (id, action, path, destination) =>
    ipcRenderer.invoke('file:action', id, action, path, destination),
  upload: (id, path, tokens) => ipcRenderer.invoke('upload', id, path, tokens),
  download: (id, paths) => ipcRenderer.invoke('download', id, paths),
  cancelTransfer: (id) => ipcRenderer.invoke('transfer:cancel', id),
  chooseLocal: () => ipcRenderer.invoke('local:choose'),
  localList: (root, path) => ipcRenderer.invoke('local:list', root, path),
  localAction: (root, action, path, destination) =>
    ipcRenderer.invoke('local:action', root, action, path, destination),
  transferFiles: (sources, target, move) =>
    ipcRenderer.invoke('file:transfer', sources, target, move),
  monitor: (id) => ipcRenderer.invoke('monitor', id),
  resourceHardware: (id) => ipcRenderer.invoke('resources:hardware', id),
  resourceProcesses: (id) => ipcRenderer.invoke('resources:processes', id),
  droppedFiles: (files) =>
    files.map((file) => ipcRenderer.sendSync('drop:register', webUtils.getPathForFile(file))),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  pasteText: () => ipcRenderer.invoke('clipboard:read'),
  events: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SessionEvent) => listener(payload);
    ipcRenderer.on('session:event', handler);
    return () => ipcRenderer.removeListener('session:event', handler);
  },
};
contextBridge.exposeInMainWorld('cshell', bridge);
