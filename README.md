<h1 align="center">PI UI Studio</h1>

<p align="center">
  A designer's eye and a UX auditor in one install.<br>
  <sub>One plugin. One command. One <code>DESIGN.md</code>.</sub>
</p>

---

**PI UI Studio** is an [OMP](https://github.com/oh-my-pi) package that combines two
existing, proven projects into a single opinionated UI/UX workflow:

| Engine | Upstream project (not by me) | Owns |
| --- | --- | --- |
| **Designer** | [`omp-designer`](https://github.com/LePro10/omp-designer) by **Leandro (LePro10)** | visual identity, art direction, typography, spacing, hierarchy, composition, motion direction, screenshot critique |
| **UX** | [`@bacnh85/pi-ux`](https://github.com/bacnh85/pi-extensions/tree/main/pi-ux) by **bacnh85** | contrast/APCA, token consistency, interaction states, reduced motion, anti-slop gates, DESIGN.md compliance |
| **Studio** | this repository | orchestration: which engine runs, how hard, when, and whether it blocks |

PI UI Studio is a **wrapper**. It vendors the published source of both projects,
adapts it to a single cohesive package, and adds a thin orchestration layer on
top. The underlying work — the designer skill corpus, the deterministic
validators, the contrast and slop audits — is theirs, and is credited as such
throughout. See [Credits & licensing](#credits--licensing).

## Install

```bash
omp install npm:@usman-a/pi-ui-studio
```

Then, in a session:

```text
/studio
```

That is the whole setup. No second plugin to install, no second settings system
to manage.

## The loop

```text
CREATE      /studio explore    Designer leads: concept, hierarchy, references, direction
CONSTRAIN   DESIGN.md + UX     one shared contract, deterministic guardrails
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

/studio mode balanced   the default
/studio mode design-first
/studio mode ux-first

/studio designer <mode>  off | studio (default) | upstream
/studio status           current profile, phase, gate and DESIGN.md
/studio doctor           vendor integrity, engines, DESIGN.md schema
/studio off              pause Studio for this project
```

The designer engine ships its own commands too — `/designer`,
`/designer-doctor`, `/designer-reset` — and they work. `/studio designer` only
decides how much authority the engine keeps:

| Mode | Engine commands, skills, validators | Upstream prompt injection | 12-skill gate | Session-stop enforcement |
| --- | --- | --- | --- | --- |
| `studio` (default) | yes | no — Studio composes the prompt | no — Studio owns blocking | no — Studio's audit gate |
| `upstream` | yes | yes | yes (deny-by-default) | yes |
| `off` | no | no | no | no |

## Profiles

Profiles change **intensity, never authority**.

| Profile | Designer | UX during build | Final audit |
| --- | --- | --- | --- |
| `balanced` (default) | normal exploration, 2 visual reviews, 1 repair loop | lite | strict |
| `design-first` | high exploration, 3 visual reviews, 2 repair loops | lite | strict |
| `ux-first` | low exploration, 1 visual review | strict (blocking) | strict |

In every profile the Designer owns subjective visual direction, the UX engine
owns deterministic validation, and Studio owns orchestration. Phases are
separate from profiles: `/studio mode design-first` followed by `/studio audit`
still runs a serious deterministic audit.

## DESIGN.md

One file, at the project root, written by the Designer and validated by the UX
engine. Both upstream projects defined this file separately; Studio consolidates
them on a single schema and transforms both skills to point at it.

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

Order of authority: user instructions, then product and functional
requirements, then `DESIGN.md`, then local taste. Accessibility failures get
fixed, not overridden. The UX engine never redesigns; the Designer never waves
away a failing gate.

## Tools

| Tool | What it does |
| --- | --- |
| `ux_audit` | the pi-ux gate, registered under its upstream name — APCA contrast, token coverage, interaction states, named slop tells |
| `studio_check` | both engines in one call: UX audit + `fix-ai-slop` validator + `analyze-layout` validator (audit phase) + DESIGN.md schema compliance. Drives the audit gate. |

## Anti-slop, without dogma

Card grids, gradients, purple glow, pill buttons, glassmorphism, oversized hero
copy, random shadows and floating containers are defaults, not crimes. If
`DESIGN.md` calls for one, use it and own it. The test is intent, not
orthodoxy.

## How the wrapper works

```text
OMP
 │
 ▼
PI UI STUDIO            src/index.ts — one extension, one command surface
 │
 ├── Designer adapter   src/adapters/designer-engine.ts
 │      │               path shim + runtime files + editor bridge
 │      ▼
 │   vendored omp-designer extension, skills, validators, dataset
 │
 └── UX adapter         src/adapters/ux.ts
        │               loads the audit kernel and exported helpers
        ▼
    vendored pi-ux audit kernel + skills
```

Upstream source is vendored from the published npm artifacts by
`scripts/sync-upstream.mjs`, which records SHA-256 digests in
`vendor/manifest.json` and applies two documented, anchor-asserted transforms.
Nothing in `vendor/` is hand-edited. A scheduled GitHub Action checks upstream
for new releases and opens a pull request; contract tests fail loudly if an
update breaks an assumption this package depends on.

Full details, including the inspection that led to these decisions, are in
[`docs/architecture.md`](./docs/architecture.md).

## Platforms

macOS, Linux and Windows. Two details make that true: runtime files are copied
rather than symlinked (NTFS symlinks need Developer Mode), and the path shim
sets both `HOME` and `USERPROFILE` because `os.homedir()` reads the latter on
Windows. WSL is the smoothest Windows path, but native Windows works.

## Development

```bash
npm install
npm run verify          # typecheck + tests + package dry-run
npm run sync            # re-vendor the pinned upstream versions
npm run sync:check      # report upstream drift without writing
```

Requirements: Node 20+ to run the toolchain. At runtime the plugin needs
whatever the host provides.

## Credits & licensing

PI UI Studio is MIT licensed — see [`LICENSE`](./LICENSE). It bundles
unmodified (or minimally transformed) copies of two MIT-licensed projects:

- **`omp-designer`** © Leandro (LePro10) — <https://github.com/LePro10/omp-designer>
- **`@bacnh85/pi-ux`** © bacnh85 — <https://github.com/bacnh85/pi-extensions/tree/main/pi-ux>

Their license texts, copyright notices, the exact versions bundled, and the
list of transformations applied are in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). This project claims no
authorship over their work — it packages, adapts, and orchestrates it.
