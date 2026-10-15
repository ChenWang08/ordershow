"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function CollapsibleScreenHeader({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mouseDetected, setMouseDetected] = useState(false);
  const id = useId();
  const region = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);

  function cancel() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function scheduleClose() {
    cancel();
    timer.current = setTimeout(() => {
      if (!hovered.current && !region.current?.contains(document.activeElement)) setOpen(false);
    }, 500);
  }

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    function detectMouse(event: PointerEvent) {
      if (event.pointerType === "mouse") setMouseDetected(true);
    }
    window.addEventListener("pointermove", detectMouse, { passive: true });
    return () => window.removeEventListener("pointermove", detectMouse);
  }, []);

  return <div className="screen-header" data-open={open} data-mouse={mouseDetected}>
    <div className="screen-header-hover-zone" aria-hidden="true"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        hovered.current = true;
        cancel();
        timer.current = setTimeout(() => setOpen(true), 120);
      }}
      onPointerLeave={() => { hovered.current = false; scheduleClose(); }}
    />
    <button ref={trigger} type="button" className="screen-header-trigger"
      aria-label={open ? "收起顶部栏" : "展开顶部栏"} aria-expanded={open} aria-controls={id}
      onClick={() => { cancel(); setOpen(!open); }}
    ><span aria-hidden="true">{open ? "⌃" : "⌄"}</span></button>
    <div ref={region} id={id} className="screen-header-panel" inert={!open}
      onPointerEnter={() => { hovered.current = true; cancel(); }}
      onPointerLeave={() => { hovered.current = false; scheduleClose(); }}
      onFocusCapture={cancel}
      onBlurCapture={scheduleClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel();
          trigger.current?.focus();
          setOpen(false);
        }
      }}
    >{children}</div>
  </div>;
}
