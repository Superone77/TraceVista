"""Read a user-selected MiniMax Code messages.jsonl snapshot.

This module does no filesystem discovery or history reconstruction. The internal
MiniMax format is not a stable API; unknown records stay visible as evidence.
"""
import json
import math
from datetime import datetime, timezone

FORMAT = 'minimax-code'
INPUT_FIELDS = ('input', 'cacheRead', 'cacheWrite')


def plain(row):
    return {key: value for key, value in row.items() if not key.startswith('_source')}


def compact(value):
    return json.dumps(value, ensure_ascii=False)


def identifies(rows):
    """Require MiniMax's durable envelope, not just a chat-shaped message."""
    return any('type' not in row and isinstance(row.get('message'), dict)
               and isinstance(row['message'].get('role'), str)
               and isinstance(row.get('message_id'), str)
               and isinstance(row.get('turn_id'), str) for row in rows)


def native_id(value):
    return value if isinstance(value, str) and value else None


def token_count(value):
    if isinstance(value, int):
        return not isinstance(value, bool) and value >= 0
    return isinstance(value, float) and math.isfinite(value) and value >= 0 and int(value) == value


def timestamp(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        if not math.isfinite(value):
            return None
        return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (ValueError, OverflowError, OSError):
        return None


def utf16_offsets(text):
    """Map JS UTF-16 boundaries to Python indices; never split a surrogate pair."""
    offsets, units = {0: 0}, 0
    for index, char in enumerate(text, 1):
        units += 2 if ord(char) > 0xffff else 1
        offsets[units] = index
    return offsets, units


def prompt_range(message, text):
    if 'canonicalTextRange' not in message:
        return None, 'absent'
    value = message['canonicalTextRange']
    offsets, _ = utf16_offsets(text)
    if not isinstance(value, dict):
        return None, 'invalid'
    start, end = value.get('startOffset'), value.get('endOffset')
    if (not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int)
            or isinstance(end, bool) or start > end or start not in offsets or end not in offsets):
        return None, 'invalid'
    return (start, end), 'valid'


def inspect_rows(rows):
    """Keep every occurrence; account only unambiguous recorded input counters."""
    duplicates, first, versions, groups = {}, {}, {}, {}
    for index, row in enumerate(rows):
        fingerprint = json.dumps(plain(row), sort_keys=True, ensure_ascii=False)
        if fingerprint in first:
            duplicates[index] = first[fingerprint]
        else:
            first[fingerprint] = row['_source_line']
        mid = native_id(row.get('message_id'))
        if mid:
            versions.setdefault(mid, {}).setdefault(fingerprint, []).append(row['_source_line'])
        message = row.get('message')
        if not isinstance(message, dict) or message.get('role') != 'assistant':
            continue
        rid = native_id(message.get('responseId'))
        key = ('response', rid) if rid else ('message', mid) if mid else ('row', index)
        usage = message.get('usage')
        recorded = {name: usage[name] for name in INPUT_FIELDS if isinstance(usage, dict) and name in usage}
        groups.setdefault(key, []).append((index, mid, recorded))
    conflicts = {mid: sorted(line for lines in entries.values() for line in lines)
                 for mid, entries in versions.items() if len(entries) > 1}
    contributions, missing, usage_conflicts = {}, [], []
    for reports in groups.values():
        index, _, recorded = reports[0]
        lines = [rows[item[0]]['_source_line'] for item in reports]
        conflicting = (any(mid in conflicts for _, mid, _ in reports)
                       or any(value != recorded for _, _, value in reports))
        if conflicting:
            usage_conflicts.append(lines)
            contributions[index] = (0, False)
            continue
        absent = [name for name in INPUT_FIELDS if not token_count(recorded.get(name))]
        if absent:
            missing.append({'source_lines': lines, 'fields': absent})
        contributions[index] = (sum(int(value) for value in recorded.values() if token_count(value)), not absent)
    accounting = {
        'tokens_in_known': sum(value for value, _ in contributions.values()),
        'tokens_complete': bool(groups) and all(complete for _, complete in contributions.values()),
        'missing_input_fields': missing,
        'conflicting_usage_lines': usage_conflicts,
        'basis': 'recorded input + cacheRead + cacheWrite, once per responseId or message_id',
    }
    return duplicates, conflicts, contributions, accounting


def extract_rows(rows):
    for row in rows:
        if '_source_runner' in row:
            raise ValueError('MiniMax Code: malformed JSONL record at line '
                             + str(row.get('_source_line')) + '; capture a file containing complete JSON lines')
        if not isinstance(row.get('_source_line'), int):
            raise ValueError('MiniMax Code: select a raw messages.jsonl file; JSON arrays are unsupported')
    duplicates, conflicts, contributions, accounting = inspect_rows(rows)
    scope = {'kind': 'active-generation-snapshot', 'history_complete': False,
             'history_loaded': False, 'session_selection': 'explicit-input-file'}
    events = [dict(kind='status', record_type='snapshot/scope', record_kind='exporter-status',
                   text='MiniMax Code active-generation snapshot. Only the selected JSONL file was read; '
                        'earlier generations and other sessions were not loaded. This is not a complete-session claim.',
                   tool=None, error=False, tokens_in=None, timestamp=None,
                   source_line=None, source_index=None, source_pointer=None,
                   snapshot_scope=scope, usage_accounting=accounting,
                   message_id_conflicts=conflicts)]
    known, complete, have_usage, calls = 0, True, False, {}
    for index, row in enumerate(rows):
        if index in contributions:
            value, valid = contributions[index]
            known += value
            complete = complete and valid
            have_usage = True
        total = known if complete and have_usage else None
        raw_message = row.get('message')
        message = raw_message if isinstance(raw_message, dict) else {}
        role = message.get('role')
        common = dict(record_type=role if isinstance(role, str) else 'unknown', role=role,
                      source_line=row['_source_line'], source_index=None, source_pointer='',
                      event_id=row.get('message_id'), message_id=row.get('message_id'),
                      turn_id=row.get('turn_id'), response_id=message.get('responseId'),
                      timestamp=timestamp(message.get('timestamp')), source_time=message.get('timestamp'))
        for name in ('model', 'provider', 'api'):
            if name in message:
                common[name if isinstance(message[name], str) else 'native_' + name] = message[name]
        for name in ('usage', 'canonicalTextRange'):
            if name in message:
                common[name] = message[name]
        if 'stopReason' in message:
            common['stop_reason'] = message['stopReason']
        if 'history_artifact' in row:
            common['history_artifact'] = row['history_artifact']
        mid = native_id(row.get('message_id'))
        if mid in conflicts:
            common['message_id_conflict_lines'] = conflicts[mid]

        def add(kind, text, pointer='', **extra):
            event = dict(common, kind=kind, text=text, tool=None,
                         error=message.get('isError') is True or message.get('stopReason') == 'error',
                         tokens_in=total, tokens_in_known=known)
            event.update(source_pointer=pointer, **extra)
            events.append(event)

        if index in duplicates:
            add('status', compact(plain(row)), record_type='duplicate', duplicate_of_line=duplicates[index])
            continue
        if role not in ('user', 'assistant', 'toolResult'):
            # Includes compactionSummary: metadata and the summary remain intact,
            # without pretending that its missing pre-compaction history was read.
            add('status', compact(plain(row)))
            continue
        content = message.get('content')
        if isinstance(content, str):
            blocks = [({'type': 'text', 'text': content}, '/message/content')]
        elif isinstance(content, list):
            blocks = [(block, '/message/content/' + str(position)) for position, block in enumerate(content)]
        elif isinstance(message.get('text'), str):
            blocks = [({'type': 'text', 'text': message['text']}, '/message/text')]
        else:
            blocks = []
        if role == 'toolResult':
            call_id = native_id(message.get('toolCallId'))
            names = calls.get(call_id, set())
            common.update(call_id=call_id, tool_name=message.get('toolName'),
                          tool=message.get('toolName') or (next(iter(names)) if len(names) == 1 else None))
            if 'details' in message:
                common['tool_details'] = message['details']
        text_blocks = [block['text'] for block, _ in blocks if isinstance(block, dict)
                       and block.get('type') == 'text' and isinstance(block.get('text'), str)]
        canonical, range_state = prompt_range(message, '\n'.join(text_blocks))
        text_offset, texts_seen, before = 0, 0, len(events)
        for position, (block, pointer) in enumerate(blocks):
            if not isinstance(block, dict):
                add('status', compact(block), pointer, block=position)
                continue
            kind = block.get('type')
            extra = dict(block=position, block_type=kind)
            if kind == 'text' and isinstance(block.get('text'), str):
                text = block['text']
                category = 'note' if role == 'assistant' else 'result' if role == 'toolResult' else 'user'
                if role != 'user' or range_state == 'absent':
                    if role == 'user':
                        extra['prompt_attribution'] = 'native-user-role'
                    add(category, text, pointer, **extra, tool=common.get('tool'))
                    continue
                offsets, length = utf16_offsets(text)
                text_offset += 1 if texts_seen else 0
                texts_seen += 1
                start, end = canonical or (0, 0)
                boundaries = sorted({0, length, max(0, min(length, start - text_offset)),
                                     max(0, min(length, end - text_offset))})
                for left, right in zip(boundaries, boundaries[1:]):
                    is_prompt = range_state == 'valid' and start <= text_offset + left < end
                    add('user' if is_prompt else 'status', text[offsets[left]:offsets[right]], pointer,
                        **extra, canonical_range_status=range_state,
                        text_range_utf16=[text_offset + left, text_offset + right],
                        prompt_attribution=('unresolved' if range_state == 'invalid' else
                                            'canonical-range' if is_prompt else 'outside-canonical-range'))
                if not text:
                    add('status', '', pointer, **extra, canonical_range_status=range_state)
                text_offset += length
            elif role == 'assistant' and kind == 'thinking' and isinstance(block.get('thinking'), str):
                add('thinking', block['thinking'], pointer, **extra)
            elif role == 'assistant' and kind == 'toolCall':
                call_id, name = native_id(block.get('id')), native_id(block.get('name'))
                if call_id and name:
                    calls.setdefault(call_id, set()).add(name)
                arguments = block.get('arguments')
                add('call', arguments if isinstance(arguments, str) else compact(arguments), pointer,
                    **extra, tool=name, call_id=call_id)
            else:
                add('result' if role == 'toolResult' else 'status', compact(block), pointer,
                    **extra, tool=common.get('tool'))
        if len(events) == before:
            add('status', compact(plain(row)), tool=common.get('tool'))
    return events, accounting['tokens_in_known'] if accounting['tokens_complete'] else None
