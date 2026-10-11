import type { FileRef } from '../shared/contracts';
// App-internal file clipboard. This intentionally does not impersonate OS file clipboard formats.
let clipboard: FileRef[] = [];
let drag: FileRef[] = [];
export const fileDragType = 'application/x-canpshell-files';
export function copyFiles(files: FileRef[]) {
  clipboard = files;
}
export function pastedFiles() {
  return clipboard;
}
export function dragFiles(files: FileRef[]) {
  drag = files;
}
export function draggedFiles() {
  return drag;
}
export function filesChanged() {
  window.dispatchEvent(new Event('cshell:files-changed'));
}
