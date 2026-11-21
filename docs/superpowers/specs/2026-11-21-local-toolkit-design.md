# Local toolkit delivery

The user requested a branch implementing the previously discussed Graphify-style product form while preserving existing functions. This change packages the existing converter and viewer into an install → prepare → interpret → build → browse/query workflow. It does not add verifier dashboards or alter the graph schema or UI.

Approaches considered: documentation-only would leave manual setup and import; changing the viewer would expand the requested scope. A CLI around the existing Python converter and offline HTML exporter provides the requested entry point with no viewer behavior changes.

Deliverables: a dependency-free Node CLI (Python 3.10+ for conversion/validation); explicit project/user skill installation for Codex, Claude Code and Pi; raw extraction with an agent handoff; validated JSON + offline HTML + Markdown report; a loopback-only full viewer opened through the existing import handshake; lexical search and ID inspection of the shared export; a small installable package containing the built viewer and existing conversion skill. Existing plugins and cloud import continue working.

Outputs go into a fresh private directory. Raw text is copied unchanged by build, and search results retain IDs. Raw-log conversion still needs the invoking agent to author the hierarchy. Installation does not contact a model or change credentials. The CLI reports missing Python, missing builds, ambiguous input directories and existing destinations rather than choosing or overwriting silently. No registry publication or main merge is part of this change.
