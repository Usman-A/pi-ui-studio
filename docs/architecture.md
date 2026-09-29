# Upstream inspection and architecture

Answers to the inspection questions that preceded implementation, with the
evidence each decision rests on.

## 1–3. Versions and licenses

| Package | Version | License | Notes |
| --- | --- | --- | --- |
| `omp-designer` | 4.1.0 (latest; published 2026-07-02) | MIT declared in `package.json` | the published tarball ships **no `LICENSE` file**; attribution in `THIRD_PARTY_NOTICES.md` records this |
| `@bacnh85/pi-ux` | 0.6.6 (latest; published 2026-09-28) | MIT, `LICENSE` vendored verbatim | |

Both stay MIT, so vendoring is permitted with attribution. Studio's own code is
MIT.

## 4. Runtime entrypoints

| Package | Manifest | Entrypoint |
| --- | --- | --- |
| `omp-designer` | `omp.extensions: ["./extension/index.ts"]`, `pi.extensions: ["./extensions"]`, `pi.skills: ["./skills"]` | `extension/index.ts` (OMP), `extensions/designer.ts` (Pi) |
| `@bacnh85/pi-ux` | `pi.extensions: ["./extensions/index.js"]`, `pi.skills: ["./skills"]` | `extensions/index.js` (ESM, `extensions/package.json` marks `type: module`) |

Studio ships one entrypoint: `src/index.ts`.

## 5–8. What each registers

`omp-designer` (OMP extension):

- Commands: `/designer` (alias `/design`), `/designer-doctor`, `/designer-reset`.
- Tools: none.
- Hooks: `resources_discover`, `before_agent_start`, `agent_start`, `agent_end`,
  `tool_call` (blocking), `tool_result`, `session_stop` (blocking).
- Skills: 12 (`designer-master`, `ai-slop`, `product-md`, `taste-skill`,
  `design-md`, `ui-ux-pro-max`, `reference-study`, `copywriting`,
  `scroll-choreography`, `animate`, `visual-critique`, `review-skill`).
- Side effects: mutates `~/.omp/agent/mcp.json` (chrome-devtools etc.), writes
  `designer-state.json`, `designer-gates/`, `designer-traces/`, and requires
  skills installed under `~/.omp/agent/managed-skills/<skill>/SKILL.md`.
- Deterministic scripts shipped alongside: `scripts/fix-ai-slop.mjs`,
  `scripts/analyze-layout.mjs`.

`@bacnh85/pi-ux`:

- Commands: `/ux` (`off|lite|strict|status|default <mode>`).
- Tools: `ux_audit` (APCA contrast, token coverage, interaction states, slop tells).
- Hooks: `input` (deactivation), `agent_start`, `agent_end`, `session_start`,
  `before_agent_start` (appends the `ux-design` skill body to the system prompt).
- Skills: `ux-design`, `ux-capture`, `ux-presets`, `ux-routing`.
- Config: `$XDG_CONFIG_HOME/pi-ux/config.json`, env `PI_UX_DEFAULT_MODE`,
  `PI_UX_QUIET_STARTUP`, `PI_UX_HIDE_STATUS`; session state in `ux-mode` entries.

## 9. DESIGN.md

Both engines write one. That is the collision that decides the architecture.

- `omp-designer`'s `design-md` skill writes `DESIGN.md` to **`local://DESIGN.md`**
  (an agent artifact, invisible to tools and validators) with a rich visual
  system: palette, typography, spacing, grid, radius, elevation, motion,
  component patterns, image style, accessibility.
- `pi-ux`'s `ux-design` skill anchors a **repo-root `DESIGN.md`** with
  machine-readable frontmatter (`colors`, `typography`, `rounded`, `spacing`,
  `components`) plus rationale sections, linted by `npx @google/design.md lint`
  and consumed by its own audit and by `analyze-layout.mjs`.

**Decision:** one contract, repo root, machine-readable. The Designer writes it;
the UX engine validates against it. This costs exactly one deterministic
transform (`design-md-single-contract`), applied at sync time: the path moves to
the project root, the token-frontmatter requirement is stated, and the
`picsum.photos` fallback is replaced with a product-specific SVG/component
preview (upstream's own prompt injects "never use Picsum" — the skill text
contradicted it).

## 10–11. Overlaps and ownership

| Overlap | Owner | Why |
| --- | --- | --- |
| `DESIGN.md` authorship | Designer (writes) / UX (validates) | one writer, one validator; never two generators |
| Palette, type, spacing, motion direction | Designer | subjective judgment |
| Contrast, APCA, states, reduced motion | UX engine | computable, non-negotiable |
| Anti-slop tells | both, different layers: Designer judges intent during review; UX engine enforces the named tells in `studio_check` | judgment and computation are different tools |
| System-prompt injection | Studio | two engines injecting independently is how prompts fight; Studio composes one block per turn |
| Loop bounds (review passes, repair loops) | Studio | orchestration, not taste |
| Screenshot critique | Designer (`visual-critique`, `ux-capture` for capture mechanics) | visual judgment with capture help |
| Post-build validation | Studio, calling both validators | one gate, one owner |

## 12–13. Adapter architecture

```text
OMP ExtensionAPI
      │
      ▼
src/index.ts  (Studio orchestrator: commands, one prompt block, audit gate)
      │
      ├── adapters/designer.ts ── spawns vendored fix-ai-slop.mjs / analyze-layout.mjs
      │                            reads DESIGN.md
      └── adapters/ux.ts ──────── loads vendored hooks/ux-audit.js (CJS) and the
                                  vendored helpers resolveAuditCss/formatAuditResult
```

Studio **does not load either upstream extension factory**, and this is the one
place where inspection contradicted the original plan:

- `omp-designer`'s extension hardcodes `~/.omp/agent/extensions/designer`,
  `managed-skills/`, mutates `mcp.json`, and enforces a deny-by-default gate:
  **every tool except read/search is blocked until all 12 skills are read**,
  with a permanent ordering violation if any skill is opened before
  `designer-master`. Under Studio that would block screenshots, browser tools,
  and builds until the model had read ~3k lines of skill text — the opposite of
  the requested context efficiency, and it would fight profile-driven
  orchestration for control of blocking.
- `pi-ux`'s extension owns its own mode state and unconditionally appends the
  full `ux-design` body to the system prompt.

So Studio adopts the **substance** of both: the designer skill corpus, its
validators and its dataset; the pi-ux audit kernel and instruction text. That
is an adapter over content, not a patch and not a fork. The upstream extension
files stay in the tarball only where Studio actually imports their exported
helpers (`extensions/index.js` → `resolveAuditCss`, `formatAuditResult`).

Profile/state architecture: `src/profiles.ts` (three profiles, concrete knobs,
`behaviorFor(profile, phase)` is the single decision function) and
`src/state.ts` (profile + UX override persisted to
`$PI_CODING_AGENT_DIR/pi-ui-studio.json`; phase and audit gate replayed from
`pi-ui-studio.state` session entries, so a resumed session resumes its phase).

## 14. Vendor update mechanism

`scripts/sync-upstream.mjs`:

1. resolve versions (`npm view <pkg> version` for `--check`, or explicit pins),
2. `npm pack` the exact version into a temp dir,
3. copy an explicit allow-list from `scripts/upstreams.json`,
4. record SHA-256 + byte size per file in `vendor/manifest.json`,
5. apply documented transforms (`scripts/transforms/skill-md.mjs`), each
   asserting its anchors so an upstream rewrite fails the sync loudly,
6. regenerate `skills/<name>/SKILL.md` (designer flat `.md` files are converted
   to OMP's `<skills-root>/<name>/SKILL.md` layout; pi-ux skills are copied
   verbatim), never touching authored `skills/studio-orchestrator`,
7. rewrite the versions table in `THIRD_PARTY_NOTICES.md`.

`.github/workflows/upstream-sync.yml` runs `--check` on a schedule and opens a
PR running the sync, contract tests, Studio tests and `npm pack --dry-run`.

## 15. Unavoidable patches

Zero patches to upstream source, by construction. One transform
(`design-md-single-contract`) on one skill document, listed in
`vendor/manifest.json` and reproduced in `THIRD_PARTY_NOTICES.md`.

## 16. Repository tree

```text
pi-ui-studio/
├── src/
│   ├── index.ts              extension factory: commands, prompt block, audit gate
│   ├── profiles.ts           profiles + behaviourFor(profile, phase)
│   ├── state.ts              config file + session-entry replay
│   ├── prompt.ts             orchestration block, phase turn, status/banner text
│   ├── report.ts             status / phase brief / doctor rendering
│   ├── tools.ts              ux_audit + studio_check
│   ├── types.ts              minimal structural host API types
│   ├── adapters/designer.ts  validators, DESIGN.md contract
│   └── adapters/ux.ts        vendored audit kernel loader
├── skills/
│   ├── studio-orchestrator/  authored: ownership, phases, anti-slop
│   └── <14 vendored skill dirs>   generated
├── vendor/
│   ├── omp-designer/         skills, data, validators, package.json
│   ├── pi-ux/                skills, hooks, extensions helpers, LICENSE
│   └── manifest.json         versions, digests, exclusions, transforms
├── scripts/
│   ├── upstreams.json        pins, allow-lists, exclusions and reasons
│   ├── sync-upstream.mjs     the only writer of vendor/ and generated skills
│   └── transforms/skill-md.mjs
├── tests/
│   ├── contract.test.mjs     upstream contracts Studio depends on
│   └── studio.test.mjs       Studio behaviour through the host surface
├── docs/architecture.md      this file
└── .github/workflows/upstream-sync.yml
```

## 17. `/studio` state machine

```text
                 PROFILE  (balanced | design-first | ux-first)
                         │
                    ORCHESTRATOR (behaviorFor)
                         │
   idle ──/studio explore──▶ explore ──▶ (no gate)
      ──/studio build─────▶ build   ──▶ gate: blocking only in ux-first
      ──/studio review────▶ review  ──▶ designer passes per profile, never blocks
      ──/studio audit─────▶ audit   ──▶ blocking until studio_check passes
                             │
                             └── session_stop: up to 3 continuations, then release

/studio mode <id>  swaps the profile, keeps the phase
/studio off        → idle, no injection, no gate
/studio status     renders profile + phase + gates + DESIGN.md + audit state
/studio doctor     vendor digests, UX kernel, node, DESIGN.md, skills, config
```

Transitions are one-way per invocation and always explicit: a phase command is
the only thing that changes phase, and it always resets the audit gate so a new
audit re-arms.
