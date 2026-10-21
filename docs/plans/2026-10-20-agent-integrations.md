# Agent integrations

## Agreed scope

Maintain optional integrations in this repository, sharing the viewer and the
canonical `skills/tracevista-skill`. Develop on `codex/deepseek-harness-plugin`;
merge through review. Do not publish packages or change the production site as
part of local implementation.

Expose the skill through Claude Code, Codex, Cursor, Gemini CLI, OpenCode and Pi
installation mechanisms. Platform packaging does not imply that every platform's
native log format is already supported by the converter.

## DeepSeek Harness

Target the inspected `0.2.1-rc.2` contracts. The plugin reads a fixed prefix of a
selected session through the persistence service, including inherited records
and failed attempts. It preserves sequence, header, cutoff and raw provenance.
The generic skill gains a Harness input adapter.

A user invokes `/tracevista` or opens the session's TraceVista tab. Conversion
uses the current session's provider/model through the host LLM service, in a
separate conversation. Its only tools read extracted evidence/references and
submit analysis. Host-owned Python scripts compile and validate the result.
There is no access to general shell or workspace-writing tools in this loop.
Every evidence part must be read before an analysis is accepted.

Jobs are asynchronous, cancellable, bounded, and report extraction/reading/
validation/completion states. Results can be downloaded and opened in the
existing cloud viewer through its origin- and token-checked browser handoff.
The first version targets the loopback Harness Web UI; non-loopback users can
download and import the same standard file. No model call runs on installation
or merely opening a tab.

The plugin has a separate package manifest/build. Ordinary TraceVista install,
tests and builds do not depend on Harness packages or examples. Shared skill
files are copied into release artifacts at build time, never maintained twice.

## Verification

- Synthetic Harness snapshots: source preservation, pairing, attempts, inherited
  records, unsupported versions and exact prefix validation.
- Controlled analyzer: evidence coverage, malformed tool arguments, invalid
  analysis, budget/cancellation and publication only after compiler validation.
- Host routing: authenticated transport, session isolation and download behavior.
- Browser: conversion state, exact-origin handoff and cleanup on session changes.
- External package: inspect archive; load in an isolated pinned Harness runtime.
- Existing TraceVista tests/build and platform manifest/install checks.

Keyless fixtures and mocked model responses validate integration behavior.
Report separately whether a real provider-backed conversion has been exercised.
