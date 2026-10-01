import { describe, it, expect } from "vitest";
import { defaultEq, albumsFrom, type Track } from "./types";
import { filters, response } from "./audioMath";
import { skins, validateSkin } from "./skins";
describe("frequency response", () => {
  it("bypasses inactive processing", () =>
    expect(filters(defaultEq())).toEqual([]));
  it("matches a 6 dB peak at its center", () =>
    expect(
      response([{ frequency: 1000, gain: 6, q: 1, kind: "peak" }], 1000),
    ).toBeCloseTo(6, 7));
  it("temperature tilts in the labeled direction", () => {
    const eq = defaultEq();
    eq.toneEnabled = true;
    eq.tone[0] = 100;
    expect(response(filters(eq), 40)).toBeGreaterThan(8);
    expect(response(filters(eq), 15000)).toBeLessThan(-8);
  });
  it("zero Tone is neutral", () => {
    const eq = defaultEq();
    eq.toneEnabled = true;
    for (const f of [20, 100, 1000, 5000, 20000])
      expect(response(filters(eq), f)).toBeCloseTo(0, 7);
  });
});
describe("Unicode album grouping", () => {
  it("keeps different album artists apart and sorts disc/track numbers", () => {
    const base = {
      title: "星のかけら",
      artist: "初音ミク",
      albumArtist: "初音ミク",
      album: "Звёздная пыль",
      cover: null,
    } as Track;
    const albums = albumsFrom([
      { ...base, id: "2", trackNumber: 2, discNumber: 1 },
      { ...base, id: "3", trackNumber: 1, discNumber: 2 },
      { ...base, id: "1", trackNumber: 1, discNumber: 1 },
      {
        ...base,
        id: "4",
        albumArtist: "Другой исполнитель",
        trackNumber: 1,
        discNumber: 1,
      },
    ]);
    expect(albums).toHaveLength(2);
    expect(
      albums.find((a) => a.artist === "初音ミク")?.tracks.map((t) => t.id),
    ).toEqual(["1", "2", "3"]);
  });
});
describe("skin validation", () => {
  const skin = {
    ...skins[0],
    scene: "data:image/png;base64,YQ==",
    chrome: "data:image/png;base64,YQ==",
    preview: "data:image/png;base64,YQ==",
  };
  it("accepts embedded portable skin assets", () =>
    expect(validateSkin(skin).id).toBe("custom-classic"));
  it("rejects remote assets and CSS injection", () => {
    expect(() =>
      validateSkin({ ...skin, scene: "https://example.com/tracker.png" }),
    ).toThrow();
    expect(() =>
      validateSkin({
        ...skin,
        colors: { ...skin.colors, bg: "red;display:none" },
      }),
    ).toThrow();
  });
  it("rejects malformed display names", () =>
    expect(() => validateSkin({ ...skin, name: { invalid: true } })).toThrow());
});
