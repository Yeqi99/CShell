// A review heuristic, not a sandbox: command execution always requires explicit control scope.
export function commandNeedsReview(command: string) {
  return (
    /[\n\r;&|`$><(){}]/.test(command) ||
    /(?:^|\s)(?:sudo|su|doas|rm|rmdir|mv|dd|mkfs\S*|fdisk|parted|shred|chmod|chown|chgrp|mount|umount|shutdown|reboot|poweroff|kill\S*|pkill|killall|systemctl|service|apt\S*|yum|dnf|pacman|pip\S*|conda|npm|pnpm|curl|wget|ssh|scp|rsync|bash|sh|zsh|fish|python\S*|perl|ruby|node|eval|exec|source|\.)(?:\s|$)/i.test(
      command,
    ) ||
    /\b(?:docker|podman|kubectl|git|find|xargs|sed|awk|tee|truncate|touch|mkdir)\b/.test(command)
  );
}
