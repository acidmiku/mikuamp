import { describe, expect, it } from "vitest";
import {
  CLASSIC,
  choose,
  parsePrefs,
  randomFrom,
  stepFrom,
  toggleFavorite,
  visualPresets,
} from "./preferences";

const strip = visualPresets.filter((p) => p.shape === "strip");
const square = visualPresets.find((p) => p.shape === "square")!;

describe("visual preferences", () => {
  it("reads the earlier saved shape and drops unknown ids", () => {
    const prefs = parsePrefs(
      JSON.stringify({
        selected: strip[3].id,
        favorites: [strip[1].id, "gone", strip[1].id],
        expanded: true,
      }),
    );
    expect(prefs).toEqual({
      selected: strip[3].id,
      favorites: [strip[1].id],
      recent: [],
      expanded: true,
      auto: "off",
    });
    expect(parsePrefs("not json").selected).toBe(CLASSIC);
  });

  it("flips through the catalog until two favorites form a rotation", () => {
    let prefs = parsePrefs(null);
    expect(stepFrom(prefs, 1)).toBe(visualPresets[1].id);
    expect(stepFrom(prefs, -1)).toBe(visualPresets.at(-1)!.id);
    prefs = toggleFavorite(strip[5].id)(prefs);
    expect(stepFrom(prefs, 1)).toBe(visualPresets[1].id);
    prefs = toggleFavorite(strip[9].id)(prefs);
    prefs = choose(strip[5].id)(prefs);
    expect(stepFrom(prefs, 1)).toBe(strip[9].id);
    expect(stepFrom(prefs, 1)).toBe(stepFrom(prefs, -1));
  });

  it("enlarges for square compositions and keeps a short recent list", () => {
    let prefs = choose(square.id)(parsePrefs(null));
    expect(prefs.expanded).toBe(true);
    for (const p of strip.slice(0, 20)) prefs = choose(p.id)(prefs);
    expect(prefs.recent).toHaveLength(12);
    expect(prefs.recent[0]).toBe(strip[19].id);
  });

  it("picks a different favorite, or any visual when asked", () => {
    let prefs = toggleFavorite(strip[2].id)(parsePrefs(null));
    prefs = toggleFavorite(strip[4].id)(prefs);
    prefs = choose(strip[2].id)(prefs);
    for (let i = 0; i < 20; i++)
      expect(randomFrom(prefs, true)).toBe(strip[4].id);
    expect(randomFrom(prefs, false)).not.toBe(strip[2].id);
  });
});
