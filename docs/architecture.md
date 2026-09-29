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

| Package | Manifest | Entrypoints |
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
- Side effects: flips `enabled` on design-related `mcp.json` servers, writes
  `designer-state.json`, `designer-gates/`, `designer-traces/`, and expects
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

## 9. DESIGN.md, consolidated

Both engines wrote one. That collision decided the architecture.

- `omp-designer`'s `design-md` skill writes `DESIGN.md` to **`local://DESIGN.md`**
  (an agent artifact, invisible to tools and validators) with a rich visual
  system: palette, typography, spacing, grid, radius, elevation, motion,
  component patterns, image style, accessibility.
- `pi-ux`'s `ux-design` skill anchors a **repo-root `DESIGN.md`** with
  machine-readable frontmatter (`colors`, `typography`, `rounded`, `spacing`,
  `components`) plus rationale sections, linted by `npx @google/design.md lint`
  and consumed by its own audit and by `analyze-layout.mjs`.

**Decision — one file, one schema, one writer.** `src/contract.ts` defines it:
those five frontmatter keys plus the rationale sections **Overview, Colors,
Typography, Layout, Elevation, Components**. The Designer writes it; the UX
engine validates it; `/studio audit` fails without it. Both upstream skills are
transformed to point at it (`design-md-single-contract`,
`ux-design-single-contract`), and a contract test asserts the Studio skill
documents exactly what the checker enforces — so docs and code cannot drift.

## 10–11. Overlaps and ownership

| Overlap | Owner | Why |
| --- | --- | --- |
| `DESIGN.md` authorship | Designer (writes) / UX (validates) | one writer, one validator; never two generators |
| Palette, type, spacing, motion direction | Designer | subjective judgment |
| Contrast, APCA, states, reduced motion | UX engine | computable, non-negotiable |
| Anti-slop tells | both, different layers: Designer judges intent during review; UX engine enforces the named tells in `studio_check` | judgment and computation are different tools |
| System-prompt injection | Studio | two engines injecting independently is how prompts fight; Studio composes one block per turn |
| Loop bounds (review passes, repair loops) | Studio | orchestration, not taste |
| Screenshot critique | Designer (`visual-critique`; `ux-capture` for capture mechanics) | visual judgment with capture help |
| Post-build validation | Studio, calling both validators | one gate, one owner |

## 12–13. Adapter architecture

Studio loads **one** upstream extension factory — the designer's — and drives it
through a policy proxy. Inspection produced two findings that shaped this:

- `omp-designer`'s extension hardcodes `~/.omp/agent/extensions/designer` and
  `managed-skills/`, flips `mcp.json` entries, and enforces a deny-by-default
  gate: **every tool except read/search is blocked until all 12 skills are
  read**, with a permanent ordering violation if any skill is opened before
  `designer-master`. All three are fixable, and none requires patching.
- `pi-ux`'s extension owns its own mode state and unconditionally appends the
  full `ux-design` body to the system prompt, which would fight Studio's own
  prompt block. Studio therefore reuses its **kernel** (`hooks/ux-audit.js`
  plus the exported `resolveAuditCss` / `formatAuditResult`) and does not call
  that factory.

`src/adapters/designer-engine.ts` makes the designer extension run from inside a
vendored package with three shims and one proxy:

1. **Path shim.** The upstream module captures `os.homedir()` at import time.
   Studio imports it with `HOME` *and* `USERPROFILE` pointed at a shim home
   whose `.omp/agent` links to the real agent directory, so every hardcoded
   upstream path resolves — under any profile, and on Windows.
2. **Runtime files.** Upstream reads skills from
   `<agent>/managed-skills/<name>/SKILL.md` and validators from
   `<agent>/extensions/designer/*.mjs`. Studio materialises both by copying
   (never symlinking — NTFS symlinks need Developer Mode), idempotently, and
   ships its own `ui-ux-pro-max` skill so the upstream gate can actually be
   satisfied: the pointer upstream ships addresses an unmanaged install that
   does not exist for our users.
3. **Editor bridge.** Upstream reports through `ctx.editor.setText`, which OMP
   does not expose; the proxy maps it to `ctx.ui.setEditorText`.
4. **Policy proxy.** `before_agent_start`, `tool_call` and `session_stop` are
   forwarded only in `upstream` mode. In the default `studio` mode the engine
   still registers its commands, skills, validators and doctor, but Studio
   keeps the prompt and the gate.

Profile/state architecture: `src/profiles.ts` (three profiles, concrete knobs,
`behaviorFor(profile, phase)` is the single decision function) and
`src/state.ts` (profile, UX override and engine mode persisted to
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
   verbatim except the transformed ones), never touching the authored skills,
7. rewrite the versions table in `THIRD_PARTY_NOTICES.md`.

`.github/workflows/upstream-sync.yml` runs `--check` on a schedule and opens a
PR running the sync, contract tests, Studio tests and `npm pack --dry-run`.

## 15. Unavoidable patches

Zero patches to upstream **source**. Two documented transforms, both asserted
against anchors so an upstream rewrite fails the sync loudly, both listed in
`vendor/manifest.json` and reproduced in `THIRD_PARTY_NOTICES.md`:

- `design-md-single-contract` — moves `DESIGN.md` to the project root, renames
  its sections to the canonical ones, states the token frontmatter requirement,
  and removes a `picsum.photos` fallback that contradicted the engine's own
  prompt injection.
- `ux-design-single-contract` — inserts a Studio note above pi-ux's Step 0 so
  the UX skill adopts the same contract instead of authoring a second file.

## 16. Repository tree

```text
pi-ui-studio/
├── src/
│   ├── index.ts                extension factory: commands, prompt block, audit gate
│   ├── contract.ts             the one DESIGN.md schema (keys + sections)
│   ├── profiles.ts             profiles + behaviorFor(profile, phase)
│   ├── state.ts                config file + session-entry replay
│   ├── prompt.ts               orchestration block, phase turn, status/banner text
│   ├── report.ts               status / phase brief / doctor rendering
│   ├── tools.ts                ux_audit + studio_check
│   ├── vendor.ts               vendor digest verification
│   ├── types.ts                minimal structural host API types
│   └── adapters/
│       ├── designer.ts         validators, DESIGN.md contract lookup
│       ├── designer-engine.ts  loads the upstream extension: path shims + policy proxy
│       └── ux.ts               vendored audit kernel loader
├── skills/
│   ├── studio-orchestrator/    authored: ownership, phases, canonical schema, anti-slop
│   ├── ui-ux-pro-max/          authored: the vendored palette/type dataset
│   └── <15 vendored skill dirs>   generated
├── vendor/
│   ├── omp-designer/           skills, data, validators, extension, skill-gate
│   ├── pi-ux/                  skills, hooks, extensions helpers, LICENSE
│   └── manifest.json           versions, digests, exclusions, transforms
├── scripts/
│   ├── upstreams.json          pins, allow-lists, exclusions and reasons
│   ├── sync-upstream.mjs       the only writer of vendor/ and generated skills
│   └── transforms/skill-md.mjs
├── tests/
│   ├── contract.test.mjs       upstream contracts Studio depends on
│   ├── designer-engine.test.mjs  the three shims and the policy proxy
│   └── studio.test.mjs         Studio behaviour through the host surface
├── docs/architecture.md        this file
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

/studio mode <id>        swaps the profile, keeps the phase
/studio designer <mode>  off | studio | upstream — how much the engine owns
/studio off              → idle, engine paused, no injection, no gate
/studio status           renders profile + phase + gates + DESIGN.md + audit state
/studio doctor           vendor digests, UX kernel, node, DESIGN.md schema, engine runtime
```

Transitions are one-way per invocation and always explicit: a phase command is
the only thing that changes phase, and it always resets the audit gate so a new
audit re-arms.
