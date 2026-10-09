import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

export const easeOut = "cubic-bezier(.22, 1, .36, 1)";
export const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs a state change inside a view transition (cross-fade) where supported. */
export function withTransition(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => {
      ready: Promise<void>;
      finished: Promise<void>;
    };
  };
  // Hidden windows never render a frame, so a transition there would stall.
  if (!doc.startViewTransition || reducedMotion() || document.hidden) {
    update();
    return;
  }
  const t = doc.startViewTransition(() => flushSync(update));
  // A skipped transition still applies the update; only the animation is lost.
  t.ready.catch(() => {});
  t.finished.catch(() => {});
}

/**
 * Eases spectrum bars toward each FFT frame with a fast attack and slow release,
 * and lets peak caps hang briefly before falling. Writes CSS variables directly
 * so the 60 fps loop never re-renders React.
 */
export function useSpectrum(
  container: RefObject<HTMLElement | null>,
  target: number[],
) {
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const n = root.children.length;
    const level = new Float32Array(n),
      peak = new Float32Array(n),
      hold = new Float32Array(n),
      fall = new Float32Array(n);
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const snap = reducedMotion();
      const values = latest.current;
      for (let i = 0; i < n; i++) {
        // Bars may outnumber FFT bands (or vice versa); sample proportionally.
        const goal = values[Math.floor((i * values.length) / n)] ?? 0;
        const rate = goal > level[i] ? 22 : 6;
        level[i] = snap
          ? goal
          : level[i] + (goal - level[i]) * (1 - Math.exp(-rate * dt));
        if (level[i] >= peak[i]) {
          peak[i] = level[i];
          hold[i] = 0.4;
          fall[i] = 0;
        } else if (hold[i] > 0) hold[i] -= dt;
        else {
          fall[i] += 2.4 * dt;
          peak[i] = Math.max(level[i], peak[i] - fall[i] * dt);
        }
        const bar = root.children[i] as HTMLElement;
        bar.style.setProperty("--level", level[i].toFixed(3));
        bar.style.setProperty("--peak", (snap ? level[i] : peak[i]).toFixed(3));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [container]);
}

/**
 * Predicts the playback position between 100 ms snapshots so progress can move
 * every frame. Small backwards corrections are ignored to avoid jitter.
 */
export function useClock(position: number, playing: boolean) {
  const anchor = useRef({ position, at: performance.now(), playing });
  useEffect(() => {
    const a = anchor.current;
    const now = performance.now();
    const predicted = a.playing ? a.position + (now - a.at) / 1000 : a.position;
    // Accept the engine's value unless it is a tiny step back from what we drew;
    // seeks and track changes are larger jumps and always win.
    const jitter =
      playing &&
      a.playing &&
      position < predicted &&
      predicted - position < 0.25;
    anchor.current = {
      position: jitter ? predicted : position,
      at: now,
      playing,
    };
  }, [position, playing]);
  return useCallback(() => {
    const a = anchor.current;
    return a.playing
      ? a.position + (performance.now() - a.at) / 1000
      : a.position;
  }, []);
}

/** Keeps an element mounted long enough to play its exit animation. */
export function usePresence(open: boolean, exitMs = 180) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 0 : exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || mounted, leaving: !open && mounted };
}

/**
 * FLIP list animation: after `order` changes, every `[data-flip]` child glides
 * from where it was drawn to its new slot, and newcomers fade in. `capture()`
 * records the current on-screen positions, including drag transforms.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  order: string,
) {
  const positions = useRef<Map<string, number> | null>(null);
  const measure = useCallback(() => {
    const root = container.current;
    const map = new Map<string, number>();
    if (!root) return map;
    const origin = root.getBoundingClientRect().top - root.scrollTop;
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      map.set(el.dataset.flip!, el.getBoundingClientRect().top - origin);
    });
    return map;
  }, [container]);
  const capture = useCallback(() => {
    positions.current = measure();
  }, [measure]);
  useLayoutEffect(() => {
    const root = container.current;
    const before = positions.current;
    positions.current = measure();
    if (!root || !before || reducedMotion()) return;
    const origin = root.getBoundingClientRect().top - root.scrollTop;
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const now = el.getBoundingClientRect().top - origin;
      const was = before.get(el.dataset.flip!);
      if (was === undefined)
        el.animate(
          [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 260, easing: easeOut },
        );
      else if (Math.abs(was - now) > 0.5)
        el.animate(
          [{ transform: `translateY(${was - now}px)` }, { transform: "none" }],
          { duration: 280, easing: easeOut },
        );
    });
  }, [order]);
  return capture;
}

/** Interpolates numbers toward a target over `ms` whenever `animate` is set. */
export function useTween(target: number[], animate: boolean, ms = 260) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const key = target.join(",");
  useEffect(() => {
    const from = current.current;
    if (!animate || reducedMotion() || from.length !== target.length) {
      current.current = target;
      setShown(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const next = target.map((v, i) => from[i] + (v - from[i]) * e);
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return shown;
}
