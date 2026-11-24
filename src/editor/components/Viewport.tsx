import { useEffect, useRef } from "react";
import { draw } from "../../render/canvas2d/draw";
import { centerOn, toWorld, zoomAt, type View } from "../../render/canvas2d/view";
import { overlayLinks, triggerCells } from "../linkOverlay";
import { selectionSets, useEditor } from "../store";
import { cancelDrag, pointerDown, pointerHover, pointerMove, pointerUp, type PointerInfo } from "../tools";

export function fitView(width: number, height: number): View | null {
  const s = useEditor.getState();
  const cells = s.resolved.cells.filter((c) => c.pos.z === s.level);
  const list = cells.length ? cells : s.resolved.cells;
  if (!list.length) return null;
  const xs = list.map((c) => c.pos.x), ys = list.map((c) => c.pos.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs) + 1, minY = Math.min(...ys), maxY = Math.max(...ys) + 1;
  const zoom = Math.max(12, Math.min(64, Math.min((width - 80) / (maxX - minX), (height - 80) / (maxY - minY))));
  return { zoom, panX: width / 2 - ((minX + maxX) / 2) * zoom, panY: height / 2 - ((minY + maxY) / 2) * zoom };
}

export function Viewport() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0 });

  // Redraw whenever anything the renderer reads changes.
  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    let frame = 0;
    const render = () => {
      frame = 0;
      const s = useEditor.getState();
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, {
        map: s.resolved,
        level: s.level,
        view: s.view,
        width: size.current.w,
        height: size.current.h,
        ghostAbove: s.ghostAbove,
        ghostBelow: s.ghostBelow,
        showHeights: s.showHeights,
        hover: s.hover,
        hoverProp: s.hoverProp,
        selection: selectionSets(s.selection),
        problemCells: s.problemCells,
        links: overlayLinks(s),
        triggerCells: triggerCells(s.resolved),
        ...(s.preview && { preview: s.preview }),
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
    const ro = new ResizeObserver(() => {
      const r = wrap.current!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height };
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      render();
    });
    ro.observe(wrap.current!);
    const unsub = useEditor.subscribe(schedule);
    return () => { ro.disconnect(); unsub(); cancelAnimationFrame(frame); };
  }, []);

  // External focus requests (Problems panel, Levels panel) re-center the view.
  useEffect(() => useEditor.subscribe((s, prev) => {
    if (s.focusRequest && s.focusRequest !== prev.focusRequest) {
      s.setView(centerOn(s.view, size.current.w, size.current.h, s.focusRequest.x, s.focusRequest.y));
    }
  }), []);

  // Fit the map when a document without a saved view is loaded.
  useEffect(() => {
    const tryFit = () => {
      const s = useEditor.getState();
      if (!s.pendingFit || !size.current.w) return;
      const v = fitView(size.current.w, size.current.h);
      s.set({ pendingFit: false, ...(v && { view: v }) });
    };
    const ro = new ResizeObserver(tryFit);
    ro.observe(wrap.current!);
    const unsub = useEditor.subscribe((s, prev) => { if (s.pendingFit && !prev.pendingFit) tryFit(); });
    return () => { ro.disconnect(); unsub(); };
  }, []);

  // Pointer handling, including pan (middle button or space + drag) and wheel zoom.
  useEffect(() => {
    const cv = canvas.current!;
    let pan: { x: number; y: number; view: View } | null = null;
    let space = false;
    const info = (e: PointerEvent | MouseEvent): PointerInfo => {
      const r = cv.getBoundingClientRect();
      const w = toWorld(useEditor.getState().view, e.clientX - r.left, e.clientY - r.top);
      return { wx: w.x, wy: w.y, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      if (e.button === 1 || (e.button === 0 && space)) {
        pan = { x: e.clientX, y: e.clientY, view: useEditor.getState().view };
        cv.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }
      if (e.button === 0 || e.button === 2) pointerDown(info(e));
    };
    const move = (e: PointerEvent) => {
      if (pan) {
        const v = pan.view;
        useEditor.getState().setView({ ...v, panX: v.panX + e.clientX - pan.x, panY: v.panY + e.clientY - pan.y });
        return;
      }
      pointerMove(info(e));
    };
    const up = (e: PointerEvent) => {
      if (pan) { pan = null; cv.style.cursor = space ? "grab" : ""; return; }
      pointerUp(info(e));
    };
    const leave = () => pointerHover(null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const s = useEditor.getState();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        s.setView(zoomAt(s.view, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)));
      } else {
        s.setView({ ...s.view, panX: s.view.panX - e.deltaX });
      }
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        if (!space) { space = true; cv.style.cursor = "grab"; }
        e.preventDefault();
      }
      if (e.key === "Escape") { cancelDrag(); if (useEditor.getState().pick) useEditor.getState().set({ pick: null }); }
    };
    const keyup = (e: KeyboardEvent) => { if (e.code === "Space") { space = false; cv.style.cursor = ""; } };
    const ctxmenu = (e: Event) => e.preventDefault();
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("wheel", wheel, { passive: false });
    cv.addEventListener("contextmenu", ctxmenu);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("wheel", wheel);
      cv.removeEventListener("contextmenu", ctxmenu);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, []);

  const pick = useEditor((s) => s.pick);
  return (
    <div className={`viewport${pick ? " picking" : ""}`} ref={wrap}>
      <canvas ref={canvas} aria-label="2D level view" />
      {pick && (
        <div className="pick-banner" role="status">
          {pick.prompt} <span className="muted">Esc or right-click to cancel.</span>
          <button className="btn small" onClick={() => useEditor.getState().set({ pick: null })}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/** Fit the current level into the viewport (Home key / View menu). */
export function fitCurrent(): void {
  const el = document.querySelector(".viewport");
  if (!el) return;
  const r = el.getBoundingClientRect();
  const v = fitView(r.width, r.height);
  if (v) useEditor.getState().setView(v);
}
