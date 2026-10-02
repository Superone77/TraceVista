# File, browser and revision handoff

## What the user receives

| Artifact | Purpose |
| --- | --- |
| `*.agent-state.json` | Complete, portable trajectory with raw events and source attachments |
| `*.html` | Local overview with Open in TraceVista and Download JSON buttons |
| quality report | Reading-layer coverage and remaining annotation gaps |
| session revision | Saved graph and optional authoring inputs for subsequent changes |

The viewer URL defaults to `https://tracevista.pages.dev/`. It is the engine's address,
not a link to a stored trajectory. Return the local HTML link alongside the JSON. Capturing
a screenshot of the actual viewer is optional; do not present the HTML overview as the
engine's semantic zoom or as an inline chat widget.

## Opening

```sh
python3 /absolute/skill/scripts/create_handoff.py /absolute/task.agent-state.json \
  --out-dir /absolute/work/handoff --name task
```

Open the returned `handoff_html` in a browser. Click **Open in TraceVista**; the new tab
loads the engine, then receives this file through a browser-window message. A successful
handoff reports that the viewer loaded it. A failed or blocked attempt offers manual import.
Keep the handoff open until that acknowledgement arrives.

The HTML can run as a local file (`file://`) or from a loopback HTTP server. For environments
that cannot open file URLs, serve only the handoff output directory:

```sh
python3 -m http.server 8880 --bind 127.0.0.1 --directory /absolute/work/handoff
```

For a running local or self-hosted viewer, provide `--viewer-url` when generating:

```sh
python3 /absolute/skill/scripts/create_handoff.py /absolute/task.agent-state.json \
  --out-dir /absolute/work/handoff --viewer-url http://127.0.0.1:8875/
```

The handoff does not package or start that engine. A deployed viewer with this receiver
supports direct opening; older deployments still accept the JSON through **导入轨迹**.
If a popup is blocked, enable it for the local handoff or use manual import. If the file
exceeds the handoff limit of 64 MiB, use manual import; do not truncate the trajectory.
This limit is not a guarantee of smooth rendering for graphs of that size.

Opening uses the selected viewer's code to process the file locally in the browser.
The handoff helper performs no network upload and creates no cloud-stored copy. It has
no share-link service. Optional viewer chat sends the chosen context to the user's
configured model endpoint only when the user asks a question.

## Incremental revision state

```sh
python3 /absolute/skill/scripts/session_state.py show
python3 /absolute/skill/scripts/session_state.py --state-dir /absolute/work/state show
```

Use the same project directory or explicit state directory for follow-up edits. The default
is `.work/tracevista/state`; `TRACEVISTA_STATE_DIR` overrides it. `save` snapshots bytes into
a new revision directory and atomically updates the latest pointer. Older revisions remain.
`show` checks that the saved graph exists and matches its recorded checksum. Use the returned
paths rather than reconstructing revision names. Save only artifacts from the same run.

For reading-layer-only changes, keep event text/source attachments unchanged and apply a
patch to the saved graph. For state/branch/evidence-mapping changes, edit the saved analysis
and rebuild with its timeline. Retain unknown fields and stable IDs. Regenerate the handoff
from the new export so that it cannot open a stale graph.

## Browser protocol v1 (engine maintainers)

The handoff opens the chosen viewer with a fragment:
`#tracevista-import=<32–128 hexadecimal characters>&source=<encoded sender origin>`.
It puts no trajectory content in the URL. Allowed sender origins are the opaque `null`
origin of a local file, or HTTP(S) loopback origins `localhost`, `127.0.0.1`, `[::1]`.

Messages contain `type` and `token`:

1. Viewer → opener: `tracevista:ready`.
2. Opener → viewer: `tracevista:import`, plus `json` (the complete JSON string).
3. Viewer → opener: `tracevista:loaded`, or `tracevista:error` with a fixed error code.

The sender checks the new window identity, exact viewer origin and random token, and sends
JSON only to that exact origin. The receiver checks opener identity, exact sender origin
and token. Only explicit handoff URLs activate it. The receiver clears the fragment, accepts
one matching import and runs the ordinary graph parser before acknowledging success. Both
sides stop listening after completion or 30 seconds. A `null` target requires `*` for the
receiver's acknowledgements; these messages contain no trajectory data. No raw exception
text is returned. Files are limited to 64 MiB of UTF-8 data for this handoff path.
