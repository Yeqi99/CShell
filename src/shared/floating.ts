import type { Preferences, SessionEvent } from './contracts';
export interface TerminalSnapshot {
  data: string;
  sequence: number;
  cols: number;
  rows: number;
  theme: Record<string, string>;
}
export interface FloatingState {
  sessionId: string;
  label: string;
  snapshot: TerminalSnapshot;
  tail: Array<{ sequence: number; data: string }>;
  preferences: Preferences;
  readOnly: boolean;
  closed: boolean;
}
export interface FloatingBridge {
  openFloating(sessionId: string, snapshot: TerminalSnapshot): Promise<void>;
  floatingInit(): Promise<FloatingState>;
  floatingInput(data: string): Promise<void>;
  floatingResize(cols: number, rows: number): Promise<void>;
  floatingMode(readOnly: boolean): Promise<void>;
  floatingPin(enabled: boolean): Promise<boolean>;
  floatingCopy(text: string): Promise<void>;
  floatingPaste(): Promise<string>;
  floatingClose(): Promise<void>;
  floatingRestore(): Promise<void>;
  onFocusSession(listener: (id: string) => void): () => void;
  onFloatingEvent(listener: (event: SessionEvent) => void): () => void;
}
