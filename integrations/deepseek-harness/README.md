# TraceVista for DeepSeek Harness

Convert the current Harness session into a TraceVista graph with the session's configured model. The plugin captures a fixed snapshot, gives the analyzer read access to that snapshot and the bundled TraceVista skill, and validates the resulting graph before enabling export.

This package targets **DeepSeek Harness 0.2.1-rc.2**, Node.js 24 or newer, pnpm 11 or newer, and Python 3.10 or newer. Harness is in developer preview; other releases need a compatibility check.

## Build and install

From a fresh TraceVista checkout, install the integration's pinned development
dependencies and build it:

```sh
pnpm --dir integrations/deepseek-harness install --frozen-lockfile --ignore-scripts
pnpm --dir integrations/deepseek-harness build
dsh plugin --profile web add ./integrations/deepseek-harness
dsh web
```

The install uses this directory's own `pnpm-lock.yaml`. It adds no Harness
dependencies to the main viewer package. The `dsh` commands require an existing
Harness 0.2.1-rc.2 installation.

For distribution, pack the built package and install the resulting tarball:

```sh
pnpm --config.ignore-scripts=true --dir integrations/deepseek-harness pack
dsh plugin --profile web add ./integrations/deepseek-harness/dsh-plugin-tracevista-0.1.0.tgz
```

The viewer and Harness integration have separate dependencies and release packages. The Harness package includes the built plugin and a copy of the canonical conversion skill.

## Use

Open a Harness session, then use its TraceVista action or `/tracevista`. Conversion uses the latest provider/model recorded by that session, falling back to its creation configuration before its first request. A session with no resolved model asks you to select and use one first.

The analyzer can read timeline parts and bundled skill references and submit an analysis. It receives no shell or workspace editing tool. Host code runs the deterministic compiler and validator after analysis. Cancelling aborts the model request. A failed or cancelled job cannot be downloaded as a completed graph.

On a local loopback Harness page, the completed result opens in an embedded TraceVista viewer through the existing browser message bridge. Other hosts use JSON download and manual import. The plugin never transfers Harness credentials to the viewer.

Conversion shows its current stage, model, elapsed time and evidence-reading progress. Use **Cancel** to stop the current attempt, **Try conversion again** after a failed attempt, or **Refresh status** after a connection problem. **Expand viewer** gives the graph the whole screen; press Escape to return to Harness.

Temporary conversion files are removed when conversion settles. The latest completed graph and JSON remain available while a new conversion runs, and also if that attempt fails or is cancelled. A successful conversion replaces the previous result. Results stay in host memory until session-cache eviction or plugin unload; they are not restored after a Harness restart.

By default, at most two conversions run together, eight session results are retained, and a conversion stops after 15 minutes.

## Configuration

Override the `tracevista` row in a profile patch when needed:

```yaml
- id: tracevista
  config:
    python: python3
    maxSteps: 48
    maxContextChars: 800000
    maxConcurrentJobs: 2
    maxRetainedSessions: 8
    jobTimeoutMs: 900000
```

Model settings come from the invoking session. The browser API rejects model, provider, and credential overrides.

## Development and validation

```sh
pnpm --dir integrations/deepseek-harness install --frozen-lockfile --ignore-scripts
pnpm --dir integrations/deepseek-harness test
pnpm --dir integrations/deepseek-harness build
```

With these dependencies installed, the pipeline test exercises the real Harness
message assembler with scripted responses, then runs the Python extractor,
compiler and validator. No provider credentials are needed. Set
`TRACEVISTA_TEST_PYTHON` if your Python 3.10+ executable is not named `python3`.

The separate [Harness integration CI workflow](../../.github/workflows/harness-plugin.yml)
installs only this package's dependencies, verifies the native protocol import,
runs the tests and build, and checks the packed artifact. Ordinary viewer builds
do not install Harness.

Tests use synthetic session data and stubbed model responses. They establish the host lifecycle and conversion contracts; they do not establish real-model analysis quality. An end-to-end model check needs an explicitly configured Harness model and incurs that provider's usage.

The host registers `GET`/`POST /api/tracevista.job` for status, start, and cancel, and `GET`/`HEAD /api/tracevista.export` for completed exports. These are exact routes on Harness's authenticated connection carrier. The browser addresses them relative to the Harness document so reverse-proxy mounts continue to work.

Upstream contracts:

- [Plugin packaging](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/develop/basic/publish.md)
- [Authenticated connection routes](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/rpc.ts)
- [Model-route inheritance](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/subagent/subagent/src/child-agent.ts)
- [Provider-neutral model calls](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/README.md)
- [Session snapshots](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session-query/session-query/README.md)
