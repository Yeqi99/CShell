/** CLI uses the existing authenticated local IPC updater; never accepts a package path or URL. */
export function updateCliRequest(args: string[]) {
  const [action, ...flags] = args;
  if (!['check', 'download', 'status', 'install'].includes(action ?? '') ||
      (action === 'install' ? flags.length !== 1 || flags[0] !== '--confirm' : flags.length !== 0))
    throw Error('用法：cagent update check|download|status；安装：cagent update install --confirm');
  return {method: 'update.' + action, params: action === 'install' ? {confirm: true} : {}};
}
