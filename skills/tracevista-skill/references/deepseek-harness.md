# DeepSeek Harness sessions

The extractor accepts a plugin snapshot or an uncompressed native v4 session
JSONL file. The plugin snapshot is the preferred input: Harness opens historical
storage through its persistence service and returns current logical records.

```json
{
  "format": "deepseek-harness-session",
  "version": 1,
  "sessionId": "session-id",
  "header": {
    "version": 4,
    "id": "session-id",
    "createdAt": 1770000000000,
    "isSeeded": false
  },
  "inheritedEventCount": 0,
  "cutoffSeq": 0,
  "events": [
    {
      "type": "turn/start",
      "seq": 0,
      "time": 1770000000000,
      "data": {"turn": 0}
    }
  ]
}
```

`inheritedEventCount` and `cutoffSeq` are optional. If supplied, they must match
the inherited-prefix marker and final event. An empty snapshot uses a null
`cutoffSeq`. Every snapshot contains the complete contiguous prefix from seq 0.
The snapshot version is independent from `header.version`, the Harness session
format version. The extractor currently accepts session v4; open older native
logs in Harness before exporting. Compressed `.jsonl.zstd` storage should also
be exported through Harness.

```sh
python3 /absolute/skill/scripts/extract_timeline.py /absolute/session.tracevista-session.json \
  --images omit --out /absolute/work/extracted
```

## Evidence retained

- Each source event keeps its native `source_seq`, session ID, epoch time and
  JSON pointer (or native JSONL line number). The complete source is archived
  under the normal redaction and image rules.
- Messages retain their recorded author/source, IDs and content. Injected
  skill/context messages are status evidence, not invented human instructions.
- `tool/call` is the invocation authority. The same tool request in assistant
  content remains visible without being counted twice. Results pair only by
  their native call ID; errors and tool-specific metadata are retained.
- Settled assistant messages retain recorded model/provider, interruption and
  usage. Failed or cancelled attempts stay visible separately, including
  recorded reasoning and terminal reason. Raw stream timing/delta boundaries
  remain in the source archive.
- Input accounting adds uncached, cache-read and cache-write tokens once per
  attempt. A committed message's usage takes precedence over its stream usage.
  Missing usage remains unknown.
- Request configuration, compaction, retries, boundary markers, and unknown
  plugin events remain status records. A surface replacement does not delete
  the original records from this export.
- Session header and inherited-prefix metadata retain fork ancestry. A fork
  represents session ancestry; it does not prove a source-code rollback.

## Author the four layers from evidence

Harness turns and steps describe execution boundaries. They are not automatically
system states or work phases. Use artifact changes, decisions, measured results
and explicit branch/restore operations to construct those layers. Keep observed
facts separate from inferred intent. Cite original event IDs for every claim.

Use the same `state-analysis.json`, reading-layer requirements, compiler and
validator as other agent formats. Capture a fixed event cutoff before conversion;
run the analysis separately so its own tool calls do not become part of the
session being explained.

Image and file attachment references remain references. The extractor does not
read paths or fetch attachment URLs. `--images keep` preserves embedded content
that exists in the snapshot; it does not promise missing attachment bytes.

Schemas: [session events](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md),
[persistence](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md).
