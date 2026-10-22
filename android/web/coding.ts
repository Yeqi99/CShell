import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CodingApp } from '../../src/ui/components/CodingApp';
import { AgentApplications } from '../../src/ui/components/AgentApplications';
import type { AgentCall } from '../../src/shared/agent';
type Bridge = {
  machineRequest?: (json: string) => void;
  browserOpen?: (id: string, name: string, url: string) => void;
};
export class MobileCoding {
  private root = document.createElement('section');
  private panels = new Map<
    string,
    { node: HTMLElement; root: Root; render: (active: boolean) => void }
  >();
  private current = '';
  private pending = new Map<
    string,
    {
      target: string;
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private bridge: Bridge,
    private changed?: (
      target: string,
      apps: { codex: boolean; claude: boolean; ide: boolean },
    ) => void,
  ) {
    this.root.className = 'mobile-coding';
    this.root.hidden = true;
    document.body.append(this.root);
  }
  get visible() {
    return !this.root.hidden;
  }
  close() {
    this.root.hidden = true;
    this.panels.get(this.current)?.render(false);
  }
  receive(target: string, json: string) {
    try {
      const v = JSON.parse(json),
        p = this.pending.get(v.request);
      if (!p || p.target !== target) return;
      this.pending.delete(v.request);
      clearTimeout(p.timer);
      if (v.error) p.reject(Error(v.error));
      else p.resolve(v.result);
    } catch {}
  }
  private call(target: string, method: AgentCall['method'], params?: unknown) {
    return new Promise<unknown>((resolve, reject) => {
      const request = crypto.randomUUID(),
        timer = setTimeout(() => {
          this.pending.delete(request);
          reject(Error('机器应用响应超时'));
        }, 35000);
      this.pending.set(request, { target, resolve, reject, timer });
      this.bridge.machineRequest?.(
        JSON.stringify({ request, session: target, method, params: params ?? {} }),
      );
    });
  }
  open(target: string, name: string, engine: 'codex' | 'claude' | 'market', openIde?: () => void) {
    const key = target + ':' + engine;
    this.panels.get(this.current)?.render(false);
    for (const p of this.panels.values()) p.node.hidden = true;
    this.current = key;
    this.root.hidden = false;
    if (!this.panels.has(key)) {
      const node = document.createElement('div');
      node.className = 'mobile-coding-panel';
      const header = document.createElement('header'),
        back = document.createElement('button');
      back.textContent = '‹ 返回机器';
      back.onclick = () => this.close();
      const label = document.createElement('strong');
      label.textContent = name;
      header.append(back, label);
      const body = document.createElement('div');
      body.className = 'mobile-coding-body';
      node.append(header, body);
      this.root.append(node);
      const root = createRoot(body);
      const call = (method: AgentCall['method'], params?: unknown) =>
        this.call(target, method, params);
      const render = (active: boolean) =>
        root.render(
          engine === 'market'
            ? React.createElement(AgentApplications, {
                call,
                target: { id: target, name, local: false, available: true },
                nativeCapabilities: false,
                onDevelopmentChanged: () => {
                  void this.call(target, 'coding.status')
                    .then((value: any) => {
                      const ready = (engine: string) =>
                        !!value.engines?.some((e: any) => e.engine === engine && e.ready);
                      return this.call(target, 'ide.status').then((ide: any) =>
                        this.changed?.(target, {
                          codex: ready('codex'),
                          claude: ready('claude'),
                          ide: !!ide.ready,
                        }),
                      );
                    })
                    .catch(() => {});
                },
                onDevelopmentOpen: (id: string) => {
                  if (id === 'ide') {
                    this.close();
                    openIde?.();
                  } else this.open(target, name, id as 'codex' | 'claude');
                },
              })
            : React.createElement(CodingApp, {
                engine,
                name,
                call,
                active,
                onManage: () => this.open(target, name, 'market', openIde),
                openBrowser: async (url: string) => this.bridge.browserOpen?.(target, name, url),
              }),
        );
      this.panels.set(key, { node, root, render });
    }
    const p = this.panels.get(key)!;
    p.node.hidden = false;
    p.render(true);
  }
}
