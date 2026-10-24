import type { InstalledPlugin } from '../../shared/plugins';

// Trusted view adapters belong to plugins. The shell consumes this registry rather
// than reserving permanent navigation entries for individual languages/tools.
export const pluginViews = [
  { pluginId:'cshell.tavily',id:'tavily',title:'Tavily 搜索',titleEn:'Tavily Search' },
  { pluginId:'cshell.opencode',id:'opencode',title:'OpenCode',titleEn:'OpenCode' },
  { pluginId: 'cshell.wechat', id: 'wechat', title: '微信', titleEn: 'WeChat' },
  { pluginId: 'cshell.agent', id: 'agent', title: 'CAgent', titleEn: 'CAgent' },
  { pluginId: 'cshell.wsl', id: 'wsl', title: 'WSL Linux', titleEn: 'WSL Linux' },
  { pluginId: 'cshell.conda', id: 'environment', title: 'Anaconda', titleEn: 'Anaconda' },
  { pluginId: 'cshell.python', id: 'python', title: 'Python', titleEn: 'Python' },
] as const;
export function availablePluginViews(plugins: InstalledPlugin[]) {
  return pluginViews.filter((view) =>
    plugins.some((plugin) => plugin.enabled && plugin.manifest.id === view.pluginId),
  );
}
