---
name: ui-ux-pro-max
description: "Design reference dataset bundled with UI Studio: 161 colour palettes, 57 font pairings, style references, UX guidelines, charts, icons, and per-stack notes. Read before inventing a palette or type pairing — pick a row and keep its exact values."
---

# Design reference dataset

UI Studio vendors the `ui-ux-pro-max` dataset (30 CSVs, ~1.9 MB) from the
designer engine. Use it instead of inventing values.

Resolve the dataset root:

- inside this package: `<package>/vendor/omp-designer/data/ui-ux-pro-max/`
- the absolute path is printed by `/studio doctor`

## The files that matter

| File | Use it for |
| --- | --- |
| `colors.csv` | palettes — pick a row, copy its hex values exactly |
| `typography.csv` | font pairings — copy the exact font names |
| `styles.csv` | layout and visual-style references |
| `ux-guidelines.csv` | interaction and usability rules |
| `ui-reasoning.csv` | why a choice reads the way it does |
| `design.csv`, `landing.csv`, `products.csv` | product/landing composition patterns |
| `charts.csv`, `icons.csv` | data and iconography references |
| `stacks/*.csv` | framework-specific notes (React, Vue, Svelte, Tailwind, …) |
| `app-interface.csv` | application-interface patterns |

## Rules

- One palette row per product. Every colour in `DESIGN.md` comes from that row,
  or is documented as a user/brand derivation.
- No overused defaults unless the brief demands them: Inter, Roboto, Geist,
  Plus Jakarta Sans, Space Grotesk.
- `DESIGN.md` is the contract once written. This dataset is for starting and
  for escaping a dead end — not for churning a finished system.
