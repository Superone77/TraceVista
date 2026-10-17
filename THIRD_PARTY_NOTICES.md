# Source and attribution

## Viewer

The local state/trajectory viewer was developed from the ThoughtDAG codebase:
https://github.com/chenxiachan/thoughtdag (copyright © 2026 Xia Chen, MIT).
Its license is preserved at [LICENSES/ThoughtDAG-MIT.txt](LICENSES/ThoughtDAG-MIT.txt).
The local source checkout had base commit `5e876d8e1e31881a8da9cf95d103e1adac0fb74a`
plus local state-view modifications; this repository contains the actual modified source,
not a claim that these features exist in that upstream commit.

This package extracts the state viewer only. It preserves the React Flow attribution and
uses React / React Flow / Vite / bundled Inter fonts. The dependency lock records exact
versions and package integrity. No upstream chat backend or model API proxy is included.

The reading layer adapts further ThoughtDAG modules (same copyright and MIT license):
`viewer/src/trajectory/ladder.ts` (from `src/lib/ladder-core.ts`), `ZoomText.tsx` (from
`src/components/ZoomText.tsx`), `RoutedEdge.tsx` (from `src/lib/edge-path.ts`), the tool
fingerprint in `model.ts` (from `src/lib/turn-insight.ts`), the fold rule in `semantic.ts`
(after `src/lib/condense.ts`), and the prompts behind `references/reading-layer.md` (after
`src/lib/ladder.ts` and `src/lib/gedankengang.ts`).

The browser provider catalog and live model discovery in `viewer/src/trajectory/providers.ts`
follow ThoughtDAG's `src/lib/runtime-providers.ts` and streaming behavior in `src/lib/direct-llm.ts`
(same copyright and MIT license). Vendor-specific endpoints are checked against official API
documentation. Its proxy, OAuth and subscription bridges are not included.

## Conversion skill

`skills/tracevista-skill` is copied from the user's local private skill repository
(base commit `e0c1221a4d45c9c006dc7cc6d5f2805e2f3e8cde` plus local state/observation changes).
This repository contains the complete version used by the example, including standalone-export changes. It does not depend on access to the older private repository.

## External example library

The public research and creative examples live in the independent `TraceVista-examples`
repository. Their source-specific attribution, preserved evidence, and license terms are
recorded in that repository's `THIRD_PARTY_NOTICES.md` and `LICENSES/`. The viewer's MIT
license does not replace those terms.

The default viewer build includes no example trajectories. A showcase build includes the
pinned library notices at `examples/THIRD_PARTY_NOTICES.md` and its license copies under
`examples/LICENSES/`. See [docs/EXAMPLES.md](docs/EXAMPLES.md) for the local library layout,
pinned version, and build commands. The library is available at
[Superone77/TraceVista-examples](https://github.com/Superone77/TraceVista-examples).
