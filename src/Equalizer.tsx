import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { defaultEq, hz, type Band, type Eq } from "./types";
import { filters, response, toneControls } from "./audioMath";
import { useTween } from "./motion";
import { IconButton } from "./ui";

const W = 476,
  H = 150,
  RANGE = 15,
  PAD = 12;
const xOf = (f: number) => (Math.log10(f / 20) / 3) * W;
const fOf = (x: number) => 20 * 10 ** ((Math.min(W, Math.max(0, x)) / W) * 3);
const yOf = (db: number) => H / 2 - db * ((H / 2 - PAD) / RANGE);
const dbOf = (y: number) => (H / 2 - y) / ((H / 2 - PAD) / RANGE);
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
// Snap to a step without binary-fraction tails (0.1 * 15 = 1.5000000000000002).
const round = (n: number, step: number) =>
  +(Math.round(n / step) * step).toFixed(3);
const db = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)} dB`;
const kinds: Record<Band["kind"], string> = {
  peak: "Peak",
  lowShelf: "Low shelf",
  highShelf: "High shelf",
};
// Frequencies of the engine's 32 log-spaced spectrum bands (dsp.rs).
const spectrumHz = Array.from(
  { length: 32 },
  (_, i) => 32 * (18000 / 32) ** ((i + 0.5) / 32),
);

const builtIn: Record<string, number[]> = {
  Flat: Array(10).fill(0),
  "Bass lift": [5, 4, 2, 0, 0, 0, 0, 0, 0, 0],
  "Vocal focus": [-2, -2, -1, 0, 2, 3, 2, 1, 0, -1],
  "Soft treble": [0, 0, 0, 0, 0, 0, -1, -2, -4, -4],
};
type Saved = { name: string; preamp: number; bands: Band[] };
const loadPresets = (): Saved[] => {
  try {
    return JSON.parse(localStorage.getItem("mikuamp-eq-presets") || "[]");
  } catch {
    return [];
  }
};

/** Highest boost of the processed curve, and how the engine treats it. */
function headroom(eq: Eq) {
  const bands = filters(eq);
  let peak = -Infinity;
  for (let i = 0; i <= 160; i++)
    peak = Math.max(peak, response(bands, 20 * 1000 ** (i / 160)));
  return {
    boost: Math.max(0, peak),
    clip: peak + (eq.enabled ? eq.preamp : 0),
  };
}

export function Equalizer({
  eq,
  update,
  spectrum,
  native,
}: {
  eq: Eq;
  update: (e: Eq) => void;
  spectrum: number[];
  native: boolean;
}) {
  const [tab, setTab] = useState<"peq" | "tone">("peq"),
    [selected, setSelected] = useState(5),
    [hover, setHover] = useState<number | null>(null),
    [dragging, setDragging] = useState<number | null>(null),
    [preset, setPreset] = useState("Custom"),
    [saved, setSaved] = useState(loadPresets),
    [naming, setNaming] = useState(false),
    [morph, setMorph] = useState(false);
  const graph = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; rect: DOMRect } | null>(null);
  const band = eq.bands[selected];
  // Presets and resets glide; direct manipulation follows the pointer exactly.
  const shownGains = useTween(
    [...eq.bands.map((b) => b.gain), ...eq.tone],
    morph,
  );
  useEffect(() => {
    if (!morph) return;
    const t = setTimeout(() => setMorph(false), 320);
    return () => clearTimeout(t);
  }, [morph]);
  const shown: Eq = {
    ...eq,
    bands: eq.bands.map((b, i) => ({ ...b, gain: shownGains[i] ?? b.gain })),
    tone: eq.tone.map((t, i) => shownGains[10 + i] ?? t),
  };

  const edit = (next: Eq, glide = false) => {
    setMorph(glide);
    update(next);
  };
  const setBand = (i: number, patch: Partial<Band>) => {
    setPreset("Custom");
    edit({
      ...eq,
      // Shaping a band implies wanting to hear it.
      enabled: true,
      bands: eq.bands.map((b, n) => (n === i ? { ...b, ...patch } : b)),
    });
  };
  const applyPreset = (name: string) => {
    const user = saved.find((p) => p.name === name);
    if (user) {
      setPreset(name);
      edit(
        { ...eq, enabled: true, preamp: user.preamp, bands: user.bands },
        true,
      );
      return;
    }
    if (!builtIn[name]) return;
    setPreset(name);
    edit(
      {
        ...eq,
        enabled: true,
        preamp: name === "Flat" ? 0 : -5,
        bands: defaultEq().bands.map((b, i) => ({
          ...b,
          gain: builtIn[name][i],
        })),
      },
      true,
    );
  };
  const savePreset = (name: string) => {
    const clean = name.trim().slice(0, 40);
    setNaming(false);
    if (!clean || builtIn[clean]) return;
    const next = [
      ...saved.filter((p) => p.name !== clean),
      { name: clean, preamp: eq.preamp, bands: eq.bands },
    ];
    setSaved(next);
    localStorage.setItem("mikuamp-eq-presets", JSON.stringify(next));
    setPreset(clean);
  };
  const deletePreset = () => {
    const next = saved.filter((p) => p.name !== preset);
    setSaved(next);
    localStorage.setItem("mikuamp-eq-presets", JSON.stringify(next));
    setPreset("Custom");
  };

  const pointAt = (e: PointerEvent, rect: DOMRect) => ({
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
  });
  const startDrag = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (e.button !== 0 || !graph.current) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(i);
    setDragging(i);
    drag.current = { i, rect: graph.current.getBoundingClientRect() };
  };
  const moveDrag = (e: PointerEvent) => {
    if (!drag.current) return;
    const { i, rect } = drag.current;
    const { x, y } = pointAt(e, rect);
    const f = fOf(x);
    const step = f < 100 ? 1 : f < 1000 ? 5 : f < 10000 ? 10 : 50;
    setBand(i, {
      // Shift locks frequency so only gain moves.
      frequency: e.shiftKey
        ? eq.bands[i].frequency
        : clamp(round(f, step), 20, 20000),
      gain: clamp(round(dbOf(y), 0.1), -RANGE, RANGE),
    });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(null);
  };
  const nudge = (e: KeyboardEvent, i: number) => {
    const b = eq.bands[i];
    const fine = e.shiftKey;
    let patch: Partial<Band> | null = null;
    if (e.key === "ArrowUp")
      patch = {
        gain: clamp(round(b.gain + (fine ? 0.1 : 0.5), 0.1), -RANGE, RANGE),
      };
    else if (e.key === "ArrowDown")
      patch = {
        gain: clamp(round(b.gain - (fine ? 0.1 : 0.5), 0.1), -RANGE, RANGE),
      };
    else if (e.key === "ArrowRight")
      patch = {
        frequency: clamp(
          Math.round(b.frequency * 2 ** (fine ? 1 / 24 : 1 / 6)),
          20,
          20000,
        ),
      };
    else if (e.key === "ArrowLeft")
      patch = {
        frequency: clamp(
          Math.round(b.frequency / 2 ** (fine ? 1 / 24 : 1 / 6)),
          20,
          20000,
        ),
      };
    else if (e.key === "PageUp")
      patch = { q: clamp(round(b.q * 1.25, 0.01), 0.1, 12) };
    else if (e.key === "PageDown")
      patch = { q: clamp(round(b.q / 1.25, 0.01), 0.1, 12) };
    else if (e.key === "Delete" || e.key === "Backspace") patch = { gain: 0 };
    if (!patch) return;
    e.preventDefault();
    e.stopPropagation();
    setBand(i, patch);
  };

  const active = tab === "peq" ? eq.enabled : eq.toneEnabled;
  const room = headroom(eq);
  // The engine attenuates automatically whenever Tone is on.
  const auto = eq.toneEnabled;
  const fixPreamp = () =>
    edit(
      { ...eq, preamp: clamp(Math.floor(-room.boost * 2) / 2, -18, 12) },
      true,
    );
  const tipBand = dragging ?? hover;
  const presets = [
    "Custom",
    ...Object.keys(builtIn),
    ...saved.map((p) => p.name),
  ];
  const isUser = saved.some((p) => p.name === preset);

  return (
    <div className={`equalizer ${active ? "" : "is-off"}`}>
      <div className="eq-toolbar">
        <div className="segmented" role="group" aria-label="Equalizer mode">
          <button
            className={tab === "peq" ? "active" : ""}
            aria-pressed={tab === "peq"}
            onClick={() => setTab("peq")}
          >
            Parametric
          </button>
          <button
            className={tab === "tone" ? "active" : ""}
            aria-pressed={tab === "tone"}
            onClick={() => setTab("tone")}
          >
            Tone
          </button>
        </div>
        <button
          className={`toggle ${active ? "on" : ""}`}
          aria-label={`Enable ${tab === "peq" ? "parametric EQ" : "Tone"}`}
          aria-pressed={active}
          onClick={() =>
            update({
              ...eq,
              ...(tab === "peq"
                ? { enabled: !eq.enabled }
                : { toneEnabled: !eq.toneEnabled }),
            })
          }
        >
          <i />
          {active ? "ON" : "OFF"}
        </button>
        <span className="eq-toolbar-fill" />
        {tab === "peq" &&
          (naming ? (
            <input
              className="preset-name"
              aria-label="Preset name"
              placeholder="Name this preset"
              autoFocus
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === "Enter") savePreset(e.currentTarget.value);
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNaming(false);
                }
              }}
              onBlur={(e) => savePreset(e.currentTarget.value)}
            />
          ) : (
            <>
              <select
                aria-label="EQ preset"
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
              >
                {presets.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              {isUser ? (
                <IconButton label="Delete preset" onClick={deletePreset}>
                  <Trash2 size={13} />
                </IconButton>
              ) : (
                <IconButton
                  label="Save as preset"
                  onClick={() => setNaming(true)}
                >
                  <Save size={13} />
                </IconButton>
              )}
            </>
          ))}
      </div>
      {!native && (
        <div className="preview-note">
          DSP runs in the desktop app. These controls preview its settings.
        </div>
      )}

      <div
        className={`eq-graph ${tab === "peq" ? "editable" : ""}`}
        ref={graph}
        onWheel={(e) => {
          // Only a hovered or held node takes the wheel, so lists still scroll.
          if (tab !== "peq" || tipBand === null) return;
          const b = eq.bands[tipBand];
          setBand(tipBand, {
            q: clamp(
              round(b.q * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.01),
              0.1,
              12,
            ),
          });
        }}
      >
        <Graph eq={shown} spectrum={spectrum} />
        {tab === "peq" &&
          shown.bands.map((b, i) => (
            <button
              key={i}
              className={`eq-node ${i === selected ? "selected" : ""} ${dragging === i ? "dragging" : ""}`}
              style={{
                left: `${(xOf(b.frequency) / W) * 100}%`,
                top: `${(yOf(b.gain) / H) * 100}%`,
              }}
              aria-label={`Band ${i + 1}: ${hz(b.frequency)} Hz, ${db(eq.bands[i].gain)}, Q ${b.q}`}
              title="Drag to shape · wheel for Q · double-click to reset · arrows nudge"
              onPointerDown={(e) => startDrag(e, i)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setSelected(i)}
              onDoubleClick={() => setBand(i, { gain: 0 })}
              onKeyDown={(e) => nudge(e, i)}
            >
              {i + 1}
            </button>
          ))}
        {tab === "peq" && tipBand !== null && (
          <div
            className={`eq-tip ${yOf(eq.bands[tipBand].gain) < 50 ? "below" : ""}`}
            style={{
              left: `${clamp((xOf(eq.bands[tipBand].frequency) / W) * 100, 14, 86)}%`,
              top: `${(yOf(eq.bands[tipBand].gain) / H) * 100}%`,
            }}
          >
            <b>{hz(eq.bands[tipBand].frequency)} Hz</b> ·{" "}
            {db(eq.bands[tipBand].gain)} · Q {eq.bands[tipBand].q}
          </div>
        )}
        <div className="graph-labels" aria-hidden="true">
          {[20, 100, 1000, 10000].map((f) => (
            <span key={f} style={{ left: `${(xOf(f) / W) * 100}%` }}>
              {hz(f)}
            </span>
          ))}
        </div>
      </div>

      {tab === "peq" ? (
        <div className="band-details">
          <IconButton
            label="Previous band"
            onClick={() => setSelected((selected + 9) % 10)}
          >
            <ChevronLeft size={13} />
          </IconButton>
          <span className="band-name">
            BAND {String(selected + 1).padStart(2, "0")}
          </span>
          <IconButton
            label="Next band"
            onClick={() => setSelected((selected + 1) % 10)}
          >
            <ChevronRight size={13} />
          </IconButton>
          <select
            aria-label="Band filter type"
            value={band.kind}
            onChange={(e) =>
              setBand(selected, { kind: e.target.value as Band["kind"] })
            }
          >
            {Object.entries(kinds).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <label>
            Hz
            <NumberField
              label="Band frequency"
              min={20}
              max={20000}
              step={1}
              value={band.frequency}
              onCommit={(frequency) => setBand(selected, { frequency })}
            />
          </label>
          <label>
            dB
            <NumberField
              label="Band gain"
              min={-15}
              max={15}
              step={0.1}
              value={band.gain}
              onCommit={(gain) => setBand(selected, { gain })}
            />
          </label>
          <label>
            Q
            <NumberField
              label="Band Q"
              min={0.1}
              max={12}
              step={0.1}
              value={band.q}
              onCommit={(q) => setBand(selected, { q })}
            />
          </label>
        </div>
      ) : (
        <div className="tone-list">
          {toneControls.map(([name, left, right], i) => (
            <label className="tone-row" key={name}>
              <span>
                {name}
                <output>
                  {eq.tone[i] > 0 ? "+" : ""}
                  {eq.tone[i]}
                </output>
              </span>
              <div>
                <small>{left}</small>
                <input
                  aria-label={name}
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={eq.tone[i]}
                  style={
                    {
                      "--progress": `${(eq.tone[i] + 100) / 2}%`,
                    } as CSSProperties
                  }
                  onChange={(e) =>
                    edit({
                      ...eq,
                      toneEnabled: true,
                      tone: eq.tone.map((n, j) =>
                        j === i ? +e.target.value : n,
                      ),
                    })
                  }
                  onDoubleClick={() =>
                    edit(
                      { ...eq, tone: eq.tone.map((n, j) => (j === i ? 0 : n)) },
                      true,
                    )
                  }
                />
                <small>{right}</small>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="eq-bottom">
        {tab === "peq" ? (
          <>
            <span className="eq-label">PRE</span>
            <input
              type="range"
              aria-label="Preamp"
              min="-18"
              max="12"
              step="0.5"
              value={eq.preamp}
              style={
                {
                  "--progress": `${((eq.preamp + 18) / 30) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) => update({ ...eq, preamp: +e.target.value })}
              onDoubleClick={() => edit({ ...eq, preamp: 0 }, true)}
            />
            <output className="eq-value">{db(eq.preamp)}</output>
          </>
        ) : (
          <span className="eq-label">10 MSEB-STYLE CONTROLS · APPROXIMATE</span>
        )}
        <span className="eq-bottom-fill" />
        {(eq.enabled || eq.toneEnabled) &&
          (auto ? (
            <span
              className="headroom ok"
              title="Tone lowers the level automatically so boosts cannot clip."
            >
              <Check size={12} />
              Auto headroom {room.boost > 0.05 ? db(-room.boost) : "0 dB"}
            </span>
          ) : room.clip <= 0.05 ? (
            <span
              className="headroom ok"
              title="The boosted curve stays below full scale."
            >
              <Check size={12} />
              No clipping · {Math.abs(room.clip).toFixed(1)} dB spare
            </span>
          ) : (
            <button
              className="headroom warn"
              title="Lower the preamp by the curve's highest boost"
              onClick={fixPreamp}
            >
              <TriangleAlert size={12} />
              Can clip +{room.clip.toFixed(1)} dB · Fix
            </button>
          ))}
        <button
          className="text-button"
          onClick={() => {
            if (tab === "peq") {
              setPreset("Flat");
              edit({ ...eq, preamp: 0, bands: defaultEq().bands }, true);
            } else edit({ ...eq, tone: Array(10).fill(0) }, true);
          }}
        >
          RESET
        </button>
      </div>
    </div>
  );
}

function Graph({ eq, spectrum }: { eq: Eq; spectrum: number[] }) {
  const bands = filters(eq);
  const points = Array.from({ length: 181 }, (_, i) => {
    const x = (i / 180) * W;
    return `${x.toFixed(1)},${clamp(yOf(response(bands, fOf(x))), 1, H - 1).toFixed(1)}`;
  });
  const zero = yOf(0).toFixed(1);
  const level = spectrumHz.map(
    (f, i) =>
      `${xOf(f).toFixed(1)},${(H - (spectrum[i] ?? 0) * H * 0.85).toFixed(1)}`,
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        className="eq-spectrum"
        style={
          {
            d: `path("M0 ${H}L${level.join("L")}L${W} ${H}Z")`,
          } as CSSProperties
        }
      />
      <path
        className="graph-grid"
        d={[100, 1000, 10000]
          .map((f) => `M${xOf(f).toFixed(1)} 0V${H}`)
          .concat([-12, -6, 6, 12].map((g) => `M0 ${yOf(g).toFixed(1)}H${W}`))
          .join("")}
      />
      <path className="graph-zero" d={`M0 ${zero}H${W}`} />
      <path
        className="eq-fill"
        d={`M0 ${zero}L${points.join("L")}L${W} ${zero}Z`}
      />
      <path className="eq-curve" d={`M${points.join("L")}`} />
    </svg>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    const next =
      draft.trim() && Number.isFinite(number)
        ? Math.min(max, Math.max(min, number))
        : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
