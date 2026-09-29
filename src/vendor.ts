/**
 * Vendor integrity: what the sync wrote, and whether the tree on disk still
 * matches it. Used by `/studio doctor` and by the upstream contract tests, so
 * a drift or a broken install shows up as a named failure instead of a mystery.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VENDOR_DIR = path.join(PACKAGE_ROOT, "vendor");
export const SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");
export const MANIFEST_PATH = path.join(VENDOR_DIR, "manifest.json");

export interface VendorSource {
  package: string;
  version: string;
  role: string;
  homepage: string;
  files: Record<string, { sha256: string; bytes: number }>;
  excluded: { path: string; reason: string }[];
  notes?: string[];
}

export interface VendorManifest {
  generatedBy: string;
  generatorVersion: number;
  sources: Record<string, VendorSource>;
  generatedSkills: Record<string, { emitted: boolean; upstream?: string; transforms?: string[]; reason?: string }>;
}

export interface VendorCheck {
  ok: boolean;
  issues: string[];
  sources: { name: string; package: string; version: string; files: number; skills: number }[];
}

export function readVendorManifest(): VendorManifest | null {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as VendorManifest;
  } catch {
    return null;
  }
}

/** Confirm every recorded vendored file still matches its recorded digest. */
export function checkVendorTree(): VendorCheck {
  const manifest = readVendorManifest();
  if (!manifest) {
    return { ok: false, issues: [`vendor manifest missing at ${MANIFEST_PATH} — run: npm run sync`], sources: [] };
  }

  const issues: string[] = [];
  const sources: VendorCheck["sources"] = [];

  for (const [key, source] of Object.entries(manifest.sources)) {
    const dir = path.join(VENDOR_DIR, key === "omp-designer" ? "omp-designer" : "pi-ux");
    let files = 0;
    for (const [rel, meta] of Object.entries(source.files)) {
      const file = path.join(dir, rel);
      if (!fs.existsSync(file)) {
        issues.push(`${source.package}: missing ${rel}`);
        continue;
      }
      const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (digest !== meta.sha256) issues.push(`${source.package}: ${rel} was modified after sync`);
      files += 1;
    }
    const skills = Object.entries(manifest.generatedSkills).filter(([, meta]) => meta.upstream === `${source.package}@${source.version}`).length;
    sources.push({ name: key, package: source.package, version: source.version, files, skills });
  }

  return { ok: issues.length === 0, issues, sources };
}
