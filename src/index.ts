/**
 * UI Studio — OMP extension entry point.
 *
 * One package, one command surface (`/studio`), two engines underneath:
 * the vendored designer content and validators, and the vendored pi-ux audit
 * kernel. Studio owns orchestration: which engine runs, how hard, and whether
 * a phase blocks.
 */
import {
  PROFILES,
  PROFILE_IDS,
  behaviorFor,
  isPhaseId,
  isProfileId,
  isUxLevel,
  type PhaseId,
  type UxLevel,
} from "./profiles.ts";
import {
  INITIAL_SESSION_STATE,
  SESSION_ENTRY_TYPE,
  agentDir,
  loadConfig,
  replaySessionState,
  saveConfig,
  type SessionState,
  type StudioConfig,
} from "./state.ts";
import { doctorText, designerStatusText, phaseBriefText, statusText } from "./report.ts";
import {
  DESIGNER_ENGINE_MODES,
  activateDesignerEngine,
  isDesignerEngineMode,
  type DesignerEngineHandle,
  type DesignerEngineMode,
} from "./adapters/designer-engine.ts";
import { MARKER_END, MARKER_START, normalizePrompt, orchestrationBlock, phaseTurn, studioOnText, usageText } from "./prompt.ts";
import { registerStudioCheck, registerUxAudit, type StudioRuntime } from "./tools.ts";
import { uxInstructions } from "./adapters/ux.ts";
import type { CommandDefinition, ExtensionAPI, StudioContext } from "./types.ts";

const MAX_AUDIT_CONTINUATIONS = 3;

function resolvePhase(config: StudioConfig, phase: PhaseId): UxLevel {
  if (config.uxOverride) return config.uxOverride;
  return behaviorFor(PROFILES[config.profile], phase).ux;
}

function parseStudioCommand(rawArgs: string): { verb: string; argument: string } {
  const parts = String(rawArgs ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return { verb: (parts[0] ?? "").toLowerCase(), argument: parts.slice(1).join(" ").trim() };
}

export default function uiStudio(pi: ExtensionAPI): void {
  let config: StudioConfig = loadConfig();
  let designer: DesignerEngineHandle | null = null;

  /**
   * Activation is best-effort: a designer engine that cannot load must degrade
   * Studio to content-plus-validators, never take the session down with it.
   */
  async function applyDesignerMode(ctx: StudioContext, mode: DesignerEngineMode): Promise<string> {
    if (mode === "off") {
      designer?.setMode("off");
      return "Designer engine paused. Studio keeps DESIGN.md and the UX engine.";
    }
    if (designer) {
      designer.setMode(mode);
      return mode === "upstream"
        ? "Designer engine: upstream mode — its prompt, 12-skill gate and session-stop checks are now enforced."
        : "Designer engine: studio mode — commands, skills and validators live; Studio keeps the prompt and the gate.";
    }
    try {
      designer = await activateDesignerEngine(pi, { agentDir: agentDir(), mode, cwd: ctx.cwd ?? process.cwd() });
      return designer
        ? `Designer engine active (${mode}): ${designer.commands.join(", ")}`
        : "Designer engine could not start.";
    } catch (error) {
      ctx.ui?.notify?.(`Designer engine failed to load: ${(error as Error).message}`, "warning");
      return "Designer engine unavailable; Studio continues without it.";
    }
  }
  let session: SessionState = { ...INITIAL_SESSION_STATE };

  const runtime = (): StudioRuntime => ({ config, session });

  function persistSession(next: Partial<SessionState>): void {
    session = { ...session, ...next };
    pi.appendEntry?.(SESSION_ENTRY_TYPE, session);
  }

  function recordAudit(passed: boolean, summary: string): void {
    if (!config.enabled || session.phase !== "audit") return;
    persistSession({
      audit: { passed, summary, at: new Date().toISOString() },
      auditPrompts: passed ? 0 : session.auditPrompts,
    });
  }

  /**
   * Reports go into the composer where the user can read and copy them; hosts
   * without an editor (RPC, headless) get the whole report as a notification
   * rather than silently losing it.
   */
  function showReport(ctx: StudioContext, report: string, summary: string): void {
    if (ctx.ui?.setEditorText) {
      ctx.ui.setEditorText(report);
      ctx.ui?.notify?.(summary, "info");
      return;
    }
    ctx.ui?.notify?.(`${summary}\n\n${report}`, "info");
  }

  function syncStatus(ctx: StudioContext): void {
    if (!config.enabled || !ctx.ui?.setStatus) {
      ctx.ui?.setStatus?.("studio", "");
      return;
    }
    ctx.ui.setStatus("studio", `🎨 ${PROFILES[config.profile].label} · ${session.phase}`);
  }

  // ── Commands ───────────────────────────────────────────────────────────

  const completions = (vocab: string[]) => (prefix: string) => {
    const query = String(prefix ?? "").trim().toLowerCase();
    const items = vocab.filter((entry) => entry.startsWith(query)).map((value) => ({ value, label: value }));
    return items.length > 0 ? items : null;
  };

  const studioCommand: CommandDefinition = {
    description: "UI Studio: designer taste + UX rigor (explore | build | review | audit | mode | status | doctor | off)",
    aliases: ["ui-studio"],
    getArgumentCompletions: completions([
      "explore",
      "build",
      "review",
      "audit",
      "mode",
      "designer",
      "status",
      "doctor",
      "on",
      "off",
      "help",
      ...PROFILE_IDS,
      ...DESIGNER_ENGINE_MODES,
    ]),
    handler: async (rawArgs, ctx) => {
      const { verb, argument } = parseStudioCommand(rawArgs);
      const cwd = ctx.cwd ?? process.cwd();

      if (verb === "help" || verb === "?") {
        showReport(ctx, usageText(), "UI Studio commands");
        return;
      }

      if (verb === "off") {
        config = { ...config, enabled: false };
        saveConfig(config);
        persistSession({ phase: "idle", audit: null, auditPrompts: 0 });
        if (designer) await applyDesignerMode(ctx, "off");
        ctx.ui?.notify?.("UI Studio paused for this project. /studio turns it back on.", "info");
        syncStatus(ctx);
        ctx.ui?.setEditorText?.("");
        return;
      }

      if (verb === "on" || verb === "") {
        config = { ...config, enabled: true };
        saveConfig(config);
        if (designer && config.designerEngine !== "off") await applyDesignerMode(ctx, config.designerEngine);
        ctx.ui?.notify?.(studioOnText(config.profile), "info");
        syncStatus(ctx);
        ctx.ui?.setEditorText?.("");
        return;
      }

      if (verb === "mode") {
        if (!isProfileId(argument)) {
          ctx.ui?.notify?.(`Unknown profile "${argument}". Use: ${PROFILE_IDS.join(" | ")}.`, "warning");
          return;
        }
        config = { ...config, profile: argument, enabled: true };
        saveConfig(config);
        syncStatus(ctx);
        ctx.ui?.notify?.(`UI Studio mode: ${PROFILES[argument].label}`, "info");
        ctx.ui?.setEditorText?.("");
        return;
      }


      if (verb === "designer") {
        if (argument === "" || argument === "status") {
          ctx.ui?.notify?.(designerStatusText(config), "info");
          return;
        }
        if (!isDesignerEngineMode(argument)) {
          ctx.ui?.notify?.(`Unknown designer mode "${argument}". Use: ${DESIGNER_ENGINE_MODES.join(" | ")}.`, "warning");
          return;
        }
        config = { ...config, designerEngine: argument, enabled: true };
        saveConfig(config);
        const applied = await applyDesignerMode(ctx, argument);
        ctx.ui?.notify?.(applied, "info");
        ctx.ui?.setEditorText?.("");
        return;
      }
      if (verb === "status") {
        showReport(ctx, statusText(config, session, cwd), `UI Studio · ${PROFILES[config.profile].label} · ${session.phase}`);
        return;
      }

      if (verb === "doctor") {
        const report = await doctorText(config, session, cwd);
        showReport(ctx, report, "UI Studio doctor report");
        return;
      }

      if (!isPhaseId(verb)) {
        showReport(ctx, usageText(), `Unknown /studio verb "${verb}"`);
        return;
      }

      const phase: PhaseId = verb;
      config = { ...config, enabled: true };
      saveConfig(config);
      persistSession({ phase, audit: null, auditPrompts: 0 });
      syncStatus(ctx);
      ctx.ui?.notify?.(phaseBriefText(config, phase), "info");
      ctx.ui?.setEditorText?.("");
      pi.sendUserMessage?.(phaseTurn(PROFILES[config.profile], phase), { attribution: "agent" });
    },
  };

  pi.registerCommand("studio", studioCommand);

  pi.registerCommand("ux", {
    description: "UX engine level: off | lite | strict (owned by UI Studio)",
    getArgumentCompletions: completions(["off", "lite", "strict", "status"]),
    handler: async (rawArgs, ctx) => {
      const { verb } = parseStudioCommand(rawArgs);
      if (verb === "status" || verb === "") {
        const profile = PROFILES[config.profile];
        ctx.ui?.notify?.(
          `UX engine · ${profile.label} — ${profile.ux.duringBuild} during build, ${profile.ux.finalAudit} at audit` +
            ` · override ${config.uxOverride ?? "none"}`,
          "info",
        );
        return;
      }
      if (!isUxLevel(verb)) {
        ctx.ui?.notify?.("Usage: /ux off | /ux lite | /ux strict", "warning");
        return;
      }
      const level: UxLevel = verb;
      config = { ...config, uxOverride: level };
      saveConfig(config);
      ctx.ui?.notify?.(`UX engine level: ${level}`, "info");
    },
  });

  // ── Tools ──────────────────────────────────────────────────────────────

  registerUxAudit(pi);
  registerStudioCheck(pi, runtime, recordAudit);

  // ── Runtime ────────────────────────────────────────────────────────────

  pi.setLabel?.("UI Studio");

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig();
    session = replaySessionState(ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? []);
    // Registering the engine's commands twice would duplicate them, so this
    // runs once per process; later changes go through /studio designer.
    if (config.enabled && config.designerEngine !== "off" && !designer) {
      await applyDesignerMode(ctx, config.designerEngine);
    }
    syncStatus(ctx);
  });

  pi.on("session_branch", (_event, ctx) => {
    session = replaySessionState(ctx.sessionManager?.getBranch?.() ?? []);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!config.enabled || session.phase === "idle") return undefined;
    const profile = PROFILES[config.profile];
    const uxLevel = resolvePhase(config, session.phase as PhaseId);
    const uxText = uxLevel === "off" ? null : await uxInstructions(uxLevel);
    const base = normalizePrompt((event as { systemPrompt?: string | string[] } | undefined)?.systemPrompt);
    return { systemPrompt: [...base, orchestrationBlock(profile, session.phase as PhaseId, uxLevel, uxText)] };
  });

  pi.on("session_stop", (_event, ctx) => {
    if (!config.enabled || session.phase !== "audit") return undefined;
    if (session.audit?.passed) return undefined;
    if (session.auditPrompts >= MAX_AUDIT_CONTINUATIONS) {
      ctx.ui?.notify?.(
        `UI Studio audit gate: still failing after ${session.auditPrompts} continuations — fix or leave /studio audit.`,
        "warning",
      );
      return undefined;
    }
    persistSession({ auditPrompts: session.auditPrompts + 1 });
    return {
      continue: true,
      additionalContext: [
        "[UI STUDIO: AUDIT GATE]",
        "You are in the audit phase and the deterministic gate has not passed.",
        session.audit ? `Last run: ${session.audit.summary}` : "studio_check has not passed yet.",
        "",
        "Run studio_check on the real stylesheet, fix every blocking issue it reports, and run it again.",
        "Do not report the UI as complete while genuine blocking failures remain.",
        "[/UI STUDIO: AUDIT GATE]",
      ].join("\n"),
    };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui?.setStatus?.("studio", "");
  });
}

export { MARKER_START, MARKER_END };
