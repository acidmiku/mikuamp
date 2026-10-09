import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Disc3, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as api from "./bridge";
import { time, type Track } from "./types";
import { useClock, useSpectrum } from "./motion";

export const panelName =
  new URLSearchParams(location.search).get("panel") || "main";
export const isNative = api.native;
export type Panel = "library" | "equalizer" | "playlist" | "skins" | "visuals";

/** CSS zoom applied by the interface-scale setting. */
export function uiScale() {
  const shell = document.querySelector(".app-shell");
  return (shell && parseFloat(getComputedStyle(shell).zoom)) || 1;
}

export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Titlebar({
  title,
  meta,
  children,
  onClose,
}: {
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="window-title" data-tauri-drag-region>
        {title}
      </span>
      {meta && (
        <span className="window-meta" data-tauri-drag-region>
          {meta}
        </span>
      )}
      <span className="title-fill" data-tauri-drag-region />
      <div className="title-actions">
        {children}
        <IconButton
          label={`Close ${title.toLowerCase()}`}
          onClick={
            onClose ||
            (() => {
              if (isNative) void getCurrentWindow().close();
            })
          }
        >
          <X size={13} />
        </IconButton>
      </div>
    </header>
  );
}

export function Quality({ track }: { track?: Track }) {
  return (
    <span
      className={`quality quality-${track?.quality || "SQ"}`}
      title="LQ: lossy · SQ: lossless up to 1500 kbps · HR: lossless above 1500 kbps"
    >
      {track?.quality || "—"}
    </span>
  );
}

export function Cover({
  cover,
  title,
  className = "",
}: {
  cover: string | null | undefined;
  title: string;
  className?: string;
}) {
  return cover ? (
    <img
      className={`album-cover ${className}`}
      src={cover}
      alt={`${title} cover`}
    />
  ) : (
    <div
      className={`album-cover cover-placeholder ${className}`}
      aria-hidden="true"
    >
      <Disc3 strokeWidth={1} />
      <span>{title.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

/** LED spectrum; the motion loop eases each bar and drops its peak cap. */
export function Spectrum({
  bars,
  count = bars.length,
  className = "",
}: {
  bars: number[];
  count?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSpectrum(ref, bars);
  return (
    <div ref={ref} className={`spectrum ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i}>
          <i />
          <b />
        </span>
      ))}
    </div>
  );
}

/** Seek slider whose fill advances every frame between engine snapshots. */
export function SeekBar({
  position,
  playing,
  duration,
  onSeek,
}: {
  position: number;
  playing: boolean;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const clock = useClock(position, playing);
  const input = useRef<HTMLInputElement>(null);
  const pressed = useRef(false);
  const settledAt = useRef(0);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const el = input.current;
      // Leave the thumb where the user put it until the engine catches up.
      if (el && !pressed.current && performance.now() > settledAt.current) {
        const p = duration ? Math.max(0, Math.min(clock(), duration)) : 0;
        el.value = String(p);
        el.style.setProperty(
          "--progress",
          `${duration ? (p / duration) * 100 : 0}%`,
        );
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [clock, duration]);
  const release = () => {
    pressed.current = false;
    settledAt.current = performance.now() + 300;
  };
  return (
    <input
      ref={input}
      className="seek"
      type="range"
      aria-label="Seek"
      aria-valuetext={`${time(position)} of ${time(duration)}`}
      min="0"
      max={duration || 1}
      step="0.1"
      defaultValue={0}
      disabled={!duration}
      onPointerDown={() => (pressed.current = true)}
      onPointerUp={release}
      onPointerCancel={release}
      onChange={(e) => {
        const value = +e.currentTarget.value;
        settledAt.current = performance.now() + 300;
        e.currentTarget.style.setProperty(
          "--progress",
          `${duration ? (value / duration) * 100 : 0}%`,
        );
        onSeek(value);
      }}
    />
  );
}

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | "divider";

/** Context menu anchored at a viewport point, kept inside the window. */
export function Menu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: 0, top: 0, origin: "top left" });
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const zoom = uiScale();
    const w = menu.offsetWidth,
      h = menu.offsetHeight;
    const vw = innerWidth / zoom,
      vh = innerHeight / zoom;
    let left = x / zoom,
      top = y / zoom,
      originX = "left",
      originY = "top";
    if (left + w > vw - 4) {
      left = Math.max(4, left - w);
      originX = "right";
    }
    if (top + h > vh - 4) {
      top = Math.max(4, top - h);
      originY = "bottom";
    }
    setPlace({ left, top, origin: `${originY} ${originX}` });
    menu.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const onKeyDown = (e: KeyboardEvent) => {
    const entries = Array.from(
      ref.current?.querySelectorAll<HTMLElement>(
        "[role=menuitem]:not(:disabled)",
      ) || [],
    );
    const at = entries.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % entries.length;
    else if (e.key === "ArrowUp")
      next = (at - 1 + entries.length) % entries.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = entries.length - 1;
    else if (e.key === "Escape" || e.key === "Tab") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
    entries[next]?.focus();
  };
  // Portalled to the shell: the LCD's backdrop blur would otherwise trap and clip it.
  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={{
        left: place.left,
        top: place.top,
        transformOrigin: place.origin,
      }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item, i) =>
        item === "divider" ? (
          <hr key={i} />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            className={`menu-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.querySelector(".app-shell") ?? document.body,
  );
}
