# MiniMax Code snapshots

The extractor accepts a **user-selected raw `messages.jsonl` file** as a captured
active-generation snapshot. It reads only that file. It does not discover private
logs, select the current chat, open the runtime database, read sibling manifests
or catalogs, or load earlier generations and child sessions.

MiniMax rotates history during compaction. Consequently, one `messages.jsonl`
does not establish a complete conversation. A `compactionSummary` can describe
earlier work that is absent from the selected file. State this boundary in the
export's overview and do not reconstruct those actions from the summary.

```sh
python3 /absolute/skill/scripts/extract_timeline.py /absolute/captured/messages.jsonl \
  --images omit --out /absolute/work/extracted
```

Choose `keep` or `omit` using the normal image-choice workflow. Capture the input
after writes have settled. A malformed JSONL line, including an unfinished final
line, fails extraction with its line number; it is never silently discarded.
JSON arrays and timestamp-prefixed MiniMax console output are unsupported.

The envelope has `message_id`, `turn_id`, and a `message` object with a recorded
`role`. It has no Claude Code `type: assistant/user` wrapper. Detection requires
that envelope; ordinary chat-shaped JSON is insufficient.

## Evidence mapping

| Native evidence | Timeline representation |
| --- | --- |
| `message_id`, `turn_id`, `message.responseId` | `message_id` / `event_id`, `turn_id`, `response_id`; generated `E…` IDs remain separate |
| `message.timestamp` | Epoch milliseconds retained as `source_time`, normalized UTC `timestamp`; absent or invalid time remains unknown |
| Content blocks | Original block order, full text and `block` index; `source_line` plus a JSON pointer relative to that JSONL row |
| `text`, `thinking` | User/note/result text according to native role; assistant thinking stays thinking |
| Assistant `toolCall` | Call with native ID/name and exact string arguments, or serialized structured arguments |
| `toolResult` | Native `toolCallId`, `toolName`, `isError`, and `details`; pairing uses IDs only |
| Model/provider/API, usage, stop reason | Recorded fields retained; no guessed model or successful completion |
| Empty/unknown messages and blocks | Visible status records; original rows remain in the source archive |
| `compactionSummary`, `history_artifact` | Status evidence and recorded generation metadata; no history reconstruction |

The first event is explicitly an `exporter-status`, not a native message. Its
`snapshot_scope` states `history_complete: false`, and the session summary repeats
that scope. The archive contains the selected source text and original SHA-256,
subject to normal redaction and the selected image policy. Image or file paths
inside the log stay references; extraction does not open them.

## User text and UTF-16 offsets

MiniMax can store Host context under role `user`. When `canonicalTextRange` is
present, its offsets are interpreted as JavaScript UTF-16 code units into the
text blocks joined with a newline. Text inside the range becomes user evidence;
prefix and suffix remain status evidence. Splitting preserves whitespace and
block order. Emoji count as two code units; offsets through a surrogate pair or
outside the text are invalid. An invalid range leaves the text as status with
`canonical_range_status: invalid` and `prompt_attribution: unresolved`.

Without a range, text retains its native user role and is marked
`prompt_attribution: native-user-role`. That role alone does not prove the person
typed every part of the text. Unknown blocks and absent context are not inferred.

## Repetitions and input tokens

An exact repeated JSON object becomes an explicit status record with
`duplicate_of_line`; its full row and source position remain available. This
avoids counting repeated tool calls twice. A changed record with the same
`message_id` keeps both versions and carries `message_id_conflict_lines`. The
adapter does not choose which version is authoritative or merge compaction
generations. Differences in generation metadata are also retained conservatively.

Input usage is the recorded `input + cacheRead + cacheWrite`, counted once per
`responseId`, falling back to `message_id` and then the individual row when IDs
are missing. Equal reports for an identity count once. Conflicting input reports,
or changed records sharing a message ID, leave that identity's input unknown and
exclude it from the known subtotal. Native output, total, cost, and future usage
fields are retained without being added to input tokens.

All three input counters must be recorded, finite nonnegative integers for a
complete input total. Missing or invalid fields are not replaced by zero. The
timeline and session summary expose `tokens_in_known` for recorded counters and
`tokens_in: null` / `tokens_complete: false` when the total is incomplete. An
entirely missing usage report remains unknown. These totals describe the selected
snapshot, not billing or usage across the complete conversation.

## Compatibility and validation boundary

This is an adapter for an undocumented internal format, implemented independently
from public examples in the official community repository. Its synthetic tests
cover source retention, UTF-16 ranges, tool pairing, duplicate/conflicting rows,
missing usage, unknown records, malformed lines, image omission and redaction.
They do not establish installation or execution inside MiniMax Code.

Public format evidence, inspected at commit
`9269f35097fae982965e7e6e6876457de1faec73`:

- [Session Trajectory](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/blob/9269f35097fae982965e7e6e6876457de1faec73/plugins/avatasia/mmc-trajectory/README.md)
- [Session parser and history reader](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/blob/9269f35097fae982965e7e6e6876457de1faec73/plugins/avatasia/mmc-trajectory/miniapp/node/server.mjs)
- [File-based Token Usage Board](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/blob/9269f35097fae982965e7e6e6876457de1faec73/plugins/amszuidas/mcode-token-usage-board/miniapp/node/server.mjs)
