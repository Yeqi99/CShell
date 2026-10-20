export function textCandidate(path: string) {
  // Unknown extensions are inspected by the bounded UTF-8 reader, not assumed binary.
  return !/\.(?:exe|dll|so|dylib|zip|gz|xz|7z|rar|tar|png|jpe?g|gif|webp|ico|pdf|mp[34]|wav|ogg|avi|mkv|mov|docx?|xlsx?|pptx?|woff2?|ttf|db|sqlite)$/i.test(path);
}

/** Only infer a single literal absolute operand, never shell expansion or options. */
export function editorFileFromCommand(command: string): string | null {
  const match = command.trim().match(/^(?:vim|nvim|vi|view|nano)\s+(?:'([^']+)'|"([^"$`\\]+)"|([^\s'"\\$`;&|<>]+))$/);
  const path = match && (match[1] || match[2] || match[3]);
  return path?.startsWith('/') && !/[\x00-\x1f]/.test(path) ? path : null;
}
