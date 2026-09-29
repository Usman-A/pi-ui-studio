/**
 * Designer-engine policy adapter.
 *
 * Loads the vendored `omp-designer` extension for real, without patching it.
 * Three shims make it work from inside a package, and one proxy decides what
 * Studio enforces:
 *
 *  1. Path shim — the upstream module captures `os.homedir()` at import time.
 *     Studio imports it with a temporary home whose `.omp/agent` points at the
 *     real agent directory, so every hardcoded upstream path resolves correctly.
 *  2. Runtime files — upstream reads its skills from
 *     `<agent>/managed-skills/<name>/SKILL.md` and its validators from
 *     `<agent>/extensions/designer/*.mjs`. Studio materialises both by
 *     **copying**, never symlinking: NTFS symlinks need Developer Mode or
 *     admin, and a copied file is deterministic on macOS, Linux and Windows.
 *  3. Policy proxy — upstream wants to own the prompt, the tool gate and
 *     session-stop enforcement. Studio decides, per mode, which of those it
 *     honours.
 *
 * Modes:
 *   off       — engine not loaded at all
 *   studio    — commands, skills, validators and doctor are live; Studio keeps
 *               the prompt and the gate (default)
 *   upstream  — upstream behaviour verbatim: prompt injection, 12-skill gate and
 *               session-stop enforcement
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExtensionAPI, StudioContext } from "../types.ts";
import { SKILLS_DIR } from "../vendor.ts";
import { LAYOUT_SCRIPT, SLOP_SCRIPT } from "./designer.ts";

export type DesignerEngineMode = "off" | "studio" | "upstream";

export const DESIGNER_ENGINE_MODES: DesignerEngineMode[] = ["off", "studio", "upstream"];

export function isDesignerEngineMode(value: unknown): value is DesignerEngineMode {
  return value === "off" || value === "studio" || value === "upstream";
}

/** Upstream manifest order — designer-master must be read first. */
const DESIGNER_SKILLS = [
  "designer-master",
  "ai-slop",
  "product-md",
  "taste-skill",
  "design-md",
  "ui-ux-pro-max",
  "reference-study",
  "copywriting",
  "scroll-choreography",
  "animate",
  "visual-critique",
  "review-skill",
] as const;

/** Upstream stores this skill under a different directory name. */
const SKILL_DIR_ALIASES: Record<string, string> = { "ui-ux-pro-max": "ui-ux-pro-max-skill" };

const VALIDATOR_SCRIPTS = { "fix-ai-slop.mjs": SLOP_SCRIPT, "analyze-layout.mjs": LAYOUT_SCRIPT };

export const DESIGNER_EXTENSION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "vendor",
  "omp-designer",
  "extension",
  "index.ts",
);

export interface RuntimeReport {
  skills: string[];
  scripts: string[];
  /** Runtime files are copied, never linked — see the module docblock. */
  method: "copy";
}

export interface DesignerEngineHandle {
  mode: DesignerEngineMode;
  commands: string[];
  setMode: (mode: DesignerEngineMode) => void;
}

// Keyed by agent directory and populated at runtime, so a Map (not a literal
// lookup table) is the right shape.
const moduleCache = new Map<string, Promise<DesignerExtensionFactory>>();

/**
 * The upstream module captures its paths at first import, so one process binds
 * to one agent directory. A host launches one agent directory per process; a
 * second request is a host bug, not something to paper over.
 */
let boundAgentDir: string | null = null;
type DesignerExtensionFactory = (pi: ExtensionAPI) => void;

function writeIfChanged(target: string, content: string): void {
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * Materialise the paths the upstream engine expects inside the agent directory.
 * Idempotent: unchanged files are left alone.
 */
export function ensureDesignerRuntime(agentDir: string): RuntimeReport {
  const skills: string[] = [];
  for (const name of DESIGNER_SKILLS) {
    const source = path.join(SKILLS_DIR, name, "SKILL.md");
    if (!fs.existsSync(source)) continue;
    const target = path.join(agentDir, "managed-skills", SKILL_DIR_ALIASES[name] ?? name, "SKILL.md");
    writeIfChanged(target, fs.readFileSync(source, "utf8"));
    skills.push(name);
  }

  const scripts: string[] = [];
  for (const [file, source] of Object.entries(VALIDATOR_SCRIPTS)) {
    if (!fs.existsSync(source)) continue;
    writeIfChanged(path.join(agentDir, "extensions", "designer", file), fs.readFileSync(source, "utf8"));
    scripts.push(file);
  }

  return { skills, scripts, method: "copy" };
}

/** Upstream's global on/off key in `designer-state.json`. */
const GLOBAL_STATE_KEY = "*";

/** Turn the engine on or off in the state file the upstream module reads per call. */
export function setDesignerEngineState(agentDir: string, cwd: string, enabled: boolean): void {
  const file = path.join(agentDir, "designer-state.json");
  let state: Record<string, boolean> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object") state = parsed as Record<string, boolean>;
  } catch {
    state = {};
  }
  // Upstream consults `state[cwd] || state["*"]` with the session cwd, while its
  // own /designer toggle writes `process.cwd()`. Writing both keys keeps the two
  // commands talking to one state file however the host was launched.
  state[cwd] = enabled;
  if (enabled) state[GLOBAL_STATE_KEY] = true;
  else delete state[GLOBAL_STATE_KEY];

  // Prune projects that no longer exist, so the file does not grow a key per
  // deleted directory forever.
  const live = Object.fromEntries(
    Object.entries(state).filter(([key]) => key === GLOBAL_STATE_KEY || fs.existsSync(key)),
  );

  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(live));
}

/**
 * Import the upstream module with a temporary home.
 *
 * `os.homedir()` reads `HOME` on macOS and Linux but `USERPROFILE` on Windows,
 * so both are redirected for the duration of the import and restored after —
 * the upstream module has already captured its constants by then.
 */
function importDesignerExtension(agentDir: string): Promise<DesignerExtensionFactory> {
  const cached = moduleCache.get(agentDir);
  if (cached) return cached;

  const loading = (async () => {
    // The shim must outlive the import: upstream captures these path *strings*
    // at module load, so deleting the home would break every later read. It
    // lives inside the agent directory, where its files belong, and is a
    // dot-directory so host discovery skips it.
    const shimHome = path.join(agentDir, ".studio-designer-home");
    const shimAgent = path.join(shimHome, ".omp", "agent");
    fs.mkdirSync(path.dirname(shimAgent), { recursive: true });
    if (!fs.existsSync(shimAgent)) fs.symlinkSync(agentDir, shimAgent, "dir");

    const previousHome = process.env.HOME;
    const previousProfile = process.env.USERPROFILE;
    process.env.HOME = shimHome;
    process.env.USERPROFILE = shimHome;
    try {
      const module = (await import(pathToFileURL(DESIGNER_EXTENSION).href)) as { default: DesignerExtensionFactory };
      if (typeof module.default !== "function") throw new Error("designer engine has no default factory");
      return module.default;
    } catch (error) {
      moduleCache.delete(agentDir);
      throw error;
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousProfile;
    }
  })();

  moduleCache.set(agentDir, loading);
  return loading;
}

/** Upstream writes reports through `ctx.editor.setText`, which OMP does not expose. */
function withEditorBridge(ctx: StudioContext): StudioContext {
  if (ctx.editor?.setText) return ctx;
  return { ...ctx, editor: { setText: (text: string) => ctx.ui?.setEditorText?.(text) } };
}

export async function activateDesignerEngine(
  pi: ExtensionAPI,
  options: { agentDir: string; mode: DesignerEngineMode; cwd?: string },
): Promise<DesignerEngineHandle | null> {
  const cwd = options.cwd ?? process.cwd();
  if (options.mode === "off") {
    setDesignerEngineState(options.agentDir, cwd, false);
    return null;
  }
  if (boundAgentDir && boundAgentDir !== options.agentDir) {
    throw new Error(`designer engine is already bound to ${boundAgentDir}; one agent directory per process`);
  }
  ensureDesignerRuntime(options.agentDir);
  setDesignerEngineState(options.agentDir, cwd, true);
  const factory = await importDesignerExtension(options.agentDir);
  boundAgentDir = options.agentDir;

  const commands: string[] = [];
  let mode: DesignerEngineMode = options.mode;

  const proxy: ExtensionAPI = {
    on: (event, handler) => {
      pi.on(event, async (payload, ctx) => {
        if (event === "tool_call") {
          const decision = (await handler(payload, ctx)) as { block?: boolean } | undefined;
          // Studio owns the gate: upstream's deny-by-default tool block is only
          // honoured in upstream mode.
          if (decision?.block && mode !== "upstream") return undefined;
          return decision;
        }
        if (event === "before_agent_start") {
          if (mode !== "upstream") return undefined;
          return handler(payload, ctx);
        }
        if (event === "session_stop") {
          if (mode !== "upstream") return undefined;
          return handler(payload, ctx);
        }
        return handler(payload, ctx);
      });
    },
    registerTool: (tool) => pi.registerTool(tool),
    registerCommand: (name, definition) => {
      commands.push(name);
      pi.registerCommand(name, {
        ...definition,
        handler: async (args, ctx) => definition.handler(args, withEditorBridge(ctx)),
      });
    },
    appendEntry: (customType, data) => pi.appendEntry?.(customType, data),
    sendUserMessage: (text, sendOptions) => pi.sendUserMessage?.(text, sendOptions),
    setLabel: (label) => pi.setLabel?.(`UI Studio · ${label}`),
  };

  factory(proxy);

  return {
    get mode() {
      return mode;
    },
    commands,
    setMode: (next: DesignerEngineMode) => {
      mode = next;
      setDesignerEngineState(options.agentDir, cwd, next !== "off");
    },
  };
}
