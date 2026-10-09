/**
 * Extract the drawing dependency closures from the pinned iwrzwr archive.
 * This is a build-time source transform, never a runtime string evaluator.
 * Upstream: https://github.com/kaganin/iwrzwr-visual-archive (MIT)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const revision = "003922f7912dd5fa51073c4337686e5be161fb47";
const project = path.resolve(import.meta.dirname, "..");
const source = path.resolve(
  process.argv[2] ||
    path.join(project, "output/reference/iwrzwr-visual-archive"),
);
const out = path.join(project, "src/visualizers/archive");
const actual = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
}).trim();
if (actual !== revision)
  throw new Error(`Expected reviewed upstream ${revision}, got ${actual}`);
const catalog = JSON.parse(
  fs.readFileSync(path.join(source, "dist/catalog.json"), "utf8"),
);
const groups = new Set(["İlk denemeler", "Gece serileri", "Matrix ve ses"]);
const collections = catalog.filter((entry) => groups.has(entry.group));
const squares = ["signal-assembly", "phase-mechanics", "orbital-memory"];
const titles = {
  "bloom-ten-studies": "Bloom",
  "matrix-direction-studies": "Matrix Directions",
  "matrix-routes-ten": "Matrix Routes",
  "sound-motion-four-series": "Sound and Motion",
  "cell-memory-ten": "Cell / Trace / Memory",
  "fan-satellites-refined": "Spectral Fan & Band Satellites",
};
const replacements = new Set([
  "ctx",
  "w",
  "h",
  "t",
  "time",
  "elapsed",
  "level",
  "smoothLevel",
  "dpr",
  "panels",
  "reduced",
  "reduce",
]);
const sampleCollections = new Set([
  "sound-motion-four-series",
  "cell-memory-ten",
  "fan-satellites-refined",
]);
const methods = new Set(["signal", "hit", "wave", "softSignal"]);
const presets = [];
const manifest = [];
fs.mkdirSync(path.join(out, "generated"), { recursive: true });

function iifeBody(code, filename) {
  const file = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (file.parseDiagnostics.length)
    throw new Error(`Invalid JavaScript: ${filename}`);
  const expression = file.statements.find(ts.isExpressionStatement)?.expression;
  if (!expression || !ts.isCallExpression(expression))
    throw new Error(`Expected IIFE: ${filename}`);
  let closure = expression.expression;
  while (ts.isParenthesizedExpression(closure)) closure = closure.expression;
  if (!ts.isArrowFunction(closure) || !ts.isBlock(closure.body))
    throw new Error(`Expected arrow IIFE: ${filename}`);
  return { file, body: closure.body };
}

function extract(code, filename, entry, sample) {
  const { file, body } = iifeBody(code, filename);
  const definitions = new Map();
  for (const statement of body.statements) {
    if (ts.isFunctionDeclaration(statement))
      definitions.set(statement.name.text, {
        node: statement,
        text: statement.getText(file),
        order: statement.pos,
      });
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name))
          definitions.set(declaration.name.text, {
            node: declaration,
            text: `${statement.declarationList.flags & ts.NodeFlags.Const ? "const" : "let"} ${declaration.getText(file)};`,
            order: declaration.pos,
          });
      }
    }
  }
  const selected = new Set();
  function visit(name) {
    if (
      selected.has(name) ||
      replacements.has(name) ||
      (sample && methods.has(name))
    )
      return;
    const item = definitions.get(name);
    if (!item) return;
    selected.add(name);
    const walk = (node) => {
      if (ts.isIdentifier(node)) {
        // Property names are not closure dependencies (e.g. state.mode).
        const parent = node.parent;
        if (
          !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
          !(ts.isPropertyAssignment(parent) && parent.name === node)
        )
          visit(node.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(item.node);
  }
  visit(entry);
  if (!selected.has(entry))
    throw new Error(`Missing drawing entry point ${filename}:${entry}`);
  // These reviewed, pure array initializers sit between declarations upstream.
  // Keep their order: dropping them changes saved permutation/history geometry.
  const initializers = body.statements.filter((statement) =>
    /^(?:swapPairs\.forEach|durations\.forEach|for\s*\(const \[index,value\] of (?:loadEdits|gainEdits|spanEdits))/.test(
      statement.getText(file),
    ),
  );
  for (const statement of initializers) {
    const walk = (node) => {
      if (ts.isIdentifier(node)) visit(node.text);
      ts.forEachChild(node, walk);
    };
    walk(statement);
  }
  let result = [
    ...[...selected].map((name) => definitions.get(name)),
    ...initializers.map((node) => ({
      text: node.getText(file),
      order: node.pos,
    })),
  ]
    .sort((a, b) => a.order - b.order)
    .map((item) => item.text)
    .join("\n");
  // Square export programs assume a 1080px bitmap; the caller now owns scale/DPR.
  result = result.replace(/ctx\.setTransform\(2,0,0,2,0,0\);/g, "");
  if (
    /\b(?:document|window|globalThis)\s*(?:\?\.)?[.\[]|\b(?:requestAnimationFrame|cancelAnimationFrame|ResizeObserver|IntersectionObserver|AudioContext|Tweak|fetch|eval)\s*\(|new\s+Function/.test(
      result,
    )
  ) {
    throw new Error(`Non-render dependency survived extraction: ${filename}`);
  }
  return { code: result, definitions: selected.size };
}

function moduleFor(id, code, names, styles, shape = "strip") {
  const square = shape === "square",
    sample = sampleCollections.has(id);
  const entry =
    square || id === "bloom-ten-studies"
      ? "paint"
      : sample
        ? "drawPanel"
        : "draw";
  const drawing = extract(code, id, entry, sample);
  const invocation = square
    ? "paint(time);"
    : sample
      ? "drawPanel({ctx,w,id:item},time);"
      : `${entry}(time);`;
  const module = `// Generated by scripts/vendor-visualizers.mjs; edit the generator, not this file.
// iwrzwr visual archive, MIT © 2026 Kagan Yaldizkaya.
// Source revision ${revision}, collection ${id}.
${sample ? "import { analysisAt } from '../signal-bridge.js';" : ""}
export default function createRenderer(item = 0) {
  let ctx, w = 226, h = 44, t = 0, time = 0, elapsed = 0, level = 0, smoothLevel = 0, dpr = 2, iwrSignal;
  const reduced = { matches: false }, reduce = reduced;
  let panels = [];
  ${
    sample
      ? `const signal = at => analysisAt(iwrSignal, at);
  const hit = (at, kind) => iwrSignal.eventAt(kind, Math.max(0, iwrSignal.songTime-at));
  const wave = (at, u) => iwrSignal.sampleAt(Math.max(0, iwrSignal.songTime-at) + (1-u)*.032, 'mono');
  const softSignal = at => { const f = signal(at); return {...f, bands:[f.low,f.mid,f.high], phase:[iwrSignal.lowPhase,iwrSignal.midPhase,iwrSignal.highPhase]}; };`
      : ""
  }
${drawing.code}
  ${styles.length ? `state.style = ${JSON.stringify(styles)}[item] || ${JSON.stringify(styles[0])};` : ""}
  return function render(context, width, height, seconds, audio) {
    if (!(width > 0 && height > 0)) return;
    ctx = context; iwrSignal = audio; time = t = elapsed = Math.max(0, seconds);
    level = smoothLevel = Math.max(0, Math.min(1, audio.level * .8 + audio.hit * .2));
    const scale = ${square ? "Math.min(width, height) / 540" : "height / 44"};
    w = ${square ? "540" : "Math.max(1, width / scale)"}; h = ${square ? "540" : "44"};
    dpr = Math.max(1, Math.hypot(context.getTransform().a, context.getTransform().b) * scale);
    panels = Array.from({length:${names.length}}, (_,id) => ({ctx,w,width:w,id,visible:id===item}));
    ctx.save();
    ctx.beginPath(); ctx.rect(0,0,width,height); ctx.clip();
    ${square ? "ctx.translate((width-540*scale)/2,(height-540*scale)/2);" : ""}
    ctx.scale(scale,scale);
    try { ${invocation} } finally { ctx.restore(); }
  };
}
`;
  // Parse the generated module again; no code execution occurs during vendoring.
  const parsed = ts.createSourceFile(
    `${id}.js`,
    module,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (parsed.parseDiagnostics.length)
    throw new Error(`Generated parse failure: ${id}`);
  fs.writeFileSync(path.join(out, "generated", `${id}.js`), module);
  manifest.push({
    collection: id,
    shape,
    presets: names.length,
    sourceBytes: code.length,
    generatedBytes: module.length,
    definitions: drawing.definitions,
  });
}

for (const collection of collections) {
  const payload = JSON.parse(
    fs.readFileSync(
      path.join(source, "dist/studies", `${collection.id}.json`),
      "utf8",
    ),
  );
  const scripts = [
    ...payload.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g),
  ];
  if (scripts.length !== 1)
    throw new Error(`Expected one inline drawing script: ${collection.id}`);
  const styles = [
    ...payload.html.matchAll(/<button[^>]*data-style="([^"]+)"/g),
  ].map((match) => match[1]);
  const category =
    titles[collection.id] || collection.title.replace(/^\d+\s+/, "");
  collection.names.forEach((name, item) =>
    presets.push({
      id: `iwrzwr:${collection.id}:${item}`,
      name,
      category,
      collectionId: collection.id,
      item,
      shape: "strip",
    }),
  );
  moduleFor(collection.id, scripts[0][1], collection.names, styles);
}
for (const id of squares) {
  const name = id
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
  presets.push({
    id: `iwrzwr:${id}:0`,
    name,
    category: "Compositions",
    collectionId: id,
    item: 0,
    shape: "square",
  });
  moduleFor(
    id,
    fs.readFileSync(path.join(source, "dist", `${id}.js`), "utf8"),
    [name],
    [],
    "square",
  );
}
fs.writeFileSync(
  path.join(out, "presets.json"),
  JSON.stringify(presets, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      repository: "https://github.com/kaganin/iwrzwr-visual-archive",
      revision,
      presetCount: presets.length,
      collections: manifest,
    },
    null,
    2,
  ) + "\n",
);
fs.copyFileSync(path.join(source, "LICENSE"), path.join(out, "LICENSE"));
fs.mkdirSync(path.join(project, "public/licenses"), { recursive: true });
fs.copyFileSync(
  path.join(source, "LICENSE"),
  path.join(project, "public/licenses/iwrzwr-visual-archive.txt"),
);
console.log(
  `Vendored ${presets.length} presets in ${manifest.length} static Canvas2D modules from ${revision}.`,
);
