/** A desktop view can outlive the terminal's network socket, never its paired identity.
 * Initial binding must come from a real active connection, not a renderer device ID. */
export class DesktopTargets {
  private bindings = new Map<string, { target: string; deviceId: string; fingerprint: string }>();
  constructor(
    private readonly options: {
      active: (target: string) => { resourceId: string } | undefined;
      devices: () => { deviceId: string; fingerprint: string }[];
    },
  ) {}
  bind(id: string, target: string) {
    if (this.bindings.has(id)) throw new Error('桌面连接标识重复');
    if (target === 'local') {
      this.bindings.set(id, { target, deviceId: '', fingerprint: '' });
      return;
    }
    const active = this.options.active(target);
    const device = active && this.options.devices().find((d) => d.deviceId === active.resourceId);
    if (!device) throw new Error('请选择已连接并核对身份的 Agent');
    this.bindings.set(id, { target, deviceId: device.deviceId, fingerprint: device.fingerprint });
  }
  resolve(target: string) {
    const binding = [...this.bindings.values()].find((b) => b.target === target);
    const device = binding && this.options.devices().find((d) => d.deviceId === binding.deviceId);
    if (!device || device.fingerprint !== binding!.fingerprint)
      throw new Error('桌面目标已删除或身份已改变');
    return device.deviceId;
  }
  release(id: string) {
    this.bindings.delete(id);
  }
  stopTarget(target: string) {
    const ids = [...this.bindings].filter(([, b]) => b.target === target).map(([id]) => id);
    for (const id of ids) this.release(id);
    return ids;
  }
}
