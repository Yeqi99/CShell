/** Keep a queued terminal activation subordinate to the user's newer focus intent. */
export function scheduleTerminalActivation(
  actions: { active(): boolean; fit(): void; focus(): void },
  frames = { request: requestAnimationFrame, cancel: cancelAnimationFrame },
) {
  const intendedFocus = document.activeElement;
  let cancelled = false;
  const frame = frames.request(() => {
    if (cancelled || !actions.active()) return;
    actions.fit();
    if (document.activeElement === intendedFocus || document.activeElement === document.body)
      actions.focus();
  });
  return () => { cancelled = true; frames.cancel(frame); };
}
