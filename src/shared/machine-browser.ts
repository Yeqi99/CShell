export type BrowserTab = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  zoom: number;
  back: boolean;
  forward: boolean;
  error?: string;
  fullscreen?:boolean;
};
export type BrowserEntry={url:string;title:string;at:string};
export type MachineBrowserState = { tabs: BrowserTab[]; selected: string; connected: boolean; history?:BrowserEntry[]; bookmarks?:BrowserEntry[]; persistenceError?:string };
export interface MachineBrowserBridge {
  machineBrowser(id: string, action: string, value?: unknown): Promise<MachineBrowserState>;
  onMachineBrowserFocus(listener: (id: string) => void): () => void;
}
