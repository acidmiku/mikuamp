export type Skin = {
  version: 1;
  id: string;
  name: string;
  subtitle: string;
  scene: string;
  chrome: string;
  preview: string;
  dotMatrix?: boolean;
  /** Hand-drawn styling: handwritten labels, sketchy outlines, ruled lists. */
  sketch?: boolean;
  colors: {
    bg: string;
    panel: string;
    screen: string;
    text: string;
    muted: string;
    accent: string;
    secondary: string;
    edge: string;
  };
};
export const skins: Skin[] = [
  {
    version: 1,
    id: "classic",
    name: "Classic Teal",
    subtitle: "Teal / charcoal",
    scene: "",
    chrome: "",
    preview: "",
    colors: {
      bg: "#111b1e",
      panel: "#1c2a2f",
      screen: "#08191b",
      text: "#e1eeec",
      muted: "#92aaa9",
      accent: "#65e6cf",
      secondary: "#f683b8",
      edge: "#405353",
    },
  },
  {
    version: 1,
    id: "sakura",
    name: "Sakura",
    subtitle: "Rose / plum",
    scene: "",
    chrome: "",
    preview: "",
    colors: {
      bg: "#302128",
      panel: "#453039",
      screen: "#251a20",
      text: "#fae9e9",
      muted: "#caa6b6",
      accent: "#f6acc2",
      secondary: "#eedba0",
      edge: "#77525e",
    },
  },
  {
    version: 1,
    id: "midnight",
    name: "Midnight",
    subtitle: "Violet / navy",
    scene: "",
    chrome: "",
    preview: "",
    colors: {
      bg: "#111221",
      panel: "#202139",
      screen: "#0b0c1d",
      text: "#e9e6fa",
      muted: "#a5a3c4",
      accent: "#b7a0ff",
      secondary: "#72d9f6",
      edge: "#454362",
    },
  },
  {
    version: 1,
    id: "snow",
    name: "Snow",
    subtitle: "Ice blue / silver",
    scene: "",
    chrome: "",
    preview: "",
    colors: {
      bg: "#e2e9f0",
      panel: "#f2f6fa",
      screen: "#142e42",
      text: "#233d51",
      muted: "#526b80",
      accent: "#167a9c",
      secondary: "#ac4b90",
      edge: "#b3c7d6",
    },
  },
  {
    version: 1,
    id: "terminal",
    name: "39.exe",
    subtitle: "Phosphor / dot matrix",
    scene: "",
    chrome: "",
    preview: "",
    dotMatrix: true,
    colors: {
      bg: "#071410",
      panel: "#0e231b",
      screen: "#030d09",
      text: "#b0f8cf",
      muted: "#7da68c",
      accent: "#82f7b2",
      secondary: "#ff90b6",
      edge: "#355843",
    },
  },
  {
    version: 1,
    id: "pencil",
    name: "Pencil",
    subtitle: "Graphite / notebook",
    scene: "",
    chrome: "",
    preview: "",
    sketch: true,
    colors: {
      bg: "#ece6d8",
      panel: "#f7f3e8",
      screen: "#fbf8f0",
      text: "#2b2925",
      muted: "#66625a",
      accent: "#c2382c",
      secondary: "#2f5aa6",
      edge: "#8d877a",
    },
  },
].map((s) => ({
  ...s,
  scene: `/skins/${s.id}/scene.webp`,
  chrome: `/skins/${s.id}/chrome.webp`,
  preview: `/skins/${s.id}/preview.webp`,
})) as Skin[];
const light = (hex: string) => {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((h) => parseInt(h, 16));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 160;
};
export function isLightSkin(skin: Skin): boolean {
  return light(skin.colors.panel);
}
/** A light display ("paper"): the LCD reads in the text colour, not a glow. */
export function isLightScreen(skin: Skin): boolean {
  return light(skin.colors.screen);
}
export function validateSkin(value: unknown): Skin {
  if (!value || typeof value !== "object")
    throw new Error("Choose a MikuAmp skin JSON file.");
  const s = value as Skin;
  if (
    s.version !== 1 ||
    typeof s.id !== "string" ||
    !s.id ||
    typeof s.name !== "string" ||
    !s.name ||
    s.name.length > 60 ||
    typeof s.subtitle !== "string" ||
    s.subtitle.length > 120 ||
    !s.colors
  )
    throw new Error("Invalid MikuAmp skin manifest.");
  for (const key of [
    "bg",
    "panel",
    "screen",
    "text",
    "muted",
    "accent",
    "secondary",
    "edge",
  ] as const)
    if (!/^#[\da-f]{6}$/i.test(s.colors[key]))
      throw new Error(`Invalid color: ${key}`);
  for (const key of ["scene", "chrome", "preview"] as const)
    if (
      typeof s[key] !== "string" ||
      !/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s[key]) ||
      s[key].length > 8_000_000
    )
      throw new Error(
        `Skin ${key} must be an embedded PNG, JPEG or WebP under 6 MB.`,
      );
  return {
    ...s,
    id: `custom-${s.id.replace(/[^a-z0-9_-]/gi, "").slice(0, 48)}`,
  };
}
export function loadSkins(): Skin[] {
  try {
    return [
      ...skins,
      ...JSON.parse(localStorage.getItem("mikuamp-custom-skins") || "[]")
        .map(validateSkin)
        .map((s: Skin) => ({
          ...s,
          id: s.id.replace(/^custom-custom-/, "custom-"),
        })),
    ];
  } catch {
    return skins;
  }
}
