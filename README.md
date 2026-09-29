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

/studio designer <mode>  how much of the designer engine Studio hands back:
                         off | studio (default) | upstream

/studio status          current profile, phase, gate and DESIGN.md
/studio doctor          vendor integrity, engines, DESIGN.md
/studio off             pause Studio for this project
```

The designer engine itself is **live, not just vendored**: its `/designer`,
`/designer-doctor` and `/designer-reset` commands are registered through Studio,
and its skills, validators and doctor run in every mode. `/studio designer`
only decides how much authority the engine keeps:

| Mode | Engine commands & validators | Upstream prompt injection | 12-skill gate | Session-stop enforcement |
| --- | --- | --- | --- | --- |
| `studio` (default) | yes | no — Studio composes the prompt | no — Studio owns blocking | no — Studio's audit gate |
| `upstream` | yes | yes | yes (deny-by-default) | yes |
| `off` | no | no | no | no |

Power users keep the upstream names: `/designer` toggles the engine,
`/designer-doctor` reports its health, `/ux off|lite|strict` sets the UX level.
All of them route to Studio state — there is no second settings system.

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
engine. Both upstream projects defined this file separately; Studio consolidates
them on a single schema and both engine skills are transformed to point at it.

```markdown
---
colors:      # exact hex or oklch values, plus contrast pairs
typography:  # font roles with size, weight, leading, tracking
rounded:     # one radius scale
spacing:     # one spacing scale
components:  # the component inventory this system serves
---

# <Product> — Design System

## Overview      # intent, audience, anti-patterns
## Colors        # token table, light + dark, with contrast pairs
## Typography    # scale, roles, measure
## Layout        # grid, breakpoints, container, spacing rhythm
## Elevation     # named levels only
## Components    # how each component type looks and behaves
```

Those five frontmatter keys and six sections are the contract; `/studio audit`
fails without them. Extra sections — Motion, Spacing, Radius, Grid, Image
Style, Accessibility — are welcome.

Order of authority: user instructions, then product/function requirements,
then `DESIGN.md`, then local taste. Accessibility failures get fixed, not
overridden. The UX engine never redesigns; the Designer never waves away a
failing gate.

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

Two files carry the integration weight: `src/contract.ts` is the single
DESIGN.md schema (enforced by `studio_check`, documented by the Studio skill),
and `src/adapters/designer-engine.ts` loads the upstream extension with path
shims and a policy proxy.

`vendor/` and the vendored skill directories are generated. Never edit them by
hand — edit `scripts/upstreams.json` or a transform and re-run `npm run sync`.

## Platforms

macOS, Linux and Windows are supported. Two details make that true:

- **Runtime files are copied, never symlinked.** NTFS symlinks need Developer
  Mode or an elevated shell, so the managed-skills and validator files the
  designer engine expects are copied into the agent directory.
- **The path shim redirects `HOME` *and* `USERPROFILE`.** `os.homedir()` reads
  `HOME` on macOS and Linux but `USERPROFILE` on Windows; the shim sets both
  while the upstream module is imported.

WSL is the smoothest Windows path, but native Windows works.

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
