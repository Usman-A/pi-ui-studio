/**
 * Designer engine adapter — deterministic validators and the DESIGN.md contract
 * check from the vendored omp-designer engine.
 *
 * The subjective half of the designer (art direction, hierarchy, type, motion)
 * lives in its skills; only its computable checks are reachable from code.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectDesignSchema, type DesignSchemaReport } from "../contract.ts";

export const DESIGNER_VENDOR_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "vendor",
  "omp-designer",
);

export const SLOP_SCRIPT = path.join(DESIGNER_VENDOR_DIR, "scripts", "fix-ai-slop.mjs");
export const LAYOUT_SCRIPT = path.join(DESIGNER_VENDOR_DIR, "scripts", "analyze-layout.mjs");
export const PALETTE_DATA = path.join(DESIGNER_VENDOR_DIR, "data", "ui-ux-pro-max");

export interface ValidatorResult {
  name: string;
  ok: boolean;
  skipped: string | null;
  output: string;
}

export interface DesignContract {
  path: string;
  exists: boolean;
  schema: DesignSchemaReport | null;
}

function nodeBinary(): string {
  return process.env.STUDIO_NODE || "node";
}

/** Run one vendored validator as a read-only subprocess. */
export function runValidator(name: string, script: string, args: string[], cwd: string): ValidatorResult {
  if (!fs.existsSync(script)) {
    return { name, ok: false, skipped: `validator missing: ${script}`, output: "" };
  }
  const run = spawnSync(nodeBinary(), [script, ...args], { cwd, encoding: "utf8", timeout: 120_000 });
  if (run.error) {
    return { name, ok: false, skipped: `could not run ${name}: ${run.error.message}`, output: "" };
  }
  return { name, ok: run.status === 0, skipped: null, output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() };
}

/** Locate the DESIGN.md that governs a project directory and check its schema. */
export function findDesignContract(cwd: string): DesignContract {
  let dir = path.resolve(cwd);
  let found: string | null = null;
  for (;;) {
    const candidate = path.join(dir, "DESIGN.md");
    if (fs.existsSync(candidate)) {
      found = candidate;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const target = found ?? path.join(path.resolve(cwd), "DESIGN.md");
  if (!found) return { path: target, exists: false, schema: null };
  return { path: target, exists: true, schema: inspectDesignSchema(fs.readFileSync(target, "utf8")) };
}

/**
 * Both designer validators, plus the shared design contract.
 *
 * The layout validator is Studio's audit-phase gate: it hard-requires
 * `DESIGN.md` and a declared palette — the right bar before handoff, and the
 * wrong bar while a screen is still being built.
 */
export function designerReport(
  cwd: string,
  options: { includeLayout: boolean },
): { contract: DesignContract; validators: ValidatorResult[] } {
  const validators = [runValidator("ai-slop", SLOP_SCRIPT, ["--check", cwd], cwd)];
  if (options.includeLayout) validators.push(runValidator("layout", LAYOUT_SCRIPT, [cwd], cwd));
  return { contract: findDesignContract(cwd), validators };
}
