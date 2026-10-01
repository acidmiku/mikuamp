// Headless-only desktop UI harness. It emulates IPC, never starts or controls the app.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function createHarness() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ deviceScaleFactor: 1.375 });
  const names = [
    "星のかけら · Звёздная пыль",
    "Тихий космос",
    "Nightfall",
    "初音ミクの長い夜 — Невероятно длинное название композиции без сокращений",
    "Afterglow",
    "光の向こう",
  ];
  const albums = [
    "星のかけら",
    "Звёздная пыль",
    "Studio sessions",
    "Очень длинное название альбома — 初音ミクと夜の音楽",
    "After hours",
    "Blue hour",
  ];
  const tracks = Array.from({ length: 24 }, (_, i) => ({
    id: `track-${i}`,
    path: `C:/Music/${i}.flac`,
    title: names[i % names.length],
    artist: i < 12 ? "MikuAmp Test Signals" : "初音ミク / Вечерний оркестр",
    album: albums[Math.floor(i / 4)],
    albumArtist: "MikuAmp Test Signals",
    duration: 183 + i * 7,
    format: i % 3 === 0 ? "MP3" : "FLAC",
    bitrate: i % 3 === 0 ? 320 : i % 3 === 1 ? 941 : 2350,
    sampleRate: i % 3 === 2 ? 96000 : 44100,
    bitDepth: i % 3 === 2 ? 24 : 16,
    channels: 2,
    trackNumber: (i % 4) + 1,
    discNumber: 1,
    cover:
      i >= 20
        ? null
        : `/output/fixtures/${i % 2 ? "02 - Звёздная пыль/folder.webp" : "01 - 星のかけら/cover.webp"}`,
    quality: ["LQ", "SQ", "HR"][i % 3],
  }));
  const eq = {
    enabled: true,
    preamp: -3,
    bands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(
      (frequency, i) => ({
        frequency,
        gain: [0, 2, 1, 0, -1, 2, 0, 1, 0, -2][i],
        q: 1,
        kind: "peak",
      }),
    ),
    toneEnabled: false,
    tone: Array(10).fill(0),
  };
  const snapshot = {
    queue: tracks.map((t) => t.id),
    index: 0,
    playing: true,
    position: 87,
    volume: 0.65,
    shuffle: false,
    repeat: "off",
    spectrum: Array.from(
      { length: 32 },
      (_, i) => (Math.sin(i * 0.8) + 1) * 0.28 + 0.1,
    ),
    outputRate: 48000,
    error: null,
  };
  const panels = ["main", "equalizer", "playlist", "library", "skins"].map(
    (label) => ({
      label,
      visible: ["main", "equalizer", "playlist"].includes(label),
    }),
  );
  const pages = new Map();
  const errors = [];
  const calls = [];
  const emit = async (event, payload) => {
    await Promise.all(
      [...pages.values()].map((p) =>
        p.evaluate(({ event, payload }) => window.__mockEmit(event, payload), {
          event,
          payload,
        }),
      ),
    );
  };
  await context.exposeBinding(
    "desktopInvoke",
    async ({ page }, command, args = {}) => {
      const label = new URL(page.url()).searchParams.get("panel") || "main";
      if (!["get_snapshot", "fit_panel"].includes(command))
        calls.push({ command, args, label });
      switch (command) {
        case "get_library":
          return tracks;
        case "get_eq":
          return eq;
        case "get_snapshot":
          return snapshot;
        case "get_panels":
          return panels;
        case "set_eq":
          Object.assign(eq, args.settings);
          await emit("eq-changed", eq);
          return;
        case "set_panel_visible":
          panels.find((p) => p.label === args.label).visible = args.visible;
          await emit("panels-changed", panels);
          return;
        case "plugin:window|close":
          panels.find((p) => p.label === (args.label || label)).visible = false;
          await emit("panels-changed", panels);
          return;
        case "plugin:window|is_always_on_top":
          return false;
        case "plugin:window|set_always_on_top":
        case "plugin:window|minimize":
          return;
        case "fit_panel": {
          if (args.height) {
            const size = {
              width: Math.round(455 * args.scale),
              height: Math.ceil(args.height),
            };
            if (JSON.stringify(page.viewportSize()) !== JSON.stringify(size))
              await page.setViewportSize(size);
          }
          return;
        }
        case "enqueue":
          snapshot.queue = args.replace
            ? [...args.ids]
            : [...snapshot.queue, ...args.ids];
          return;
        case "transport": {
          const { action, value } = args;
          if (action === "play") {
            snapshot.playing = true;
            snapshot.index = value ?? snapshot.index ?? 0;
          }
          if (action === "pause") snapshot.playing = false;
          if (action === "stop") {
            snapshot.playing = false;
            snapshot.position = 0;
          }
          if (action === "seek") snapshot.position = value;
          if (["volume", "shuffle", "repeat"].includes(action))
            snapshot[action] = value;
          if (action === "remove") snapshot.queue.splice(value, 1);
          if (action === "clear") snapshot.queue = [];
          return;
        }
        case "plugin:dialog|open":
          return null;
        case "plugin:dialog|save":
          return null;
        default:
          throw Error(`Unmocked desktop command: ${command}`);
      }
    },
  );
  await context.addInitScript(() => {
    let id = 0;
    const callbacks = new Map(),
      listeners = new Map();
    const label = new URL(location.href).searchParams.get("panel") || "main";
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label }, currentWebview: { label } },
      transformCallback: (callback) => {
        callbacks.set(++id, callback);
        return id;
      },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (command, args = {}) => {
        if (command === "plugin:event|listen") {
          listeners.set(args.handler, args);
          return args.handler;
        }
        if (command === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return;
        }
        return window.desktopInvoke(command, args);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event, id) => listeners.delete(id),
    };
    window.__mockEmit = (event, payload) => {
      for (const [id, l] of listeners)
        if (l.event === event) callbacks.get(id)?.({ event, id, payload });
    };
    if (!localStorage.getItem("mikuamp-skin"))
      localStorage.setItem("mikuamp-skin", "classic");
  });
  const panel = async (label) => {
    if (pages.has(label)) return pages.get(label);
    const p = await context.newPage();
    pages.set(label, p);
    p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
    await p.setViewportSize(
      label === "library"
        ? { width: 710, height: 591 }
        : label === "skins"
          ? { width: 620, height: 610 }
          : label === "playlist"
            ? { width: 455, height: 245 }
            : { width: 455, height: 420 },
    );
    await p.goto(`http://127.0.0.1:1420/?panel=${label}`);
    await expect(p.locator(".titlebar")).toBeVisible();
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    return p;
  };
  const skin = async (id) => {
    const p = await panel("main");
    await p.evaluate((id) => {
      localStorage.setItem("mikuamp-skin", id);
      window.dispatchEvent(
        new StorageEvent("storage", { key: "mikuamp-skin", newValue: id }),
      );
    }, id);
    await p.waitForTimeout(120);
  };
  const shot = async (label, path) => {
    await mkdir(resolve(path, ".."), { recursive: true });
    const page = await panel(label);
    // Desktop resize IPC is asynchronous. Wait for a settled viewport before
    // asking Chromium to capture, otherwise it can stitch stale raster tiles.
    await page.waitForTimeout(200);
    if (label === "main" || label === "equalizer") {
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const shell = document
              .querySelector(".app-shell")
              .getBoundingClientRect();
            return Math.max(
              Math.abs(shell.width - innerWidth),
              Math.abs(shell.height - innerHeight),
            );
          }),
        )
        .toBeLessThan(2);
    }
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({ path });
  };
  return {
    browser,
    context,
    pages,
    panel,
    skin,
    shot,
    tracks,
    eq,
    snapshot,
    panels,
    emit,
    errors,
    calls,
  };
}
