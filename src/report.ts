/**
 * Human-facing output for `/studio status`, phase kicks and `/studio doctor`.
 * Concise by design: these are read in a terminal, not a log file.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { behaviorFor, PROFILES, type PhaseId, type SessionPhase } from "./profiles.ts";
import type { SessionState, StudioConfig } from "./state.ts";
import { configPath } from "./state.ts";
import { uxKernel } from "./adapters/ux.ts";
import { findDesignContract } from "./adapters/designer.ts";
import { SKILLS_DIR, checkVendorTree } from "./vendor.ts";

const PHASE_LABEL: Record<SessionPhase, string> = {
  idle: "Idle",
  explore: "Explore",
  build: "Build",
  review: "Review",
  audit: "Audit",
};

function row(label: string, value: string, width = 15): string {
  return `  ${label.padEnd(width, " ")}${value}`;
}

export function statusText(config: StudioConfig, session: SessionState, cwd: string): string {
  const profile = PROFILES[config.profile];
  if (!config.enabled) {
    return `PI UI STUDIO\n\nMode  Off\n\nRun /studio to switch ${profile.label} back on.`;
  }

  const contract = findDesignContract(cwd);
  const lines = [
    "PI UI STUDIO",
    "",
    row("Mode", profile.label),
    row("Phase", PHASE_LABEL[session.phase]),
    "",
    "Designer",
    row("Direction", profile.designer.exploration),
    row("References", profile.designer.referenceStudy ? "On" : "Off"),
    row("Visual Reviews", String(profile.designer.visualReviews)),
    row("Repair Loops", String(profile.designer.repairLoops)),
    "",
    "Pi UX",
    row("During Build", profile.ux.duringBuild),
    row("Final Audit", profile.ux.finalAudit),
    row("Override", config.uxOverride ?? "—"),
    "",
    row("DESIGN.md", contract.exists ? `Active (${path.basename(contract.path)})` : "Not found"),
    row("ux_audit", "Available"),
  ];

  if (session.phase === "audit") {
    lines.push(row("Audit gate", session.audit ? (session.audit.passed ? "Passed" : "Failed") : "Not run"));
  }

  return lines.join("\n");
}

/** The short "here is what this phase will do" preview. */
export function phaseBriefText(config: StudioConfig, phase: PhaseId): string {
  const profile = PROFILES[config.profile];
  const behavior = behaviorFor(profile, phase);
  const gate = behavior.blocking ? "Blocking" : "Advisory";
  return [
    `UI Studio · ${profile.label} · ${PHASE_LABEL[phase]}`,
    "",
    "Designer",
    ...behavior.plan.filter((line) => line.startsWith("Designer")).map((line) => `  • ${line}`),
    "",
    "Pi UX",
    ...behavior.plan.filter((line) => line.startsWith("Pi UX")).map((line) => `  • ${line}`),
    "",
    `Gate: ${gate}`,
  ].join("\n");
}

export async function doctorText(config: StudioConfig, session: SessionState, cwd: string): Promise<string> {
  const lines = ["PI UI STUDIO · DOCTOR", ""];
  const vendor = checkVendorTree();
  lines.push(`Vendor  ${vendor.ok ? "OK" : "PROBLEM"}`);
  for (const source of vendor.sources) {
    lines.push(`  ${source.package}@${source.version} — ${source.files} files, ${source.skills} skills`);
  }
  for (const issue of vendor.issues) lines.push(`  ! ${issue}`);

  try {
    const kernel = await uxKernel();
    lines.push(`UX      OK — audit kernel loaded, modes: ${kernel.modes.join("|")}`);
  } catch (error) {
    lines.push(`UX      BROKEN — ${(error as Error).message}`);
  }

  const node = spawnSync(process.env.STUDIO_NODE || "node", ["--version"], { encoding: "utf8" });
  lines.push(`Node    ${node.status === 0 ? `OK — ${String(node.stdout).trim()}` : "MISSING — set STUDIO_NODE"}`);

  const contract = findDesignContract(cwd);
  lines.push(
    `Design  ${contract.exists ? `OK — ${contract.path} (${contract.hexCount} hex tokens${contract.hasFrontmatter ? ", frontmatter" : ", no frontmatter"})` : `MISSING — expected ${contract.path}`}`,
  );

  const authored = fs.existsSync(path.join(SKILLS_DIR, "studio-orchestrator", "SKILL.md"));
  const generated = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "studio-orchestrator").length;
  lines.push(`Skills  ${authored ? "OK" : "BROKEN"} — orchestrator ${authored ? "present" : "missing"}, ${generated} vendored`);

  lines.push("", `Config  ${configPath()} — profile ${config.profile}, ux override ${config.uxOverride ?? "none"}`);
  lines.push(`Phase   ${PHASE_LABEL[session.phase]}`);
  return lines.join("\n");
}
