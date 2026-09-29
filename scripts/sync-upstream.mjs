#!/usr/bin/env node
/**
 * Vendor sync — regenerate `vendor/` and the generated skill directories from
 * the published npm artifacts of both upstream engines.
 *
 *   node scripts/sync-upstream.mjs                        # re-vendor pinned versions
 *   node scripts/sync-upstream.mjs --designer=latest --ux=latest
 *   node scripts/sync-upstream.mjs --check                # drift check, no writes
 *
 * Never hand-edit `vendor/` or generated skill directories: the sync is the
 * only writer, and `vendor/manifest.json` records what it wrote.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSkillDocument } from "./transforms/skill-md.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = path.join(ROOT, "vendor");
const SKILLS_DIR = path.join(ROOT, "skills");
const NOTICES = path.join(ROOT, "THIRD_PARTY_NOTICES.md");
const MARKER_START = "<!-- vendor:versions:start -->";
const MARKER_END = "<!-- vendor:versions:end -->";

/** Skill directories authored by Studio; the sync must never touch them. */

const AUTHORED_SKILLS = new Set(["studio-orchestrator", "ui-ux-pro-max"]);

/** pi-ux skills that carry a documented transform (see scripts/transforms/). */
const TRANSFORMED_UX_SKILLS = new Set(["ux-design"]);
const argv = process.argv.slice(2);
const flags = new Map(
  argv
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? true];
    }),
);
const checkOnly = flags.has("check");

const upstreams = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "upstreams.json"), "utf8"));
const log = (...args) => console.log(...args);

function sh(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr || error.message}`);
  }
}

function registryVersion(pkg) {
  return sh("npm", ["view", pkg, "version"]);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Download + unpack one upstream tarball into a temp dir. */
function fetchPackage(pkg, version) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ui-studio-"));
  const unpacked = path.join(tmp, "unpacked");
  fs.mkdirSync(unpacked);
  // `npm pack` into the temp cwd: works with every npm shim, no --pack-destination.
  sh("npm", ["pack", `${pkg}@${version}`, "--silent"], { cwd: tmp });
  const tarball = fs.readdirSync(tmp).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) throw new Error(`npm pack produced no tarball for ${pkg}@${version}`);
  sh("tar", ["xzf", path.join(tmp, tarball), "-C", unpacked, "--strip-components=1"]);
  return { dir: unpacked, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

const REGEXP_SPECIALS = /[.+^${}()|[\]\\]/g;

/** Expand a limited glob pattern ("skills/[a-z].md", "data/x/[a-z].csv") into an anchored matcher. */
function globToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(REGEXP_SPECIALS, (c) => `\\${c}`);
  }
  return new RegExp(`^${out}$`);
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

function vendorOne(spec, requestedVersion) {
  const resolved = requestedVersion === "latest" ? registryVersion(spec.package) : (requestedVersion ?? spec.version);
  const { dir, cleanup } = fetchPackage(spec.package, resolved);
  const target = path.join(VENDOR_DIR, spec.dir);
  fs.rmSync(target, { recursive: true, force: true });

  const excluded = new Set(spec.exclude.map((entry) => entry.path));
  const matchers = spec.include.map((pattern) => ({ pattern, re: globToRegExp(pattern) }));
  const files = walk(dir).filter((rel) => !excluded.has(rel) && matchers.some((m) => m.re.test(rel)));
  if (files.length === 0) throw new Error(`no files matched include list for ${spec.package}@${resolved}`);

  const hashes = {};
  for (const rel of files.sort()) {
    const to = path.join(target, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const bytes = fs.readFileSync(path.join(dir, rel));
    fs.writeFileSync(to, bytes);
    hashes[rel] = { sha256: sha256(bytes), bytes: bytes.length };
  }

  cleanup();
  return { resolved, target, files, hashes, excluded: spec.exclude };
}

/** Emit `skills/<name>/SKILL.md` for every vendored skill Studio exposes. */
function generateSkills(sources) {
  const designerDir = path.join(VENDOR_DIR, "omp-designer", "skills");
  const uxDir = path.join(VENDOR_DIR, "pi-ux", "skills");

  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !AUTHORED_SKILLS.has(entry.name)) {
      fs.rmSync(path.join(SKILLS_DIR, entry.name), { recursive: true, force: true });
    }
  }

  const generated = {};
  const dropped = new Set(sources.ompDesigner.excluded.map((entry) => `skills/${entry.path.split("/").pop()}`));

  for (const file of fs.readdirSync(designerDir).filter((f) => f.endsWith(".md")).sort()) {
    const skillName = path.basename(file, ".md");
    if (dropped.has(`skills/${skillName}.md`)) {
      generated[skillName] = { emitted: false, reason: "excluded by upstream pin (see scripts/upstreams.json)" };
      continue;
    }
    const raw = fs.readFileSync(path.join(designerDir, file), "utf8");
    const { name, content, transforms } = buildSkillDocument(skillName, raw);
    emitSkill(name, content);
    generated[name] = { emitted: true, upstream: `omp-designer@${sources.ompDesigner.resolved}`, transforms };
  }

  const uxSkills = fs
    .readdirSync(uxDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of uxSkills) {
    const source = path.join(uxDir, entry.name, "SKILL.md");
    if (!fs.existsSync(source)) continue;
    const raw = fs.readFileSync(source, "utf8");
    // pi-ux ships directory skills that are already valid; only the ones with
    // a documented transform are re-rendered.
    if (!TRANSFORMED_UX_SKILLS.has(entry.name)) {
      emitSkill(entry.name, raw, true);
      generated[entry.name] = { emitted: true, upstream: `@bacnh85/pi-ux@${sources.piUx.resolved}`, transforms: [] };
      continue;
    }
    const document = buildSkillDocument(entry.name, raw);
    emitSkill(entry.name, document.content);
    generated[entry.name] = {
      emitted: true,
      upstream: `@bacnh85/pi-ux@${sources.piUx.resolved}`,
      transforms: document.transforms,
    };
  }

  return generated;
}

function emitSkill(name, content, verbatim = false) {
  const dir = path.join(SKILLS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const body = content.endsWith("\n") ? content : `${content}\n`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), verbatim ? body : content);
}

function updateNotices(sources) {
  if (!fs.existsSync(NOTICES)) return;
  const rows = Object.entries(upstreams)
    .map(([key, spec]) => {
      const version = key === "omp-designer" ? sources.ompDesigner.resolved : sources.piUx.resolved;
      return `| \`${spec.package}\` | ${version} | ${spec.role} | ${spec.homepage} |`;
    })
    .join("\n");
  const block = [
    MARKER_START,
    "",
    "| package | version | role | source |",
    "| --- | --- | --- | --- |",
    rows,
    "",
    MARKER_END,
  ].join("\n");
  const text = fs.readFileSync(NOTICES, "utf8");
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  if (start === -1 || end === -1) throw new Error("THIRD_PARTY_NOTICES.md is missing the vendor version markers");
  fs.writeFileSync(NOTICES, text.slice(0, start) + block + text.slice(end + MARKER_END.length));
}

if (checkOnly) {
  let drifted = false;
  for (const spec of Object.values(upstreams)) {
    const latest = registryVersion(spec.package);
    const isDrift = latest !== spec.version;
    if (isDrift) drifted = true;
    log(`${isDrift ? "DRIFT" : "OK   "} ${spec.package}: pinned ${spec.version}, latest ${latest}`);
  }
  if (drifted) {
    log("\nRun: node scripts/sync-upstream.mjs --designer=latest --ux=latest");
    process.exit(1);
  }
  process.exit(0);
}

const designerRequest = typeof flags.get("designer") === "string" ? flags.get("designer") : undefined;
const uxRequest = typeof flags.get("ux") === "string" ? flags.get("ux") : undefined;

fs.mkdirSync(VENDOR_DIR, { recursive: true });
fs.mkdirSync(SKILLS_DIR, { recursive: true });

const ompDesigner = vendorOne(upstreams["omp-designer"], designerRequest);
log(`→ omp-designer@${ompDesigner.resolved}: ${ompDesigner.files.length} files`);

const piUx = vendorOne(upstreams["pi-ux"], uxRequest);
log(`→ @bacnh85/pi-ux@${piUx.resolved}: ${piUx.files.length} files`);

const generatedSkills = generateSkills({ ompDesigner, piUx });
log(`→ generated ${Object.values(generatedSkills).filter((skill) => skill.emitted).length} skill documents`);

const pinFile = path.join(ROOT, "scripts", "upstreams.json");
for (const [key, spec] of Object.entries(upstreams)) {
  const resolved = key === "omp-designer" ? ompDesigner.resolved : piUx.resolved;
  const raw = fs.readFileSync(pinFile, "utf8");
  const next = raw.replace(`"version": "${spec.version}"`, `"version": "${resolved}"`);
  if (next !== raw) {
    fs.writeFileSync(pinFile, next);
    log(`→ pin updated: ${spec.package} -> ${resolved}`);
  }
}

const manifest = {
  generatedBy: "scripts/sync-upstream.mjs",
  generatorVersion: 1,
  sources: {
    "omp-designer": {
      package: upstreams["omp-designer"].package,
      version: ompDesigner.resolved,
      role: upstreams["omp-designer"].role,
      homepage: upstreams["omp-designer"].homepage,
      files: ompDesigner.hashes,
      excluded: ompDesigner.excluded,
      notes: upstreams["omp-designer"].notes ?? [],
    },
    "pi-ux": {
      package: upstreams["pi-ux"].package,
      version: piUx.resolved,
      role: upstreams["pi-ux"].role,
      homepage: upstreams["pi-ux"].homepage,
      files: piUx.hashes,
      excluded: piUx.excluded,
      notes: upstreams["pi-ux"].notes ?? [],
    },
  },
  generatedSkills,
};
fs.writeFileSync(path.join(VENDOR_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
updateNotices({ ompDesigner, piUx });
log("→ wrote vendor/manifest.json");
