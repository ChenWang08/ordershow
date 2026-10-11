/** Follow keyboard/browser chrome changes without disabling pinch-to-zoom. */
export function trackH5Viewport(shell: HTMLElement, host: Window = window) {
  const viewport = host.visualViewport;
  const doc = shell.ownerDocument;
  let restingHeight = viewport?.height ?? host.innerHeight;
  const sync = () => {
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const focused = doc?.activeElement;
    const editing = !!focused && shell.contains(focused) && focused.matches('input, textarea, [contenteditable="true"]');
    const height = viewport?.height ?? host.innerHeight;
    if (!editing) restingHeight = Math.max(height, host.innerHeight);
    const keyboardOpen = editing && restingHeight - height > 80;
    shell.style.setProperty("--h5-viewport-height", `${viewport?.height ?? host.innerHeight}px`);
    // iOS rubber-band scrolling also changes offsetTop. Do not move the shell
    // with ordinary gestures; only follow a focused input's keyboard pan.
    shell.style.setProperty("--h5-viewport-top", `${keyboardOpen ? Math.max(0, viewport?.offsetTop ?? 0) : 0}px`);
    shell.toggleAttribute("data-compact-viewport", (viewport?.height ?? host.innerHeight) < 360);
  };
  sync();
  viewport?.addEventListener("resize", sync);
  viewport?.addEventListener("scroll", sync);
  host.addEventListener("resize", sync);
  doc?.addEventListener("focusin", sync);
  doc?.addEventListener("focusout", sync);
  return () => {
    viewport?.removeEventListener("resize", sync);
    viewport?.removeEventListener("scroll", sync);
    host.removeEventListener("resize", sync);
    doc?.removeEventListener("focusin", sync);
    doc?.removeEventListener("focusout", sync);
  };
}
