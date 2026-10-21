"""Read DeepSeek Harness snapshots without deriving or compacting model history.

The supported logical/physical session format is v4. Historical files must first
be opened by Harness, whose persistence service owns their migrations.
"""
import json
from datetime import datetime, timezone

FORMAT = 'deepseek-harness'
SNAPSHOT_FORMAT = 'deepseek-harness-session'
SESSION_VERSION = 4
MAX_SAFE_INTEGER = 2 ** 53 - 1
CORE_TYPES = {'turn/start', 'turn/end', 'step/start', 'step/end', 'user/message',
              'developer/message', 'system/message', 'assistant/message',
              'assistant/attempt', 'tool/call', 'tool/result', 'request/header',
              'request/context', 'session/end-seed'}


def compact(value):
    return json.dumps(value, ensure_ascii=False)


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_SAFE_INTEGER


def require(condition, message):
    if not condition:
        raise ValueError('DeepSeek Harness: ' + message)


def plain(row):
    return {key: value for key, value in row.items() if not key.startswith('_source')}


def validate_header(header, session_id):
    require(isinstance(header, dict), 'header must be an object')
    require(header.get('version') == SESSION_VERSION and not isinstance(header.get('version'), bool),
            'only session format v4 is supported; export historical sessions through Harness')
    require(isinstance(session_id, str) and bool(session_id), 'sessionId must be a nonempty string')
    require(header.get('id') == session_id, 'header.id must match sessionId')
    require(integer(header.get('createdAt')), 'header.createdAt must be epoch milliseconds')
    require(isinstance(header.get('isSeeded'), bool), 'header.isSeeded must be a boolean')
    for name in ('parentSession', 'cwd', 'agentPreset'):
        require(name not in header or isinstance(header[name], str), 'header.' + name + ' must be a string')
    require('delegationDepth' not in header or integer(header['delegationDepth']),
            'header.delegationDepth must be a nonnegative integer')


def validate_events(events, header, inherited=None):
    require(isinstance(events, list), 'events must be an array')
    for index, event in enumerate(events):
        require(isinstance(event, dict), 'event ' + str(index) + ' must be an object')
        require(integer(event.get('seq')) and event['seq'] == index,
                'event sequence must be a complete contiguous prefix starting at 0')
        require(isinstance(event.get('type'), str) and bool(event['type']), 'event type must be a string')
        require(integer(event.get('time')), 'event time must be epoch milliseconds')
        require('data' in event, 'event data is missing')
        if event['type'] in CORE_TYPES:
            require(isinstance(event['data'], dict), 'core event data must be an object')
    markers = [event['seq'] for event in events
               if event['type'] == 'session/end-seed' and event['data'].get('inherited') is True]
    cut = markers[-1] if markers else 0
    require(not header['isSeeded'] or bool(markers), 'seeded session is missing its inherited-prefix marker')
    require(header['isSeeded'] or not markers, 'unseeded session has an inherited-prefix marker')
    if inherited is not None:
        require(integer(inherited) and inherited == cut, 'inheritedEventCount disagrees with the session marker')
    return cut


def prepare(header, events, metadata, header_position, event_positions):
    session_id = metadata['sessionId']
    validate_header(header, session_id)
    cut = validate_events(events, header, metadata.get('inheritedEventCount'))
    common = dict(_source_format=FORMAT, _source_session_id=session_id,
                  _source_inherited_count=cut)
    head = dict(type='session/header', data=dict(header=header, snapshot=metadata),
                **header_position, **common)
    return [head] + [dict(event, **position, **common)
                     for event, position in zip(events, event_positions)]


def snapshot_rows(value):
    """Recognize only the explicit plugin envelope, not arbitrary event arrays."""
    if not isinstance(value, dict) or value.get('format') != SNAPSHOT_FORMAT:
        return None
    require(value.get('version') == 1 and not isinstance(value.get('version'), bool),
            'unsupported snapshot version')
    events = value.get('events')
    require(isinstance(events, list), 'events must be an array')
    metadata = {key: item for key, item in value.items() if key not in ('header', 'events')}
    require('sessionId' in metadata, 'snapshot has no sessionId')
    if 'cutoffSeq' in metadata:
        require(metadata['cutoffSeq'] == (len(events) - 1 if events else None),
                'cutoffSeq must identify the final event, or null for an empty session')
    return prepare(value.get('header'), events, metadata, {'_source_pointer': '/header'},
                   [dict(_source_index=index, _source_pointer='/events/' + str(index))
                    for index in range(len(events))])


def jsonl_rows(rows):
    """Recognize v4 native JSONL with its required `type: session` first row."""
    if not rows or rows[0].get('type') != 'session' or 'version' not in rows[0]:
        return rows
    # Pi also has type:session headers. DSH's isSeeded/delegationDepth fields
    # distinguish its physical format from the Pi session format.
    if 'isSeeded' not in rows[0] and 'delegationDepth' not in rows[0]:
        return rows
    require(all('_source_runner' not in row for row in rows), 'native JSONL contains a malformed record')
    header = plain(rows[0])
    require('delegationDepth' in header, 'native v4 header is missing delegationDepth')
    events = [plain(row) for row in rows[1:]]
    metadata = dict(format=SNAPSHOT_FORMAT, version=1, sessionId=header.get('id'),
                    inputFormat='native-jsonl')
    return prepare(header, events, metadata,
                   {'_source_line': rows[0].get('_source_line')},
                   [{'_source_line': row.get('_source_line'), '_source_index': index}
                    for index, row in enumerate(rows[1:])])


def iso_time(milliseconds):
    try:
        return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (ValueError, OverflowError, OSError):
        return milliseconds


def stream_usage(stream):
    """A settled attempt carries cumulative counters; use the final report."""
    reports = [record['chunk']['usage'] for record in stream
               if record.get('type') == 'chunk' and isinstance(record.get('chunk'), dict)
               and record['chunk'].get('type') == 'usage' and isinstance(record['chunk'].get('usage'), dict)]
    return reports[-1] if reports else {}


def stream_blocks(stream):
    """Readable blocks from an uncommitted attempt; exact deltas stay in source."""
    accumulated, order = {}, []
    for position, record in enumerate(stream):
        require(isinstance(record, dict), 'assistant stream record must be an object')
        kind = record.get('type')
        if kind in ('text-chunks', 'reasoning-chunks', 'tool-call-chunks'):
            index = record.get('index')
            require(integer(index), 'assistant stream block index must be a nonnegative integer')
            parts = record.get('args') if kind == 'tool-call-chunks' else record.get('texts')
            require(isinstance(parts, list) and all(isinstance(part, str) for part in parts),
                    'assistant stream deltas must be strings')
            require(isinstance(record.get('dt'), list) and len(record['dt']) == max(0, len(parts) - 1),
                    'assistant stream delta timing length is invalid')
            block_type = {'text-chunks': 'text', 'reasoning-chunks': 'reasoning',
                          'tool-call-chunks': 'tool-call'}[kind]
            key = (index, block_type)
            if key not in accumulated:
                accumulated[key] = dict(type=block_type, text='', _position=position)
                order.append(key)
            block = accumulated[key]
            block['text'] += ''.join(parts)
            if block_type == 'tool-call':
                block.update(id=record.get('id'), name=record.get('name'),
                             arguments=block['text'])
        elif kind == 'chunk' and isinstance(record.get('chunk'), dict):
            chunk = record['chunk']
            if chunk.get('type') == 'block-end' and isinstance(chunk.get('block'), dict):
                block = dict(chunk['block'], _position=position)
                key = (chunk.get('index'), block.get('type'))
                if key not in accumulated:
                    order.append(key)
                else:
                    block['_position'] = accumulated[key]['_position']
                accumulated[key] = block
    return [accumulated[key] for key in order]


def extract_rows(rows):
    """Project readable evidence while retaining every original event in source."""
    events, total, calls = [], None, {}
    route = {}
    for row in rows:
        kind, data = row['type'], row['data']
        common = dict(record_type=kind, source_session_id=row['_source_session_id'],
                      source_line=row.get('_source_line'), source_index=row.get('_source_index'),
                      source_pointer=row.get('_source_pointer'), source_seq=row.get('seq'),
                      source_time=row.get('time'),
                      timestamp=iso_time(row['time']) if 'time' in row else iso_time(data['header']['createdAt']),
                      inherited=('seq' in row and row['seq'] < row['_source_inherited_count']))
        for field in ('surfaceOp', 'sourceEventSeqs', 'ignorable'):
            if field in row:
                common[field] = row[field]
        for field in ('turn', 'step'):
            if isinstance(data, dict) and field in data:
                common[field] = data[field]

        def add(category, text, pointer=None, **extra):
            event = dict(kind=category, text=text, tool=None, error=False, tokens_in=total)
            event.update(common)
            event.update(extra)
            if pointer and row.get('_source_pointer'):
                event['source_pointer'] = row['_source_pointer'] + pointer
            events.append(event)

        if not isinstance(data, dict):
            add('status', compact(plain(row)))
            continue
        if kind == 'session/header':
            add('status', compact(data), source_header=data['header'],
                inherited_event_count=row['_source_inherited_count'])
            continue
        if kind in ('request/header', 'request/context'):
            context = data.get('header', data)
            config = context.get('config', context) if isinstance(context, dict) else {}
            for name in ('provider', 'model'):
                if isinstance(config.get(name), str):
                    route[name] = config[name]
            add('status', compact(plain(row)), **route)
            continue
        if kind == 'tool/call':
            require(isinstance(data.get('callId'), str) and isinstance(data.get('name'), str)
                    and isinstance(data.get('arguments'), str), 'invalid tool/call payload')
            calls[data['callId']] = data['name']
            add('call', data['arguments'], '/data/arguments', tool=data['name'], call_id=data['callId'])
            continue

        is_attempt = kind == 'assistant/attempt'
        is_assistant = kind == 'assistant/message' or is_attempt
        if is_assistant:
            stream = data.get('stream')
            require(isinstance(stream, list) and all(isinstance(item, dict) for item in stream),
                    'assistant event must contain its compact stream')
            usage = data.get('usage') if isinstance(data.get('usage'), dict) else stream_usage(stream)
            fields = ('inputTokens', 'cacheReadTokens', 'cacheWriteTokens')
            present = [usage[field] for field in fields if integer(usage.get(field))]
            if present:
                total = (total or 0) + sum(present)
            common.update(attempt=is_attempt, interrupted=bool(data.get('interrupted')),
                          usage=usage or None, **route)
            finishes = [record['chunk']['reason'] for record in stream
                        if record.get('type') == 'chunk' and isinstance(record.get('chunk'), dict)
                        and record['chunk'].get('type') == 'finish' and isinstance(record['chunk'].get('reason'), dict)]
            if finishes:
                common['finish_reason'] = finishes[-1]
                common['interrupted'] = common['interrupted'] or finishes[-1].get('kind') == 'aborted'
            if is_attempt:
                # Keep failed/cancelled attempt identity and terminal reason even
                # when it produced no text. A streamed tool request is not a call.
                add('status', compact(plain(row)),
                    error=bool(finishes and finishes[-1].get('kind') == 'error'))
                for block in stream_blocks(stream):
                    if block.get('type') in ('reasoning', 'text'):
                        add('thinking' if block['type'] == 'reasoning' else 'note',
                            block.get('text', ''), '/data/stream/' + str(block['_position']),
                            stream_block=True)
                continue

        if kind in ('user/message', 'developer/message', 'system/message', 'assistant/message', 'tool/result'):
            message = data if kind == 'user/message' else data.get('message')
            require(isinstance(message, dict) and isinstance(message.get('content'), list),
                    'invalid ' + kind + ' message')
            role = kind.split('/')[0] if kind != 'tool/result' else 'tool'
            source = message.get('source')
            require(isinstance(source, dict), kind + ' message source must be an object')
            common.update(role=role, event_id=message.get('id'), message_source=source)
            if role == 'assistant':
                for field in ('model', 'provider'):
                    require(isinstance(source.get(field), str), 'assistant source is missing ' + field)
                    common[field] = source[field]
            base = '/data/content' if kind == 'user/message' else '/data/message/content'
            call_id = (message.get('toolCallId') or source.get('callId')) if role == 'tool' else None
            if role == 'tool':
                require(isinstance(call_id, str), 'tool/result is missing its call ID')
                if message.get('toolCallId') and source.get('callId'):
                    require(message['toolCallId'] == source['callId'], 'tool/result call IDs disagree')
                common.update(call_id=call_id, tool=calls.get(call_id),
                              error=bool(message.get('isError')), tool_error=data.get('error'),
                              tool_meta=data.get('meta'))
            before = len(events)
            for index, block in enumerate(message['content']):
                require(isinstance(block, dict), 'message content block must be an object')
                category = 'result' if role == 'tool' else 'note' if role == 'assistant' else (
                    'user' if role == 'user' and source.get('kind') == 'user' else 'status')
                block_kind = block.get('type')
                if block_kind in ('text', 'reasoning'):
                    require(isinstance(block.get('text'), str), 'text/reasoning block must contain text')
                    add('thinking' if block_kind == 'reasoning' else category, block['text'],
                        base + '/' + str(index), block=index)
                else:
                    # The durable tool/call is the invocation authority. Keeping
                    # the assistant block as status avoids counting it twice.
                    add(category if role == 'tool' else 'status', compact(block),
                        base + '/' + str(index), block=index, block_type=block_kind)
            if is_assistant and not any(block.get('type') == 'reasoning' for block in message['content']):
                for block in stream_blocks(data['stream']):
                    if block.get('type') == 'reasoning':
                        add('thinking', block.get('text', ''), '/data/stream/' + str(block['_position']),
                            stream_block=True)
            if len(events) == before:
                add('status', compact(plain(row)))
        else:
            # Plugin-defined events, retries, boundaries, compaction and future
            # records remain visible; none changes the exported event history.
            add('status', compact(plain(row)))
    return events, total
