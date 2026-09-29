/**
 * Human-facing output for `/studio status`, phase kicks and `/studio doctor`.
 * Concise by design: these are read in a terminal, not a log file.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { behaviorFor, PROFILES, type PhaseId, type SessionPhase } from "./profiles.ts";
import { agentDir, configPath, type SessionState, type StudioConfig } from "./state.ts";
import { uxKernel } from "./adapters/ux.ts";
import { findDesignContract } from "./adapters/designer.ts";
import { SKILLS_DIR, checkVendorTree } from "./vendor.ts";

const DESIGNER_MODE_NOTE: Record<string, string> = {
  off: "Off",
  studio: "Studio-ruled (engine live)",
  upstream: "Upstream-ruled (prompt + 12-skill gate)",
};

export function designerStatusText(config: StudioConfig): string {
  const profile = PROFILES[config.profile];
  return [
    `Designer engine · ${DESIGNER_MODE_NOTE[config.designerEngine] ?? config.designerEngine}`,
    "",
    `  Intensity   exploration ${profile.designer.exploration}, ${profile.designer.visualReviews} visual reviews, ${profile.designer.repairLoops} repair loop(s)`,
    "  Studio      commands, skills, validators and doctor are live in every mode",
    "  Upstream    adds its own prompt injection, its deny-by-default 12-skill gate and session-stop checks",
    "",
    "Set with /studio designer <off | studio | upstream>.",
  ].join("\n");
}

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
    row("Engine", DESIGNER_MODE_NOTE[config.designerEngine] ?? config.designerEngine),
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
    `Design  ${
      contract.exists
        ? `OK — ${contract.path} (${contract.schema?.hexCount ?? 0} hex tokens, schema ${contract.schema?.ok ? "canonical" : "non-canonical"})`
        : `MISSING — expected ${contract.path}`
    }`,
  );

  const authored = fs.existsSync(path.join(SKILLS_DIR, "studio-orchestrator", "SKILL.md"));
  const generated = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "studio-orchestrator").length;
  lines.push(`Skills  ${authored ? "OK" : "BROKEN"} — orchestrator ${authored ? "present" : "missing"}, ${generated} vendored`);

  const agent = agentDir();
  const managed = fs.existsSync(path.join(agent, "managed-skills")) ? fs.readdirSync(path.join(agent, "managed-skills")) : [];
  const engineDir = path.join(agent, "extensions", "designer");
  const engineScripts = fs.existsSync(engineDir) ? fs.readdirSync(engineDir) : [];
  lines.push(
    `Engine  ${DESIGNER_MODE_NOTE[config.designerEngine] ?? config.designerEngine}` +
      ` — runtime files: ${managed.length} managed skills, ${engineScripts.length} validators` +
      (config.designerEngine === "off" ? " (engine paused)" : ""),
  );
  lines.push("", `Config  ${configPath()} — profile ${config.profile}, ux override ${config.uxOverride ?? "none"}`);
  lines.push(`Phase   ${PHASE_LABEL[session.phase]}`);
  return lines.join("\n");
}
