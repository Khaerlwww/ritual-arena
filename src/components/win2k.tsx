import { Minus, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Classic minimize / maximize / close window controls (visual). */
export function WindowControls({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex items-center gap-[3px]">
      <span className="win-ctrl" aria-hidden>
        <Minus size={10} strokeWidth={4} />
      </span>
      <span className="win-ctrl" aria-hidden>
        <Square size={8} strokeWidth={4} />
      </span>
      <button type="button" className="win-ctrl" aria-label="Close" onClick={onClose}>
        <X size={10} strokeWidth={4} />
      </button>
    </div>
  );
}

/** A Windows-2000-style window: gray beveled frame, emerald title bar, sunken dark body. */
export function Win2kWindow({
  title,
  icon,
  children,
  bodyClass = "p-4",
  className = "",
  id,
  onClose,
  active = true,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
  className?: string;
  id?: string;
  onClose?: () => void;
  active?: boolean;
}) {
  return (
    <section id={id} className={`win-open bevel-out bg-wgray p-[3px] ${className}`}>
      <div
        className={`flex items-center gap-2 px-1.5 py-[3px] ${active ? "title-grad" : "bg-wborder"}`}
      >
        {icon ? <span className="grid h-4 w-4 place-items-center text-ice">{icon}</span> : null}
        <span className="flex-1 truncate font-ui text-[12px] font-bold tracking-wide text-ice">{title}</span>
        <WindowControls onClose={onClose} />
      </div>
      <div className={`bevel-in bg-coal text-ice ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** Sunken status-bar strip (bottom of windows). */
export function StatusBar({ children }: { children: ReactNode }) {
  return (
    <div className="bevel-in-thin mt-3 flex items-center gap-2 bg-coal px-2 py-1 font-mono text-[11px] text-aqua">
      {children}
    </div>
  );
}

/** Types a string out character-by-character, with a blinking caret. */
export function Typewriter({
  text,
  speed = 34,
  className = "",
  caret = true,
}: {
  text: string;
  speed?: number;
  className?: string;
  caret?: boolean;
}) {
  const [n, setN] = useState(0);
  const ref = useRef(text);
  ref.current = text;

  useEffect(() => {
    setN(0);
    const id = setInterval(() => {
      setN((p) => {
        if (p >= ref.current.length) {
          clearInterval(id);
          return p;
        }
        return p + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  return (
    <span className={className}>
      {text.slice(0, n)}
      {caret ? <span className="blink">▋</span> : null}
    </span>
  );
}
