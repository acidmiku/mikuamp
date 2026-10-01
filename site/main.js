import { startIridescence } from "./shader.js";

document.documentElement.classList.add("js");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let motion = !reduceMotion.matches;
const toggle = document.querySelector("#motion-toggle");
const hero = document.querySelector(".hero");
const renderer = startIridescence(document.querySelector("#iridescence"));

function setMotion(value) {
  motion = value;
  document.documentElement.classList.toggle("motion-paused", !motion);
  toggle.setAttribute("aria-pressed", String(!motion));
  toggle.setAttribute("aria-label", motion ? "Pause motion" : "Enable motion");
  toggle.querySelector(".motion-label").textContent = motion
    ? "Motion on"
    : "Motion off";
  renderer?.setMotion(motion);
}
setMotion(motion);
toggle.addEventListener("click", () => setMotion(!motion));
reduceMotion.addEventListener("change", (event) => setMotion(!event.matches));
hero.addEventListener("pointermove", (event) => {
  if (!motion || event.pointerType === "touch") return;
  const rect = hero.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  hero.style.setProperty("--px", x);
  hero.style.setProperty("--py", y);
  renderer?.setPointer(x, y);
});
hero.addEventListener("pointerleave", () => {
  hero.style.setProperty("--px", "0");
  hero.style.setProperty("--py", "0");
  renderer?.setPointer(0, 0);
});

const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries)
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        reveal.unobserve(entry.target);
      }
  },
  { threshold: 0.12 },
);
document.querySelectorAll(".reveal").forEach((node) => reveal.observe(node));

const skinNames = {
  classic: "Classic Teal",
  sakura: "Sakura",
  midnight: "Midnight",
  snow: "Snow",
  terminal: "39.exe",
};
const skinCaptions = {
  classic: "Teal, charcoal, and the original glow.",
  sakura: "Soft pinks. Cherry-blossom daydreams.",
  midnight: "Violet light for the late-night playlist.",
  snow: "Ice blue, silver, and a little winter magic.",
  terminal: "Phosphor green. Pink accents. Pure dot matrix.",
};
const theater = document.querySelector(".skin-theater");
let currentSkin = "classic";
let skinRequest = 0;
for (const button of document.querySelectorAll(".skin-choice")) {
  button.addEventListener("click", async () => {
    const id = button.dataset.skin;
    if (id === currentSkin) return;
    const request = ++skinRequest;
    const sources = ["main", "equalizer", "portrait"].map(
      (part) => `./assets/${id}-${part}.webp`,
    );
    await Promise.all(
      sources.map(
        (src) =>
          new Promise((resolve) => {
            const image = new Image();
            image.onload = image.onerror = resolve;
            image.src = src;
          }),
      ),
    );
    if (request !== skinRequest) return;
    currentSkin = id;
    theater.dataset.skin = id;
    for (const choice of document.querySelectorAll(".skin-choice")) {
      const selected = choice === button;
      choice.classList.toggle("active", selected);
      choice.setAttribute("aria-pressed", String(selected));
    }
    const main = theater.querySelector(".skin-main"),
      eq = theater.querySelector(".skin-eq");
    main.src = sources[0];
    main.alt = `${skinNames[id]} skin preview`;
    eq.src = sources[1];
    eq.alt = `Matching ${skinNames[id]} equalizer`;
    theater.querySelector(".skin-portrait").src = sources[2];
    theater
      .querySelector(".skin-caption")
      .replaceChildren(document.createTextNode(skinNames[id]));
    const caption = document.createElement("span");
    caption.textContent = skinCaptions[id];
    theater.querySelector(".skin-caption").append(caption);
  });
}

const bars = document.querySelector(".spectrum-graphic");
for (let i = 0; i < 56; i++) {
  const bar = document.createElement("i");
  bar.style.height = `${18 + (Math.sin(i * 0.31) * 0.5 + 0.5) * 52 + Math.sin(i * 0.8) * 12}%`;
  bar.style.animationDelay = `${-i * 0.137}s`;
  bar.style.animationDuration = `${2 + (i % 9) * 0.23}s`;
  bars.append(bar);
}

document.addEventListener("visibilitychange", () =>
  renderer?.setVisible(!document.hidden),
);
const heroObserver = new IntersectionObserver((entries) =>
  renderer?.setVisible(entries[0].isIntersecting && !document.hidden),
);
heroObserver.observe(hero);
