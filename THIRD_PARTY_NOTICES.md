# Third-party notices

TraceVista's original code and documentation are available under the [MIT License](LICENSE).
The following components and example sources retain their own attribution and terms.

## ThoughtDAG

The trajectory viewer and reading layer adapt code and ideas from
[ThoughtDAG](https://github.com/chenxiachan/thoughtdag), **Copyright (c) 2026 Xia Chen**,
under the MIT License. The complete copyright and license text is preserved in
[LICENSES/ThoughtDAG-MIT.txt](LICENSES/ThoughtDAG-MIT.txt).

Adapted components include:

| TraceVista component | ThoughtDAG source |
|---|---|
| `viewer/src/trajectory/ladder.ts` | `src/lib/ladder-core.ts` |
| `viewer/src/trajectory/ZoomText.tsx` | `src/components/ZoomText.tsx` |
| `viewer/src/trajectory/RoutedEdge.tsx` | `src/lib/edge-path.ts` |
| Tool fingerprints in `viewer/src/trajectory/model.ts` | `src/lib/turn-insight.ts` |
| Fold rules in `viewer/src/trajectory/semantic.ts` | `src/lib/condense.ts` |
| `skills/tracevista-skill/references/reading-layer.md` | Prompts in `src/lib/ladder.ts` and `src/lib/gedankengang.ts` |
| Provider catalog and model discovery in `viewer/src/trajectory/providers.ts` | `src/lib/runtime-providers.ts` |
| Browser streaming behavior | `src/lib/direct-llm.ts` |

The conversion skill is maintained in this repository under TraceVista's MIT License;
the ThoughtDAG-derived reading instructions retain the attribution above.

## Dependencies

The viewer uses React, React Flow, Vite, and Inter fonts. Their packages carry their own
licenses. The dependency versions and integrity hashes are recorded in `pnpm-lock.yaml`.
React Flow's on-canvas attribution is preserved.

## Example library

Example trajectories are published separately in
[TraceVista-examples](https://github.com/Superone77/TraceVista-examples).
Its MIT License covers TraceVista's original annotations, organization, metadata, and
documentation. Source records, code excerpts, images, and other third-party material
retain the terms documented in that library's
[THIRD_PARTY_NOTICES.md](https://github.com/Superone77/TraceVista-examples/blob/main/THIRD_PARTY_NOTICES.md).

The standalone viewer does not bundle examples. A showcase build publishes the pinned
library's `LICENSE` as `examples/LICENSE`, its notices as
`examples/THIRD_PARTY_NOTICES.md`, and license copies under `examples/LICENSES/`.
See [docs/EXAMPLES.md](docs/EXAMPLES.md) for the library layout and build commands.
