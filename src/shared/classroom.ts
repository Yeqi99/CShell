export interface ClassroomScreen { id: string; name: string }
export interface ClassroomSource { id: string; label: string; address: string; lastSeen: number }
export interface ClassroomFrame { dataUrl: string; capturedAt: number }
export interface ClassroomStatus {
  supported: boolean;
  discovering: boolean;
  sharing: null | { id: string; label: string; screenId: string; port: number };
  sources: ClassroomSource[];
  error: string | null;
}
export interface ClassroomBridge {
  screens(): Promise<ClassroomScreen[]>;
  status(): Promise<ClassroomStatus>;
  start(options: { screenId: string; label: string }): Promise<ClassroomStatus>;
  stop(): Promise<ClassroomStatus>;
  setDiscovery(enabled: boolean): Promise<ClassroomStatus>;
  frame(sourceId: string): Promise<ClassroomFrame>;
}
