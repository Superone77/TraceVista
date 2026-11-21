# Local toolkit implementation plan

**Goal:** Make TraceVista installable and usable from an agent or terminal without changing the viewer.
**Architecture:** Add Node CLI modules wrapping the existing Python extraction/validation and shared offline HTML renderer. Ship an allowlisted runtime package with no npm runtime dependencies.
**Spec:** ../specs/2026-11-21-local-toolkit-design.md

## Tasks
- [x] Add install and prepare commands, self-contained workflow skill, explicit host selection and conversion handoff.
- [x] Add build/open/info/query/inspect using the existing complete graph, validator and HTML template. Keep input bytes and unknown fields.
- [x] Add distributable package builder and English/Chinese quick starts; preserve existing plugin installation routes.
- [x] Test ambiguous directories, paths with spaces, raw HTML/script characters, invalid graphs, existing destinations, evidence lookup and isolated installation.
- [x] Run existing tests/build and packed-install smoke checks. Record exact validation and commit on the feature branch.

## Checks
No UI source changes; no model/experiment calls; outputs ignored by Git; generated files private. The new CLI tests must run in pnpm test. Verify standalone output opens with its actual trace and existing semantic zoom/navigation. Packaging must exclude logs, credentials, local data, node_modules and Git history.

## Validation recorded 2026-11-21

- Base: origin/main at 5db67b4; branch codex/graphify-product-workflow.
- Existing pnpm test passed before changes and after implementation; six CLI integration tests passed.
- pnpm build passed. Existing bundle-size advisory remains.
- Packed npm installation in a temporary prefix passed: doctor, build, inspect, skill copy and full viewer HTTP checks. Package: 50 files, approximately 965 KB compressed; no npm runtime dependencies.
- Used a temporary official npm 11 installation because this host's Node distribution has no npm command. No global agent settings or model credentials changed.
- Public Pi example: 6 states, 20 phases, 152 actions, 556 events. Complete output bytes match input.
- Browser: local full viewer automatically loaded this Pi trace; Chat and version-tree/execution-order controls are present. No model request was made.
- Viewer and shared conversion-skill source trees are unchanged. Offline HTML retains the existing reading-only behavior; open defaults to the full local viewer.
- No push, registry publication, deployment or main merge performed.
