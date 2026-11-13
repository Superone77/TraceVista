# Follow a local agent session

Capture an existing session and keep reading its new records without rerunning
conversion. This is the local ingestion foundation for [Live Trajectory Tracking
(#33)](https://github.com/Superone77/TraceVista/issues/33).

Supported sources are native **Codex rollout JSONL**, **Claude Code session
JSONL**, and **DeepSeek Harness v4 native JSONL**. Select one file explicitly;
the follower does not scan your machine or automatically switch sessions.
It runs on Python 3.10+ with no additional packages and makes no model requests.

## Start following

Run from the TraceVista repository:

```sh
mkdir -p local-data
python3 integrations/live-session/follow_session.py /absolute/path/session.jsonl \
  --agent codex \
  --journal local-data/session.sqlite \
  --snapshot local-data/session.snapshot.jsonl
```

Use `--agent claude-code` or `--agent deepseek-harness` for those native formats.
Codex `exec --json` output and Harness exported JSON envelopes are not native
session files and are not supported here.

The command captures existing history, then polls every second. Each source
record is printed as a JSON line. Ctrl+C stops capture. `--interval 0.5` changes
the interval; `--once` captures only complete records within the file size
observed at startup and exits.

The optional snapshot is an atomic, byte-for-byte copy of the captured JSONL
prefix. A partially written last line waits for its newline, including when a
write splits a UTF-8 character. Unknown fields and attachments are retained.
This local capture layer does not redact content: treat journals and snapshots
as private session data. New journal and snapshot files use private permissions.

## Resume and convert

Restart with the same journal. SQLite commits original records and the byte
cursor together, so restarting does not recapture committed records. Standard
output replays the journal before emitting new arrivals. Consumers can
deduplicate by `id`, or pass the last received `byte_start` with `--after N`.
Use a separate journal for each source.

Use the snapshot with the existing conversion workflow:

```sh
python3 skills/tracevista-skill/scripts/extract_timeline.py \
  local-data/session.snapshot.jsonl --out local-data/timeline
```

Then use `tracevista-skill` to analyze the timeline and produce the standard
`.agent-state.json`. The follower snapshot is native JSONL, **not** a viewer
`.agent-state.json`. The local viewer below can refresh Map/Story and summarize new records. SSH and
OpenTelemetry remain in #33.

## Shared capture interface

`SessionFollower(source, journal, agent)` provides:

| Method | Result |
| --- | --- |
| `poll()` | Newly committed records in file order, in bounded batches |
| `replay(after=-1)` | Saved records after a `byte_start` cursor |
| `export(path)` | Atomic native JSONL snapshot of committed records |
| `close()` | Close the journal |

Each `tracevista-live-record` envelope contains a stable `id`, `agent`, native
`session_id` when available, `byte_start`, `byte_end`, the unmodified parsed
`record`, and `tool_links`. IDs derive from the selected source path, agent, and
byte offset and remain stable across restarts with the same source. Native IDs
remain inside `record`. Claude preamble metadata can precede its first session
ID, so those envelopes have `session_id: null`.

Tool links retain native call IDs. Calls have `status: started`; results have
`status: completed`, or `failed` when the native record explicitly indicates
failure. Completed does not mean successful. Consumers pair links within the
selected session. A call without a result remains ongoing or unresolved; a
result without a captured call must not be paired by proximity. Repeated source
messages remain distinct; repeated delivery of the same committed source
position is deduplicated.

Capture assumes an append-only source. Resume verifies the full captured prefix;
normal polls check file identity, length, and the last committed record. Older
in-place edits during capture are outside this append-only contract. Truncation,
replacement, malformed complete JSONL, a changed session ID, or a changed checked
prefix stops capture and preserves the last journal and snapshot. If a file
temporarily disappears, restore that same file and restart. Rewritten or rotated
sources need a new journal.

Records are limited to 32 MiB; batches target 4 MiB, allowing one larger record
up to the limit. The API allows overriding both limits. Normal polls process new
bytes and check the last record; resume hashes the full captured prefix once.
Snapshot export rewrites the captured prefix, so omit `--snapshot` for very long
sessions when only consuming the incremental stream.

## Validation

```sh
python3 -m unittest discover -s integrations/live-session/tests -v
```

Tests use synthetic native records for append, partial UTF-8, replay, tool
call/result links, failed results, bounded reads, replacement, malformed records,
and CLI restart. They do not claim live-agent or SSH testing.


## Open the live viewer

For agent-driven startup, session discovery, reuse and shutdown, use
[`tracevista-live-skill`](../../skills/tracevista-live-skill/SKILL.md). It can follow
the invoking agent by an exact session ID, or another agent by an explicit local
log path. It launches this viewer as a background service without model calls.

```sh
pnpm build
python3 integrations/live-session/serve_live.py \
  --source /absolute/path/session.jsonl --agent codex \
  --journal local-data/session.sqlite --port 3904
```

Open the localhost URL printed by the server. The URL contains a temporary
access token in its fragment; the viewer removes it from the address bar and
keeps it in session storage for reloads. The server binds only to 127.0.0.1,
serves one explicitly selected file, and rejects foreign origins and unauthenticated
record requests. It serves the built viewer; rebuild after frontend edits.

For a synthetic CSV-parser replay, use `--demo` instead of `--source` and
`--journal`. The example is labeled Synthetic demo and appends a record every
four seconds. Restart the demo command to replay it from the beginning.

The live toolbar supports Pause, Resume, Stop, Follow latest, unread counts,
and Summary settings. Raw records arrive without a model. Select your provider,
endpoint, model, and key, then enable Automatic summaries. Existing remembered
Chat settings are reused; keys entered here remain in memory. Text records go
directly from the browser to that model. Images are omitted. Each request reads
up to 32 unprocessed semantic units plus previous summaries; long records are
explicitly excerpted. Choose a 5–60 second interval to control request frequency.
Requests never overlap in one viewer. Pause, Stop, disabling summaries, changing
settings, leaving the live view, or losing the connection cancels in-flight work.
Errors disable automatic summaries until Retry or manual re-enable.

Summary IDs and evidence references are validated before publishing. Failed
requests preserve the last usable graph. Completed summaries stay in this tab's
session storage and are reused on reload; raw records are replayed from the local
journal. Graph updates preserve reader state instead of remounting the reader.
Follow latest explicitly moves both Story and Map; leave it off to read earlier
records. The live-only **Now** toggle keeps the newest node centered at the
selected detail level. All four levels remain selectable, and zoom stays under
user control. Turn Now off to pan freely. Chat turns retain the capture boundary used for that answer. JSON/HTML
exports include captured records and summary coverage in `liveCapture`.

Analysis starts with the newest meaningful activity and then fills earlier history.
New arrivals take priority over the remaining backlog. The first valid batch
appears immediately; graph nodes remain in source chronological order. Runtime
metadata stays in raw evidence, while related tool calls and results form one
unit. The model groups units into conceptual actions and purpose-based phases;
states describe evidenced artifact versions. Earlier-history patches preserve
existing IDs and the latest-progress overview. There is no Delivered badge for a growing capture.
The interval controls new requests, not model processing time; model latency can
make summaries lag behind raw records. Multiple viewer tabs have separate
summary schedulers, so enable automatic summaries in only one tab to avoid
paying for duplicate analysis.

Live views default to Execution order: adjacent states are connected by source
record order, including when earlier history is filled in. These edges do not
claim artifact ancestry; Version tree only shows explicitly supported relations.
