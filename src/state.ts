/**
 * Studio state: a small persisted config plus per-session orchestration state
 * replayed from session entries.
 *
 * Config survives across sessions (profile choice). Phase and audit gate live
 * in the session transcript so a resumed session resumes the same phase.
 */
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { DEFAULT_PROFILE, isProfileId, isUxLevel, type ProfileId, type SessionPhase, type UxLevel } from "./profiles.ts";

export const SESSION_ENTRY_TYPE = "pi-ui-studio.state";

export interface StudioConfig {
  profile: ProfileId;
  /** Explicit UX level from `/ux <level>`; null means "follow the profile". */
  uxOverride: UxLevel | null;
  enabled: boolean;
}

export const DEFAULT_CONFIG: StudioConfig = {
  profile: DEFAULT_PROFILE,
  uxOverride: null,
  enabled: true,
};

export interface AuditState {
  passed: boolean;
  summary: string;
  at: string;
}

export interface SessionState {
  phase: SessionPhase;
  audit: AuditState | null;
  /** Continuations Studio has already requested for a failing audit gate. */
  auditPrompts: number;
}

export const INITIAL_SESSION_STATE: SessionState = { phase: "idle", audit: null, auditPrompts: 0 };

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".omp", "agent");
}

export function configPath(): string {
  return path.join(agentDir(), "pi-ui-studio.json");
}

export function loadConfig(file = configPath()): StudioConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StudioConfig>;
    return {
      profile: isProfileId(parsed.profile) ? parsed.profile : DEFAULT_PROFILE,
      uxOverride: isUxLevel(parsed.uxOverride) ? parsed.uxOverride : null,
      enabled: parsed.enabled !== false,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: StudioConfig, file = configPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

function isStateData(value: unknown): value is Partial<SessionState> & { audit?: AuditState } {
  return Boolean(value) && typeof value === "object";
}

/** Rebuild session state from the tail of the current branch. */
export function replaySessionState(entries: readonly unknown[]): SessionState {
  const state: SessionState = { ...INITIAL_SESSION_STATE };
  for (const entry of entries) {
    const record = entry as { type?: string; customType?: string; data?: unknown };
    if (record?.type !== "custom" || record.customType !== SESSION_ENTRY_TYPE || !isStateData(record.data)) continue;
    const data = record.data;
    if (typeof data.phase === "string") state.phase = data.phase as SessionPhase;
    state.audit = data.audit ?? null;
    state.auditPrompts = typeof data.auditPrompts === "number" ? data.auditPrompts : 0;
  }
  return state;
}
