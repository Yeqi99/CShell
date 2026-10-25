/**
 * xterm 6's DOM width cache lives inside its terminal helpers. When a workspace
 * is display:none, measuring returns zero and cannot be cached. Selection/blur
 * updates can still request DOM rows while the normal renderer is paused.
 * Keep only the aria-hidden measurement node in a laid-out, off-screen host.
 * Input, rendering, buffer ownership and the PTY remain untouched.
 */
export function isolateTerminalMeasurement(element: HTMLElement | undefined) {
  const measure = element?.querySelector<HTMLElement>('.xterm-width-cache-measure-container');
  if (!measure) return () => {};
  const document = measure.ownerDocument;
  const originalParent = measure.parentElement!;
  const host = document.createElement('div');
  host.dataset.cshellTerminalMeasurement = '';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
  // The width-cache node owns its font settings, including font changes. Keep
  // it attached even for a hidden tab so offsetWidth stays measurable.
  document.body.appendChild(host);
  host.appendChild(measure);
  return () => {
    if (measure.parentElement === host) originalParent.appendChild(measure);
    host.remove();
  };
}
