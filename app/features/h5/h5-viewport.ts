/** Follow keyboard/browser chrome changes without disabling pinch-to-zoom. */
export function trackH5Viewport(shell: HTMLElement, host: Window = window) {
  const viewport = host.visualViewport;
  const sync = () => {
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    shell.style.setProperty("--h5-viewport-height", `${viewport?.height ?? host.innerHeight}px`);
    shell.style.setProperty("--h5-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    shell.toggleAttribute("data-compact-viewport", (viewport?.height ?? host.innerHeight) < 360);
  };
  sync();
  viewport?.addEventListener("resize", sync);
  viewport?.addEventListener("scroll", sync);
  host.addEventListener("resize", sync);
  return () => {
    viewport?.removeEventListener("resize", sync);
    viewport?.removeEventListener("scroll", sync);
    host.removeEventListener("resize", sync);
  };
}
