/**
 * Studio tools.
 *
 * `ux_audit` is the vendored pi-ux gate, re-registered under its upstream name
 * (tool description and guidelines reused from the MIT-licensed original).
 * `studio_check` is Studio's own: one call that runs both engines' deterministic
 * checks and feeds the audit gate, so the model spends one tool call instead of
 * three.
 */
import path from "node:path";

import type { ExtensionAPI, StudioContext, ToolDefinition, ToolResult } from "./types.ts";
import { designerReport, type ValidatorResult } from "./adapters/designer.ts";
import { summarizeAudit, uxKernel, type UxAuditResult } from "./adapters/ux.ts";
import type { SessionState, StudioConfig } from "./state.ts";

export interface StudioRuntime {
  config: StudioConfig;
  session: SessionState;
}

interface ContrastPair {
  fg: string;
  bg: string;
  min?: number;
  size?: number;
  weight?: number;
}

// Plain JSON-schema objects, mirroring the upstream tool: the symbols are
// stripped on JSON.stringify at the tool-spec boundary anyway.
function contrastPairsSchema(): Record<string, unknown> {
  return {
    type: "array",
    description: "fg/bg colour pairs (hex or oklch()) plus optional weight/size to set the APCA threshold",
    items: {
      type: "object",
      properties: {
        fg: { type: "string" },
        bg: { type: "string" },
        min: { type: "number" },
        size: { type: "number" },
        weight: { type: "number" },
      },
      required: ["fg", "bg"],
    },
  };
}

export function registerUxAudit(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ux_audit",
    label: "UX Slop Audit",
    description:
      "Run deterministic slop-audit gates on CSS: APCA contrast (perceptual; WCAG sidecar), off-system token values (hardcoded hex / ad-hoc shadows), missing interaction states (:focus-visible / :disabled + prefers-reduced-motion), and named AI slop tells (glassmorphism, gradient orbs, neon glow, default-card, tracked-out eyebrows, tinted near-black). No model needed — all gates are computable. In strict mode, handoff is blocked until this passes. AUDIT THE COMPLETE STYLESHEET, not fragments. If no contrast pairs are supplied, they are auto-extracted from rules that declare both colour and background.",
    promptSnippet: "Run deterministic UX slop-audit (APCA contrast + tokens + states + slop tells)",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Stylesheet file to audit. Read verbatim — never retype CSS into `css` when the file is on disk.",
        },
        css: { type: "string", description: "Inline CSS. Use only when there is no stylesheet file." },
        pairs: contrastPairsSchema(),
      },
      additionalProperties: false,
    },
    async execute(_toolCallId, params: { path?: string; css?: string; pairs?: ContrastPair[] }, _signal, _onUpdate, ctx: StudioContext) {
      const kernel = await uxKernel();
      const cwd = ctx.cwd ?? process.cwd();
      let css: string;
      try {
        css = kernel.resolveAuditCss(params, cwd);
      } catch (error) {
        return { content: [{ type: "text", text: `UX audit error: ${(error as Error).message}` }], isError: true };
      }
      const result = kernel.audit({ css, pairs: params.pairs ?? [] });
      return { content: [{ type: "text", text: kernel.formatAuditResult(result) }], details: result };
    },
  } as ToolDefinition<never>);
}

function validatorLine(result: ValidatorResult): string {
  if (result.skipped) return `  ${result.name}: SKIPPED (${result.skipped})`;
  return `  ${result.name}: ${result.ok ? "PASS" : "FAIL"}`;
}

export function registerStudioCheck(pi: ExtensionAPI, getRuntime: () => StudioRuntime, recordAudit: (passed: boolean, summary: string) => void): void {
  pi.registerTool({
    name: "studio_check",
    label: "Studio Check",
    description:
      "Run Studio's full deterministic gate in one call: the pi-ux audit (APCA contrast, tokens, interaction states, slop tells) on a stylesheet, the designer engine's ai-slop validator over the project, the layout validator during the audit phase, and DESIGN.md contract compliance. Returns every failure, decides pass/fail, and drives the /studio audit blocking gate. Use this instead of guessing whether a screen is done.",
    promptSnippet: "Run both Studio engines' deterministic checks and the DESIGN.md contract gate",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Stylesheet file to audit verbatim." },
        css: { type: "string", description: "Inline CSS, only when no stylesheet file exists." },
        pairs: contrastPairsSchema(),
        cwd: { type: "string", description: "Project root to validate. Defaults to the session cwd." },
      },
      additionalProperties: false,
    },
    async execute(_toolCallId, params: { path?: string; css?: string; pairs?: ContrastPair[]; cwd?: string }, signal, _onUpdate, ctx: StudioContext) {
      const cwd = params.cwd ?? ctx.cwd ?? process.cwd();
      const runtime = getRuntime();
      const strict = runtime.session.phase === "audit";
      const sections: string[] = [];
      const failures: string[] = [];

      let uxResult: UxAuditResult | null = null;
      if (params.path || params.css) {
        const kernel = await uxKernel();
        const css = kernel.resolveAuditCss(params, cwd);
        uxResult = kernel.audit({ css, pairs: params.pairs ?? [] });
        const uxFailures = summarizeAudit(uxResult);
        sections.push(uxResult.pass ? "UX audit: PASS" : `UX audit: FAIL\n${uxFailures.map((line) => `  - ${line}`).join("\n")}`);
        failures.push(...uxFailures);
      } else {
        sections.push("UX audit: SKIPPED (no stylesheet path or css supplied)");
      }

      const designer = designerReport(cwd, { includeLayout: strict });
      for (const validator of designer.validators) {
        sections.push(validatorLine(validator));
        if (!validator.ok && !validator.skipped) failures.push(`${validator.name} validator reported findings`);
      }

      const contract = designer.contract;
      if (contract.exists && contract.schema) {
        const schema = contract.schema;
        sections.push(
          `DESIGN.md: ${path.basename(contract.path)} (${schema.hexCount} hex tokens, frontmatter ${schema.hasFrontmatter ? "present" : "missing"})`,
        );
        if (strict && !schema.ok) {
          if (!schema.hasFrontmatter) {
            failures.push("DESIGN.md has no token frontmatter — ux_audit and analyze-layout cannot read the system");
          }
          if (schema.missingKeys.length > 0) {
            failures.push(`DESIGN.md frontmatter is missing: ${schema.missingKeys.join(", ")}`);
          }
          if (schema.missingSections.length > 0) {
            failures.push(`DESIGN.md is missing sections: ${schema.missingSections.join(", ")}`);
          }
        } else if (!schema.hasFrontmatter) {
          sections.push("  advisory: add the token frontmatter before the audit phase");
        }
      } else {
        sections.push(`DESIGN.md: MISSING (${contract.path})`);
        if (strict) failures.push("DESIGN.md is missing — the shared design contract must exist before audit");
      }

      const passed = failures.length === 0;
      const summary = passed
        ? "all deterministic gates passed"
        : `${failures.length} blocking issue${failures.length === 1 ? "" : "s"}: ${failures.slice(0, 5).join("; ")}`;
      recordAudit(passed, summary);

      const cancelled = signal?.aborted === true;
      const text = `${cancelled ? "Studio check cancelled.\n\n" : ""}${sections.join("\n")}\n\n${passed ? "PASS" : "FAIL"} — ${summary}`;
      const result: ToolResult = { content: [{ type: "text", text }], details: { passed, failures, ux: uxResult, designer } };
      if (cancelled) result.isError = true;
      return result;
    },
  } as ToolDefinition<never>);
}
