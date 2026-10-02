"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";

type Tip = { x: number; y: number; body: ReactNode } | null;

/** Hover card for the capacity charts: an HTML tooltip positioned inside the
 *  chart's relative wrapper, flipped left near the right edge so it never
 *  pushes the page sideways. Marks call show(event, body) / hide(). */
export function useChartTip() {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = useCallback((e: React.PointerEvent | React.FocusEvent, body: ReactNode) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    let x: number, y: number;
    if ("clientX" in e) {
      x = e.clientX - box.left; y = e.clientY - box.top;
    } else {
      const r = (e.target as Element).getBoundingClientRect();
      x = r.left + r.width / 2 - box.left; y = r.top + r.height / 2 - box.top;
    }
    setTip({ x, y, body });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip && (
    <div className="cap-tip" role="status"
      style={{
        left: tip.x, top: tip.y,
        transform: `translate(${tip.x > (wrap.current?.clientWidth ?? 0) * 0.6 ? "calc(-100% - 14px)" : "14px"}, -50%)`,
      }}>
      {tip.body}
    </div>
  );
  return { wrap, show, hide, node };
}
