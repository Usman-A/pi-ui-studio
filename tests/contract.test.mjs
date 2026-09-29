/**
 * Upstream contract tests.
 *
 * These pin the assumptions Studio makes about both vendored engines, so an
 * upstream release that breaks one fails here with a named reason instead of
 * failing mysteriously inside a session.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkVendorTree, readVendorManifest, SKILLS_DIR } from "../src/vendor.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_DESIGNER_SKILLS = [
  "designer-master",
  "ai-slop",
  "taste-skill",
  "design-md",
  "reference-study",
  "visual-critique",
  "review-skill",
  "animate",
  "copywriting",
  "product-md",
  "scroll-choreography",
];

const REQUIRED_UX_SKILLS = ["ux-design", "ux-capture", "ux-presets", "ux-routing"];

function skillDoc(name) {
  return fs.readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
}

test("vendor tree matches the manifest byte for byte", () => {
  const check = checkVendorTree();
  assert.deepEqual(check.issues, []);
  assert.equal(check.ok, true);
});

test("both upstream engines are vendored at pinned versions", () => {
  const manifest = readVendorManifest();
  assert.ok(manifest, "vendor/manifest.json must exist — run: npm run sync");
  assert.equal(manifest.sources["omp-designer"].package, "omp-designer");
  assert.equal(manifest.sources["pi-ux"].package, "@bacnh85/pi-ux");
  assert.match(manifest.sources["omp-designer"].version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.sources["pi-ux"].version, /^\d+\.\d+\.\d+$/);
  for (const source of Object.values(manifest.sources)) {
    assert.ok(Object.keys(source.files).length > 0, `${source.package} vendored nothing`);
    for (const entry of source.excluded) {
      assert.ok(entry.reason.length > 20, `${source.package}: exclusion without a reason — ${entry.path}`);
    }
  }
});

test("designer skills are exposed with loadable frontmatter", () => {
  for (const name of REQUIRED_DESIGNER_SKILLS) {
    const doc = skillDoc(name);
    assert.match(doc, /^---\n/, `${name} has no frontmatter`);
    assert.match(doc, new RegExp(`\\bname: ["']?${name}["']?\\b`), `${name} frontmatter name mismatch`);
    assert.match(doc, /\bdescription: \S/, `${name} has no description`);
  }
});

test("ux skills are exposed with loadable frontmatter", () => {
  for (const name of REQUIRED_UX_SKILLS) {
    const doc = skillDoc(name);
    assert.match(doc, new RegExp(`\\bname: ["']?${name}["']?\\b`), `${name} frontmatter name mismatch`);
    assert.match(doc, /\bdescription:/, `${name} has no description`);
  }
});

test("both engines are pointed at one DESIGN.md contract", async () => {
  const designer = skillDoc("design-md");
  const ux = skillDoc("ux-design");

  assert.ok(!designer.includes("local://DESIGN.md"), "design-md still writes to the artifact namespace");
  for (const doc of [designer, ux]) {
    assert.match(doc, /skill:\/\/studio-orchestrator/, "an engine skill does not defer to Studio's contract");
  }
  assert.ok(!designer.includes("picsum.photos"), "design-md still recommends a stock-photo CDN");
  assert.match(designer, /Studio: one design contract/);
  assert.match(ux, /Studio: the same DESIGN.md/);

  const { REQUIRED_TOKEN_KEYS, REQUIRED_SECTIONS } = await import("../src/contract.ts");
  for (const key of REQUIRED_TOKEN_KEYS) {
    assert.ok(designer.includes(key), `design-md never mentions the ${key} token key`);
    assert.ok(ux.includes(key), `ux-design never mentions the ${key} token key`);
  }
  for (const section of REQUIRED_SECTIONS) {
    assert.ok(designer.includes(`## ${section}`), `design-md teaches no canonical "## ${section}" section`);
  }
});

test("the Studio skill documents the schema the audit enforces", async () => {
  const { REQUIRED_TOKEN_KEYS, REQUIRED_SECTIONS } = await import("../src/contract.ts");
  const skill = skillDoc("studio-orchestrator");
  for (const key of REQUIRED_TOKEN_KEYS) assert.match(skill, new RegExp(`\\b${key}:`), `skill omits ${key}`);
  for (const section of REQUIRED_SECTIONS) assert.ok(skill.includes(`## ${section}`), `skill omits "## ${section}"`);
});

test("the ux audit kernel still exposes the gates Studio depends on", async () => {
  const { uxKernel } = await import("../src/adapters/ux.ts");
  const kernel = await uxKernel();
  assert.deepEqual([...kernel.modes].sort(), ["lite", "off", "strict"]);

  const bad = kernel.audit({
    css: ":root{--bg:#101014;--fg:#f5f5f5}\n.card{color:#f5f5f5;background:#101014;backdrop-filter:blur(8px)}\n",
  });
  assert.equal(bad.gates.tokens.pass, false, "hardcoded hex outside :root must fail the token gate");
  assert.equal(bad.gates.slopTells.pass, false, "glassmorphism must fail the slop-tell gate");

  const clean = kernel.audit({
    css: ":root{--bg:#ffffff;--fg:#111111}\n.card{color:var(--fg);background:var(--bg)}\n",
    pairs: [{ fg: "#111111", bg: "#ffffff" }],
  });
  assert.equal(clean.gates.slopTells.pass, true);
  assert.equal(clean.gates.contrast.results[0].pass, true);
});

test("designer validators are runnable from the vendored tree", () => {
  const dir = path.join(ROOT, "vendor", "omp-designer", "scripts");
  const help = spawnSync(process.execPath, [path.join(dir, "fix-ai-slop.mjs"), "--help"], { encoding: "utf8" });
  assert.equal(help.error, undefined, "fix-ai-slop.mjs could not be executed");
  assert.equal(help.status, 0, "fix-ai-slop.mjs --help must exit cleanly");
  assert.match(help.stdout, /fix-ai-slop/, "fix-ai-slop CLI contract changed");

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "studio-layout-"));
  try {
    fs.writeFileSync(path.join(fixture, "index.html"), "<html><body><main><h1>Fixture</h1></main></body></html>");
    const layout = spawnSync(process.execPath, [path.join(dir, "analyze-layout.mjs"), fixture], { encoding: "utf8" });
    assert.equal(layout.error, undefined, "analyze-layout.mjs could not be executed");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("the ui-ux-pro-max dataset is vendored but its pointer skill is not", () => {
  const manifest = readVendorManifest();
  const palette = path.join(ROOT, "vendor", "omp-designer", "data", "ui-ux-pro-max", "colors.csv");
  assert.ok(fs.existsSync(palette), "colors.csv must be vendored");
  assert.ok(
    manifest.sources["omp-designer"].excluded.some((entry) => entry.path === "skills/ui-ux-pro-max.md"),
    "the unmanaged ui-ux-pro-max pointer must stay excluded",
  );
  // The upstream pointer stays excluded; Studio ships its own dataset skill so
  // the designer engine's skill gate can actually be satisfied.
  const skill = path.join(SKILLS_DIR, "ui-ux-pro-max", "SKILL.md");
  assert.ok(fs.existsSync(skill), "Studio must ship its own ui-ux-pro-max dataset skill");
  assert.match(fs.readFileSync(skill, "utf8"), /colors\.csv/);
});
