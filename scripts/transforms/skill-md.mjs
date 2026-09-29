#!/usr/bin/env node
/**
 * Vendored-skill transforms.
 *
 * Preference order from the package brief: adapter > deterministic transform >
 * patch. Everything here is a pure string transform asserted against explicit
 * anchors, so an upstream rewrite fails the sync loudly instead of silently
 * producing a wrong skill.
 */

/** Skills whose upstream file has no frontmatter and needs a curated header. */
const HEADER_OVERRIDES = {
  "ai-slop": {
    name: "ai-slop",
    description:
      "Operational definition of AI slop: observable properties, severity levels, evidence rules, review method and repair actions for generated interfaces. Read before critiquing or shipping UI.",
  },
};

/** Anchors each transform requires. A missing anchor means upstream changed. */
const DESIGN_MD_ANCHORS = ["write a `DESIGN.md` to `local://DESIGN.md`", "https://picsum.photos/seed"];
const UX_DESIGN_ANCHOR = "### Step 0 — Own the system via DESIGN.md";

/** Upstream headings mapped onto the canonical DESIGN.md sections. */
const CANONICAL_SECTIONS = {
  Brand: "Overview",
  "Color System": "Colors",
  Grid: "Layout",
  "Component Patterns": "Components",
};

const STUDIO_CONTRACT = `
## Studio: one design contract

\`DESIGN.md\` at the project root is the single shared contract for this project.

- User instructions always win.
- Product/functional requirements beat aesthetics.
- The Designer engine owns subjective visual direction and is the only writer.
- The UX engine validates the implementation against this file; it never
  independently redesigns the interface.
- Accessibility failures are fixed, not aesthetically overridden.

Write it in the canonical schema: token frontmatter first
(\`colors\`, \`typography\`, \`rounded\`, \`spacing\`, \`components\`), then the
rationale sections **Overview, Colors, Typography, Layout, Elevation,
Components** in that order. Extra sections — Motion, Spacing, Radius, Grid,
Image Style, Accessibility — are welcome; those six are the contract.
\`skill://studio-orchestrator\` carries the same schema, and
\`studio_check\` enforces it during \`/studio audit\`.
`;

const UX_CONTRACT_NOTE = `
### Studio: the same DESIGN.md, not a second one

UI Studio consolidates both engines onto **one** repo-root \`DESIGN.md\`, with
token frontmatter (\`colors\`, \`typography\`, \`rounded\`, \`spacing\`,
\`components\`) followed by the rationale sections **Overview, Colors,
Typography, Layout, Elevation, Components**.

- Do not create a second contract, a \`local://DESIGN.md\`, or a per-model
  variant. \`skill://studio-orchestrator\` holds the canonical schema.
- Presets from \`ux-presets\` are still valid *starting points* — persist them
  into that one file.
- The audit gate checks this file, so a contract the tools cannot read is a
  failed contract.
`;

function escapeYaml(value) {
  if (/[:#\\-{}[\]&*!|>'"%@`]/.test(value.trim().slice(0, 1)) || /:\s/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/** Split a markdown doc into { frontmatter, body }. */
export function splitFrontmatter(raw) {
  const text = String(raw).replace(/^﻿/, "");
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: text };
  const head = text.slice(4, end);
  const body = text.slice(text.indexOf("\n", end + 1) + 1);
  const frontmatter = {};
  let pendingKey = null;
  for (const line of head.split("\n")) {
    const folded = /^([A-Za-z0-9_-]+):\s*[>|]\s*$/.exec(line);
    if (folded) {
      pendingKey = folded[1];
      frontmatter[pendingKey] = "";
      continue;
    }
    const key = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (key) {
      pendingKey = key[1];
      let value = key[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[pendingKey] = value;
      continue;
    }
    if (pendingKey && /^\s+\S/.test(line)) {
      frontmatter[pendingKey] = `${frontmatter[pendingKey]} ${line.trim()}`.trim();
    }
  }
  return { frontmatter, body };
}

export function renderSkillDocument({ name, description, body, extra = {} }) {
  const lines = ["---", `name: ${escapeYaml(name)}`, `description: ${escapeYaml(description)}`];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

function assertAnchor(body, anchor, skillName) {
  if (!body.includes(anchor)) {
    throw new Error(
      `${skillName} transform anchor not found: ${JSON.stringify(anchor)} — upstream changed this file, review scripts/transforms/skill-md.mjs`,
    );
  }
}

/**
 * Turn an upstream flat skill file into a Studio skill document.
 * Returns { name, content, transforms }.
 */
export function buildSkillDocument(skillName, raw) {
  const { frontmatter, body } = splitFrontmatter(raw);
  const override = HEADER_OVERRIDES[skillName];
  const name = override?.name ?? frontmatter.name ?? skillName;
  const description = override?.description ?? frontmatter.description ?? "";

  if (!description) {
    throw new Error(
      `skill "${skillName}" has no usable description; add it to HEADER_OVERRIDES in scripts/transforms/skill-md.mjs`,
    );
  }

  const transforms = [];
  let content = body;

  if (name === "design-md") {
    content = applyDesignMdTransform(content);
    transforms.push("design-md-single-contract");
  }
  if (name === "ux-design") {
    content = applyUxDesignTransform(content);
    transforms.push("ux-design-single-contract");
  }

  const extra = {};
  if (frontmatter["disable-model-invocation"] || frontmatter.hide) {
    extra["disable-model-invocation"] = "true";
  }

  return { name, content: renderSkillDocument({ name, description, body: content, extra }), transforms };
}

/** Rewrite upstream DESIGN.md guidance onto the one shared Studio contract. */
export function applyDesignMdTransform(body) {
  for (const anchor of DESIGN_MD_ANCHORS) assertAnchor(body, anchor, "design-md");

  let out = body.replace(
    "write a `DESIGN.md` to `local://DESIGN.md`",
    "write a `DESIGN.md` at the project root (`./DESIGN.md`)",
  );

  const headingEnd = out.indexOf("\n## ");
  out = out.slice(0, headingEnd) + "\n" + STUDIO_CONTRACT + out.slice(headingEnd);

  out = out.replace(
    /- Fallback: `https:\/\/picsum\.photos\/seed\/[^`]*` for placeholders/,
    "- Fallback: a product-specific SVG or component preview. Never hotlink a stock-photo CDN.",
  );
  if (out.includes("picsum.photos")) {
    throw new Error("design-md transform failed to remove the picsum fallback");
  }

  // Canonical headings, so the file this skill teaches the model to write
  // passes the schema `src/contract.ts` enforces at audit time.
  for (const [from, to] of Object.entries(CANONICAL_SECTIONS)) {
    assertAnchor(out, `## ${from}`, "design-md");
    out = out.replace(`## ${from}`, `## ${to}`);
  }

  return out;
}

/** Point pi-ux's Step 0 at Studio's single contract instead of a second one. */
export function applyUxDesignTransform(body) {
  assertAnchor(body, UX_DESIGN_ANCHOR, "ux-design");
  return body.replace(UX_DESIGN_ANCHOR, `${UX_CONTRACT_NOTE}\n${UX_DESIGN_ANCHOR}`);
}
