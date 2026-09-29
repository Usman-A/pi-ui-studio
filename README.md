# PI UI STUDIO

A designer's eye and a UX auditor in one install.

```bash
omp install npm:@usman-a/pi-ui-studio
```

```text
/studio
```

Studio bundles two proven engines behind one command surface:

| Engine | Vendored from | Owns |
| --- | --- | --- |
| Designer | [`omp-designer`](https://github.com/LePro10/omp-designer) 4.1.0 | visual identity, art direction, type, spacing, hierarchy, composition, motion direction, visual critique |
| Pi UX | [`@bacnh85/pi-ux`](https://github.com/bacnh85/pi-extensions/tree/main/pi-ux) 0.6.6 | contrast/APCA, token consistency, interaction states, reduced motion, slop tells, DESIGN.md compliance |
| Studio | this package | which engine runs, how hard, when, and whether it blocks |

Nobody installs or manages two plugins. Studio vendors the upstream source,
adapts it, and owns the orchestration.

## The loop

```text
CREATE      /studio explore    Designer leads: concept, hierarchy, references, direction
CONSTRAIN   DESIGN.md + Pi UX  one shared contract, deterministic guardrails
BUILD       /studio build      implement inside the contract
SEE         /studio review     render, screenshot, critique, bounded repair
FIX         /studio review     highest-impact issues only, then re-render
PROVE       /studio audit      strict deterministic gate — blocking
```

## Commands

```text
/studio                 enable Studio with the current profile
/studio explore         concepts, hierarchy, art direction, references
/studio build           implement inside DESIGN.md and profile guardrails
/studio review          render, screenshot, critique, bounded repair
/studio audit           strict deterministic gate — blocking

/studio mode balanced   the default: normal exploration, lite build guardrails, strict audit
/studio mode design-first
/studio mode ux-first

/studio status          current profile, phase, gate and DESIGN.md
/studio doctor          vendor integrity, engines, DESIGN.md
/studio off             pause Studio for this project
```

Power users keep the upstream names: `/designer` shows the designer engine's
tuning, `/ux off|lite|strict` overrides the UX level. Both route to Studio
state — there is no second settings system.

## Profiles

Profiles change **intensity, never authority**.

| | Designer | Pi UX during build | Final audit |
| --- | --- | --- | --- |
| `balanced` (default) | normal exploration, 2 visual reviews, 1 repair loop | lite | strict |
| `design-first` | high exploration, 3 visual reviews, 2 repair loops | lite | strict |
| `ux-first` | low exploration, 1 visual review | strict (blocking) | strict |

In every profile the Designer owns subjective visual direction, the UX engine
owns deterministic validation, and Studio owns orchestration.

Phases are separate from profiles. `/studio mode design-first` then
`/studio audit` still runs a serious deterministic audit.

## DESIGN.md

One file, at the project root, written by the Designer and validated by the UX
engine:

1. User instructions always win.
2. Product and functional requirements beat aesthetics.
3. Once established, `DESIGN.md` is the source of truth.
4. The Designer owns subjective visual direction.
5. The UX engine owns deterministic validation.
6. Accessibility failures get fixed, not aesthetically overridden.
7. The UX engine never redesigns; the Designer never waves away a failing gate.

## Tools

| Tool | What it does |
| --- | --- |
| `ux_audit` | the vendored pi-ux gate, under its upstream name (APCA contrast, tokens, states, slop tells) |
| `studio_check` | both engines at once: UX audit + ai-slop validator + layout validator (audit phase) + DESIGN.md compliance. Feeds the audit gate. |

## Layout

```text
src/                     Studio orchestration (thin; no reimplementation of upstream logic)
skills/studio-orchestrator/  the one Studio skill: ownership, phases, DESIGN.md, anti-slop
skills/<designer-*,ux-*>  generated from vendor/ at sync time
vendor/                  GENERATED upstream source + manifest.json (versions, digests, exclusions)
scripts/sync-upstream.mjs  the only writer of vendor/ and generated skills
tests/                   upstream contract tests + Studio behaviour tests
```

`vendor/` and the vendored skill directories are generated. Never edit them by
hand — edit `scripts/upstreams.json` or a transform and re-run `npm run sync`.

## Updating upstream

```bash
node scripts/sync-upstream.mjs --check            # drift check (CI)
node scripts/sync-upstream.mjs --designer=latest --ux=latest
npm test
```

`sync-upstream.mjs` downloads the published tarballs, copies an explicit
allow-list of files, records SHA-256 digests in `vendor/manifest.json`, applies
documented transforms, regenerates the skill directories, and updates the
notices table. Contract tests fail loudly when an upstream release changes an
assumption Studio depends on. `.github/workflows/upstream-sync.yml` runs the
check on a schedule and opens a PR; patch/minor updates may auto-merge when
every gate passes, major updates always need review.

## Anti-slop, without dogma

Card grids, gradients, purple glow, pill buttons, glassmorphism, oversized hero
copy, random shadows and floating containers are defaults, not crimes. If
`DESIGN.md` calls for one, use it and own it. The test is intent.

## License

MIT for Studio's own code. Both upstream projects are MIT and credited in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md), which also records exactly
which files are bundled, at which version, with which transforms.
