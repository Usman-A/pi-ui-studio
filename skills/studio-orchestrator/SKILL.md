---
name: studio-orchestrator
description: "UI Studio workflow. Use in any Studio phase (/studio explore|build|review|audit) to learn who owns which decision, how DESIGN.md is used, what each phase does, and where the loops are bounded."
---

# UI Studio — orchestration

Two engines, one contract, and a clear owner for every decision.

| Owner | Decides | Never decides |
| --- | --- | --- |
| Designer | visual identity, art direction, type, spacing, hierarchy, composition, motion direction, critique | whether a deterministic check may fail |
| Pi UX | contrast/APCA, token consistency, interaction states, reduced motion, slop tells, DESIGN.md compliance | what the interface should look like |
| Studio | which engine runs, how hard, when, and whether it blocks | visual taste, accessibility trade-offs |

`DESIGN.md` at the project root is the shared contract between them. The
Designer writes it; the UX engine validates against it. Never fork it, never
regenerate it wholesale to silence a check.

## Rules that outrank everything below

1. User instructions always win.
2. Product and functional requirements beat aesthetics.
3. Accessibility failures get fixed, not aesthetically overridden.
4. The UX engine never redesigns. Report drift; the Designer decides.
5. Reuse existing components and tokens before adding anything new.

## DESIGN.md — the one contract

One file at the project root, written by the Designer, validated by the UX
engine, checked by `studio_check`. Never fork it, never regenerate it wholesale
to silence a check, never write a second copy to `local://`.

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

Extra sections — Motion, Spacing, Radius, Grid, Image Style, Accessibility —
are welcome. Those six and those five frontmatter keys are the contract:
`/studio audit` fails without them.

Order of authority: user instructions, then product/function requirements,
then `DESIGN.md`, then local taste. Accessibility failures get fixed, not
overridden. The UX engine never redesigns; the Designer never waves away a
failing gate.

## Phase: explore

- Designer leads. Purpose: concept, hierarchy, layout idea, visual identity, type, references, motion and interaction concepts.
- Read `skill://designer-master`, `skill://taste-skill`, `skill://reference-study`, `skill://design-md`, and `skill://ui-ux-pro-max` for palettes and pairings as needed.
- Pi UX is quiet here. Do not tune a concept for audit scores.
- Output: a direction, plus a `DESIGN.md` in the canonical schema once there is something real to pin down.

## Phase: build

- Read project/product context, then `DESIGN.md`, then implement.
- Declare the screen's job first: what it is for, what its primary action is.
- Reuse existing components and tokens. A second design system is a bug.
- Ship states: default, hover, focus-visible, active, disabled, plus loading, empty and error where relevant.
- Respect the profile's UX level: lite is advisory, strict is blocking.

## Phase: review

Render, capture, look. Judging from source code is not visual review.

1. Run the app and capture screenshots (desktop, 375px, 1024px; scroll the whole page).
2. Compare against `DESIGN.md`.
3. Read `skill://visual-critique` and critique in this order: hierarchy, typography, whitespace and spacing, density, alignment, visual balance, unclear primary action, generic-AI tells, decoration that earns nothing.
4. Fix the highest-impact issues only, then re-render.

The number of review passes and repair loops comes from the profile. Stop when
the bound is reached; ship the best version you have.

## Phase: audit

The engineering gate. Blocking by design.

1. Run `studio_check` against the real stylesheet and project root.
2. Fix every blocking item it reports: contrast/APCA, off-system colours, ad-hoc shadows, missing `:focus-visible` / `:disabled`, motion without `prefers-reduced-motion`, slop tells, DESIGN.md compliance.
3. Re-run until it passes.
4. Finish with a last visual inspection of the rendered result.

Do not declare a screen done while genuine blocking failures remain.

## Anti-slop, without dogma

Card grids, gradients, purple glow, pill buttons, glassmorphism, oversized hero
copy, random shadows, and everything floating in a container are defaults, not
choices — but they are not banned. If `DESIGN.md` genuinely calls for one, use
it and own it. The test is intent: can you say why this element, this value,
this motion? "Because AI UIs usually do" is not an answer.

Copy follows the same rule: no invented prices, metrics, testimonials, or
counts. If a fact is missing, say so.
