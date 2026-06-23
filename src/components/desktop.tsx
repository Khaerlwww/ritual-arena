import { Minus, Square, X, type LucideIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type WinId = string;

export type WinMeta = {
  id: WinId;
  title: string;
  icon: LucideIcon;
  x: number;
  y: number;
  w: number;
  /** Intended (minimum) window height in px. Clamped to the screen at render time. */
  h: number;
  open?: boolean;
};

export type WinState = {
  id: WinId;
  title: string;
  x: number;
  y: number;
  w: number;
  /** Intended (minimum) window height in px. Clamped to the screen at render time. */
  h: number;
  open: boolean;
  min: boolean;
  max: boolean;
  /** When true the window auto-centers in the desktop until the user drags it. */
  centered: boolean;
};

export type Bounds = { w: number; h: number };

/** Lightweight window manager: open/close/min/max/move + z-order focus. */
export function useWindows(init: WinMeta[]) {
  const [wins, setWins] = useState<Record<WinId, WinState>>(() => {
    const o: Record<WinId, WinState> = {};
    for (const w of init) o[w.id] = { id: w.id, title: w.title, x: w.x, y: w.y, w: w.w, h: w.h, open: w.open ?? true, min: false, max: false, centered: true };
    return o;
  });
  const [order, setOrder] = useState<WinId[]>(() => init.map((w) => w.id));

  const focus = useCallback((id: WinId) => {
    setOrder((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((x) => x !== id), id]));
  }, []);

  const open = useCallback(
    (id: WinId) => {
      // Single-window mode: opening a window closes every other one so they never
      // stack/overlap. The opened window is (re)centered so it lands on-screen.
      setWins((p) => {
        const o: Record<WinId, WinState> = {};
        for (const key in p) {
          o[key] =
            key === id
              ? { ...p[key], open: true, min: false, centered: true }
              : { ...p[key], open: false, max: false };
        }
        return o;
      });
      focus(id);
    },
    [focus],
  );

  const close = useCallback((id: WinId) => {
    setWins((p) => ({ ...p, [id]: { ...p[id], open: false, max: false } }));
  }, []);

  const toggleMin = useCallback((id: WinId) => {
    setWins((p) => ({ ...p, [id]: { ...p[id], min: !p[id].min } }));
  }, []);

  const toggleMax = useCallback((id: WinId) => {
    setWins((p) => ({ ...p, [id]: { ...p[id], max: !p[id].max } }));
  }, []);

  const move = useCallback((id: WinId, x: number, y: number) => {
    // Any explicit move (drag) pins the window and stops auto-centering.
    setWins((p) => ({ ...p, [id]: { ...p[id], x, y, centered: false } }));
  }, []);

  const minimizeAll = useCallback(() => {
    setWins((p) => {
      const o = { ...p };
      for (const id in o) o[id] = { ...o[id], min: true };
      return o;
    });
  }, []);

  const closeAll = useCallback(() => {
    setWins((p) => {
      const o = { ...p };
      for (const id in o) o[id] = { ...o[id], open: false, max: false };
      return o;
    });
  }, []);

  const topId = [...order].reverse().find((id) => wins[id]?.open && !wins[id]?.min);

  return { wins, order, focus, open, close, toggleMin, toggleMax, move, minimizeAll, closeAll, topId };
}

function WinCtrl({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="win-ctrl"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A draggable, focusable Win2000 window. Renders nothing when closed or minimized. */
export function DesktopWindow({
  st,
  z,
  active,
  icon,
  bounds,
  onFocus,
  onClose,
  onMin,
  onMax,
  onMove,
  children,
}: {
  st: WinState;
  z: number;
  active: boolean;
  icon?: ReactNode;
  bounds: Bounds;
  onFocus: () => void;
  onClose: () => void;
  onMin: () => void;
  onMax: () => void;
  onMove: (x: number, y: number) => void;
  children: ReactNode;
}) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const winRef = useRef<HTMLElement>(null);
  const [selfH, setSelfH] = useState(0);

  // Track the window's own height so it can be vertically centered accurately.
  useLayoutEffect(() => {
    const el = winRef.current;
    if (!el) return;
    const measure = () => setSelfH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [st.open, st.min]);

  const compact = bounds.w < 420;
  const marginX = compact ? 8 : 16;
  const marginY = compact ? 8 : 16;
  const minW = Math.min(280, Math.max(240, bounds.w - marginX * 2));

  // Fit the configured width to the available desktop area so larger windows
  // never overflow on small screens.
  const fitW = Math.max(minW, Math.min(st.w, bounds.w - marginX * 2));

  // Auto-center from a stable expected height first, then refine after the
  // ResizeObserver measures real content. This avoids the first-open jump where
  // selfH is still 0 and keeps mobile windows visually centered.
  const expectedH = Math.min(st.h, Math.max(220, bounds.h - marginY * 2));
  const measuredH = selfH > 0 ? Math.min(selfH, bounds.h - marginY * 2) : expectedH;
  const cx = Math.max(marginX, Math.round((bounds.w - fitW) / 2));
  const cy = Math.max(marginY, Math.round((bounds.h - measuredH) / 2));

  const startDrag = (e: React.PointerEvent) => {
    onFocus();
    if (st.max) return;
    const baseX = st.centered ? cx : st.x;
    const baseY = st.centered ? cy : st.y;
    drag.current = { dx: e.clientX - baseX, dy: e.clientY - baseY };
    const onMoveEv = (ev: PointerEvent) => {
      if (!drag.current) return;
      const nx = Math.min(Math.max(0, ev.clientX - drag.current.dx), Math.max(0, bounds.w - 120));
      const ny = Math.min(Math.max(0, ev.clientY - drag.current.dy), Math.max(0, bounds.h - 28));
      onMove(nx, ny);
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("pointermove", onMoveEv);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMoveEv);
    window.addEventListener("pointerup", onUp);
  };

  if (!st.open || st.min) return null;

  const style: React.CSSProperties = st.max
    ? { left: 4, top: 4, width: Math.max(280, bounds.w - 8), zIndex: z }
    : st.centered
      ? { left: cx, top: cy, width: fitW, zIndex: z }
      : { left: st.x, top: st.y, width: fitW, zIndex: z };

  const bodyMax = st.max ? bounds.h - 64 : bounds.h - (compact ? 230 : 96);
  // Keep each window's intended proportions via a min body height (target window
  // height minus the title-bar/frame chrome), but never taller than the screen.
  const minBodyH = st.max || compact ? undefined : Math.min(Math.max(st.h - 32, 0), Math.max(bodyMax, 0));

  return (
    <section
      ref={winRef}
      className="desktop-window win-open bevel-out absolute flex max-w-[calc(100vw-16px)] flex-col bg-wgray p-[3px]"
      style={style}
      onMouseDown={onFocus}
    >
      <div
        className={`flex items-center gap-2 px-1.5 py-[3px] ${active ? "title-grad" : "bg-wborder"}`}
        style={{ cursor: st.max ? "default" : "move" }}
        onPointerDown={startDrag}
        onDoubleClick={onMax}
      >
        {icon ? <span className="grid h-4 w-4 place-items-center text-ice">{icon}</span> : null}
        <span className={`flex-1 truncate font-ui text-[11px] font-bold tracking-wide sm:text-[12px] ${active ? "text-ice" : "text-coal"}`}>
          {st.title}
        </span>
        <div className="flex items-center gap-[3px]">
          <WinCtrl label="Minimize" onClick={onMin}>
            <Minus size={10} strokeWidth={4} />
          </WinCtrl>
          <WinCtrl label="Maximize" onClick={onMax}>
            <Square size={8} strokeWidth={4} />
          </WinCtrl>
          <WinCtrl label="Close" onClick={onClose}>
            <X size={10} strokeWidth={4} />
          </WinCtrl>
        </div>
      </div>
      <div
        className="desktop-window-body bevel-in no-scrollbar bg-coal p-2.5 text-ice sm:p-4"
        style={{ maxHeight: bodyMax > 160 ? bodyMax : undefined, minHeight: minBodyH, overflowY: "auto" }}
      >
        {children}
      </div>
    </section>
  );
}

export type MenuEntry =
  | { sep: true }
  | { label: string; onClick?: () => void; href?: string; external?: boolean; icon?: LucideIcon };

/** A beveled dropdown / Start menu list. */
export function MenuList({
  items,
  onPick,
  className = "",
  header,
}: {
  items: MenuEntry[];
  onPick: () => void;
  className?: string;
  header?: ReactNode;
}) {
  return (
    <div data-menu className={`bevel-out z-[60] min-w-[190px] bg-wgray p-[3px] ${className}`}>
      {header}
      <div className="bevel-in-thin bg-wgray py-1">
        {items.map((it, i) =>
          "sep" in it ? (
            <div key={`s${i}`} className="my-1 h-[2px] bevel-in-thin" />
          ) : it.href ? (
            <a
              key={it.label}
              href={it.href}
              target={it.external ? "_blank" : undefined}
              rel={it.external ? "noreferrer" : undefined}
              onClick={onPick}
              className="menu-row"
            >
              {it.icon ? <it.icon size={14} /> : <span className="w-[14px]" />}
              <span>{it.label}</span>
            </a>
          ) : (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                it.onClick?.();
                onPick();
              }}
              className="menu-row w-full text-left"
            >
              {it.icon ? <it.icon size={14} /> : <span className="w-[14px]" />}
              <span>{it.label}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
