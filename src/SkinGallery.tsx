import { useRef, type CSSProperties } from "react";
import { Check, Upload } from "lucide-react";
import { validateSkin, type Skin } from "./skins";

export function SkinGallery({
  skins: collection,
  selected,
  select,
  scale,
  setScale,
  importSkin,
  error,
}: {
  skins: Skin[];
  selected: string;
  select: (s: Skin) => void;
  scale: number;
  setScale: (scale: number) => void;
  importSkin: (s: Skin) => void;
  error: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="skin-gallery">
      <div className="skin-heading">
        <label className="interface-scale">
          Scale
          <select
            aria-label="Interface scale"
            value={scale}
            onChange={(e) => setScale(+e.target.value)}
          >
            <option value="1">100%</option>
            <option value="1.15">115%</option>
            <option value="1.3">130%</option>
          </select>
        </label>
        <button
          className="secondary-button"
          onClick={() => input.current?.click()}
        >
          <Upload size={13} /> Import skin
        </button>
      </div>
      <div className="skin-grid">
        {collection.map((s, i) => (
          <button
            key={s.id}
            aria-label={s.name}
            aria-pressed={selected === s.id}
            className={`skin-card ${selected === s.id ? "chosen" : ""}`}
            style={{ "--i": Math.min(i, 12) } as CSSProperties}
            onClick={() => select(s)}
          >
            <div
              className="skin-art"
              style={{ backgroundImage: `url(${s.preview})` }}
            >
              {selected === s.id && (
                <span className="skin-check">
                  <Check size={15} />
                </span>
              )}
            </div>
            <div className="skin-card-caption">
              <strong>{s.name}</strong>
              <div className="swatches">
                {[s.colors.accent, s.colors.secondary, s.colors.bg].map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept=".json,.mikuamp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file)
            try {
              if (file.size > 24_000_000)
                throw new Error("Skin file is too large.");
              importSkin(validateSkin(JSON.parse(await file.text())));
            } catch (err) {
              error(String(err));
            }
          e.target.value = "";
        }}
      />
    </div>
  );
}
