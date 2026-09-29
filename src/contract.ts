/**
 * The one DESIGN.md contract.
 *
 * Both engines used to define this file separately — the designer wrote a rich
 * visual system to `local://DESIGN.md`, pi-ux anchored a repo-root file with
 * machine-readable frontmatter. This module is the single definition Studio
 * checks against, documents in its skill, and both engine skills point to.
 *
 * Frontmatter is machine-readable on purpose: `ux_audit`, `analyze-layout.mjs`
 * and `npx @google/design.md lint` all consume it. The rationale sections are
 * for humans and for the Designer's own decisions.
 */

export const REQUIRED_TOKEN_KEYS = ["colors", "typography", "rounded", "spacing", "components"] as const;

export const REQUIRED_SECTIONS = ["Overview", "Colors", "Typography", "Layout", "Elevation", "Components"] as const;

export interface DesignSchemaReport {
  hasFrontmatter: boolean;
  missingKeys: string[];
  missingSections: string[];
  hexCount: number;
  ok: boolean;
}

function frontmatterOf(text: string): string | null {
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (!trimmed.startsWith("---")) return null;
  const end = trimmed.indexOf("\n---", 3);
  return end === -1 ? null : trimmed.slice(3, end);
}

/** Check a DESIGN.md document against the canonical contract. */
export function inspectDesignSchema(text: string): DesignSchemaReport {
  const frontmatter = frontmatterOf(text);
  const head = frontmatter ?? "";
  const missingKeys = REQUIRED_TOKEN_KEYS.filter((key) => !new RegExp(`^\\s*${key}\\s*:`, "m").test(head));
  const headings = new Set(
    [...text.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)].map((match) => (match[1] ?? "").replace(/[*_`]/g, "").trim()),
  );
  const missingSections = REQUIRED_SECTIONS.filter((section) => !headings.has(section));

  return {
    hasFrontmatter: frontmatter !== null,
    missingKeys: [...missingKeys],
    missingSections: [...missingSections],
    hexCount: (text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length,
    ok: frontmatter !== null && missingKeys.length === 0 && missingSections.length === 0,
  };
}

/** The schema as a Markdown block, embedded in the Studio skill and in prompts. */
export function designContractReference(): string {
  return [
    "```markdown",
    "---",
    'colors:      # exact hex or oklch values, plus contrast pairs',
    "typography:  # font roles with size, weight, leading, tracking",
    "rounded:     # one radius scale",
    "spacing:     # one spacing scale",
    "components:  # the component inventory this system serves",
    "---",
    "",
    "# <Product> — Design System",
    "",
    "## Overview      # intent, audience, anti-patterns",
    "## Colors        # token table, light + dark, with contrast pairs",
    "## Typography    # scale, roles, measure",
    "## Layout        # grid, breakpoints, container, spacing rhythm",
    "## Elevation     # named levels only",
    "## Components    # how each component type looks and behaves",
    "```",
  ].join("\n");
}
