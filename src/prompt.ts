/**
 * Prompt construction.
 *
 * Two jobs: a compact standing block for the current phase (so every turn
 * stays inside the contract), and the turn text that `/studio <phase>` sends
 * to start the phase. Skills stay conditional — the block names the skill, it
 * never inlines the whole corpus.
 */
import { behaviorFor, PROFILES, type PhaseId, type Profile, type UxLevel } from "./profiles.ts";

export const MARKER_START = "[UI STUDIO";
export const MARKER_END = "[/UI STUDIO]";

function stripBlock(text: string): string {
  const start = text.indexOf(MARKER_START);
  if (start === -1) return text;
  const end = text.indexOf(MARKER_END, start);
  return end === -1 ? text.slice(0, start) : `${text.slice(0, start)}${text.slice(end + MARKER_END.length)}`.trim();
}

/** Normalize the host system prompt into an array we can append to. */
export function normalizePrompt(systemPrompt: string | string[] | undefined): string[] {
  if (typeof systemPrompt === "string") return [systemPrompt];
  if (Array.isArray(systemPrompt)) return systemPrompt.map((part) => stripBlock(String(part)));
  return [];
}

/** Compact standing instructions for profile × phase. */
export function orchestrationBlock(profile: Profile, phase: PhaseId, uxLevel: UxLevel, uxText: string | null): string {
  const behavior = behaviorFor(profile, phase);
  const parts = [
    `${MARKER_START}: ${profile.label} · ${phase}]`,
    "Designer creates visual direction. Pi UX constrains deterministically. Studio orchestrates. " +
      "DESIGN.md at the project root is the shared contract: user instructions win, accessibility failures get fixed rather than overridden, and the UX engine never redesigns on its own.",
    `Designer: ${behavior.designer === "active" ? "leading" : "supporting"} (exploration ${profile.designer.exploration}).`,
    `Pi UX: ${uxLevel}${behavior.blocking ? " — blocking in this phase" : " — advisory in this phase"}.`,
    "Workflow detail lives in skill://studio-orchestrator; read it before acting on this phase.",
  ];
  if (uxText) parts.push(uxText);
  parts.push(MARKER_END);
  return parts.join("\n");
}

/** The turn that `/studio <phase>` sends to start the phase. */
export function phaseTurn(profile: Profile, phase: PhaseId): string {
  const behavior = behaviorFor(profile, phase);
  return [
    `UI Studio · ${profile.label} · ${phase.toUpperCase()}`,
    "",
    ...behavior.plan.map((line) => `- ${line}`),
    "",
    "Read skill://studio-orchestrator first, then follow its section for this phase.",
    "DESIGN.md at the project root is the contract; do not fork it.",
  ].join("\n");
}

export function studioOnText(profileId: string): string {
  const profile = PROFILES[profileId as keyof typeof PROFILES];
  return [
    `UI Studio is on · ${profile.label}`,
    "",
    `  Designer   exploration ${profile.designer.exploration}, ${profile.designer.visualReviews} visual reviews, ${profile.designer.repairLoops} repair loop(s)`,
    `  Pi UX      ${profile.ux.duringBuild} during build, ${profile.ux.finalAudit} at audit`,
    "",
    "Phases: /studio explore · build · review · audit",
    "Modes:   /studio mode balanced | design-first | ux-first",
    "Status:  /studio status   Doctor: /studio doctor   Pause: /studio off",
  ].join("\n");
}

export function usageText(): string {
  return [
    "UI Studio — designer taste plus UX rigor, one install.",
    "",
    "  /studio                      enable Studio with the current profile",
    "  /studio explore              concepts, hierarchy, art direction, references",
    "  /studio build                implement inside DESIGN.md and profile guardrails",
    "  /studio review               render, screenshot, critique, bounded repair",
    "  /studio audit                strict deterministic gate — blocking",
    "  /studio mode <profile>       balanced | design-first | ux-first",
    "  /studio status               current profile, phase and gate",
    "  /studio doctor               vendor integrity, engines, DESIGN.md",
    "  /studio off                  pause Studio for this project",
  ].join("\n");
}
