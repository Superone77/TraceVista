#!/usr/bin/env python3
"""Extract complete, source-linked timelines; supports one log or a task manifest."""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

BRIEF = {'user': 1500, 'note': 1500, 'thinking': 1500, 'call': 350, 'result': 350, 'status': 350}
PART_CHARS = 50_000
TIMESTAMP_PREFIX = re.compile(
    r'^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\][ \t]?(.*)$')
SECRETS = [
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----', re.S), '[REDACTED PRIVATE KEY]'),
    (re.compile(r'\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}'), '[REDACTED KEY]'),
    (re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}'), '[REDACTED TOKEN]'),
    (re.compile(r'\bAKIA[0-9A-Z]{16}\b'), '[REDACTED AWS KEY]'),
    (re.compile(r'(?i)\b(bearer\s+)[A-Za-z0-9._\-]{20,}'), r'\1[REDACTED]'),
    (re.compile(r'''(?i)((?:api[_-]?key|token|secret|password|oauth[_a-z]*)["']?\s*[=:]\s*["']?)[^\s"',;]{12,}'''), r'\1[REDACTED]'),
    (re.compile(r'\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}'), '[REDACTED JWT]'),
]


def redact(text, exact=()):
    for secret in sorted(set(exact), key=len, reverse=True):
        if secret:
            text = text.replace(secret, '[REDACTED CREDENTIAL]')
    for pattern, replacement in SECRETS:
        text = pattern.sub(replacement, text)
    return text


def secret_values(path):
    """An explicitly supplied credential file is used only as a redaction list."""
    text = path.read_text()
    try:
        value = json.loads(text)
    except ValueError:
        return [line.split('=', 1)[1].strip().strip('\"\'') for line in text.splitlines()
                if '=' in line and not line.lstrip().startswith('#') and len(line.split('=', 1)[1].strip()) >= 8]
    values = []
    def visit(v):
        if isinstance(v, str) and len(v) >= 8: values.append(v)
        elif isinstance(v, dict):
            for item in v.values(): visit(item)
        elif isinstance(v, list):
            for item in v: visit(item)
    visit(value)
    return values


def stamp(value):
    if value is None: return None
    if isinstance(value, (int, float)): return value / 1000 if value > 1e11 else float(value)
    try: return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except ValueError: return None


def text_of(content):
    if isinstance(content, str): return content
    if isinstance(content, list): return '\n'.join(filter(None, (text_of(c) for c in content)))
    if isinstance(content, dict):
        if isinstance(content.get('text'), str): return content['text']
        if 'content' in content: return text_of(content['content'])
        return json.dumps(content, ensure_ascii=False)
    return '' if content is None else str(content)


def compact(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def load_rows(text):
    try:
        whole = json.loads(text)
        if isinstance(whole, list):
            return [dict(row, _source_index=i) for i, row in enumerate(whole) if isinstance(row, dict)]
    except ValueError: pass
    rows = []
    for line, value in enumerate(text.splitlines(), 1):
        prefix = TIMESTAMP_PREFIX.match(value)
        wrapped_at = prefix[1] if prefix and stamp(prefix[1]) is not None else None
        body = prefix[2] if wrapped_at is not None else value
        try: row = json.loads(body)
        except ValueError: row = None
        if isinstance(row, dict):
            row = dict(row, _source_line=line)
            if wrapped_at is not None: row['_source_timestamp'] = wrapped_at
            rows.append(row)
        elif value.strip():
            # Only a recognized timestamp-wrapped Claude stream promotes these to
            # events. Plain text alone must not become a plausible agent trace.
            rows.append(dict(_source_line=line, _source_runner=body,
                             _source_timestamp=wrapped_at))
    return rows


def detect(rows):
    for row in (r for r in rows if '_source_runner' not in r):
        kind = row.get('type')
        if kind in ('session_meta', 'response_item', 'event_msg', 'turn_context'): return 'codex-rollout'
        if kind in ('thread.started', 'turn.started', 'item.completed', 'item.started', 'turn.completed'): return 'codex-exec'
        if kind in ('message_end', 'message_start', 'agent_settled', 'tool_execution_start'): return 'pi'
        if kind == 'message' and (row.get('message') or {}).get('api'): return 'pi'
        if kind in ('assistant', 'user') and isinstance(row.get('message'), dict): return 'claude-code'
    return 'unknown'


def extract(text, fmt=None):
    """Return events plus final usage; missing usage is None, never invented zero."""
    rows = load_rows(text); fmt = fmt or detect(rows)
    wrapped_records = any(row.get('_source_timestamp') is not None and '_source_runner' not in row for row in rows)
    if wrapped_records and fmt != 'claude-code':
        raise ValueError('Timestamp-prefixed logs require a recognized Claude Code stream')
    wrapped_claude = fmt == 'claude-code' and wrapped_records
    events, tokens, seen_usage, calls = [], None, {}, {}
    def add(row, kind, body, tool=None, error=False, **extra):
        e = dict(kind=kind, text=body, tool=tool, error=error, tokens_in=tokens,
                 timestamp=row.get('timestamp') if row.get('timestamp') is not None else row.get('_source_timestamp'),
                 source_line=row.get('_source_line'),
                 source_index=row.get('_source_index'), **extra)
        if row.get('_source_timestamp') is not None:
            e['source_timestamp'] = row['_source_timestamp']
        events.append(e)
        return e
    def add_usage(key, usage, fields):
        nonlocal tokens
        present = {f: usage[f] for f in fields if isinstance(usage.get(f), (int, float))}
        if not present: return
        prev = seen_usage.setdefault(key, {})
        delta = 0
        for field, value in present.items():
            value = max(prev.get(field, 0), value)
            delta += value - prev.get(field, 0); prev[field] = value
        tokens = (tokens or 0) + delta
    for ri, row in enumerate(rows):
        if '_source_runner' in row:
            if wrapped_claude:
                add(row, 'status', row['_source_runner'], record_type='runner')
            continue
        typ = row.get('type'); item = row.get('item') or {}; msg = row.get('message') or {}
        if fmt == 'claude-code':
            if typ in ('assistant', 'user'):
                if typ == 'assistant':
                    add_usage(msg.get('id') or ('row', ri), msg.get('usage') or {},
                              ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'))
                content = msg.get('content') or []
                if isinstance(content, str): content = [{'type':'text', 'text':content}]
                before = len(events)
                for bi, c in enumerate(content):
                    if not isinstance(c, dict):
                        add(row, 'status', compact(c), block=bi, role=typ)
                        continue
                    k = c.get('type'); common = dict(block=bi, role=typ, event_id=row.get('uuid'), model=msg.get('model'))
                    if k == 'text': add(row, 'note' if typ == 'assistant' else 'user', c.get('text',''), **common)
                    elif k == 'thinking': add(row, 'thinking', c.get('thinking',''), **common)
                    elif k == 'tool_use':
                        calls[c.get('id')] = c.get('name')
                        add(row, 'call', compact(c.get('input',{})), tool=c.get('name'), call_id=c.get('id'), **common)
                    elif k == 'tool_result':
                        add(row, 'result', text_of(c.get('content')), tool=calls.get(c.get('tool_use_id')),
                            error=bool(c.get('is_error')), call_id=c.get('tool_use_id'), **common)
                    else: add(row, 'status', compact(c), **common)
                if len(events) == before:
                    add(row, 'status', compact({k:v for k,v in row.items() if not k.startswith('_source')}))
            else:
                # Preserve rate limits, progress notifications and future native
                # records rather than silently omitting unrecognized types.
                add(row, 'status', compact({k:v for k,v in row.items() if not k.startswith('_source')}), error=bool(row.get('is_error')))
        elif fmt == 'codex-exec':
            if typ == 'turn.completed':
                usage = row.get('usage') or {}
                if 'input_tokens' in usage: tokens = (tokens or 0) + usage['input_tokens']
                add(row, 'status', compact({k:v for k,v in row.items() if not k.startswith('_source')}))
            elif typ in ('turn.failed', 'error'):
                add(row, 'status', compact(row), error=True)
            elif typ == 'item.started': calls[item.get('id')] = (row, item, tokens)
            elif typ == 'item.completed':
                calls.pop(item.get('id'), None); k = item.get('type'); common = dict(event_id=item.get('id'))
                if k in ('agent_message', 'reasoning'):
                    add(row, 'thinking' if k == 'reasoning' else 'note', item.get('text',''), **common)
                elif k == 'command_execution':
                    add(row, 'call', item.get('command',''), tool='shell', call_id=item.get('id'), **common)
                    add(row, 'result', item.get('aggregated_output',''), tool='shell', call_id=item.get('id'),
                        exit_code=item.get('exit_code'), error=item.get('exit_code') not in (0,None), **common)
                else: add(row, 'call', compact(item), tool=k, call_id=item.get('id'), **common)
        elif fmt == 'codex-rollout':
            p = row.get('payload') or {}; k = p.get('type')
            if typ == 'event_msg' and k == 'token_count':
                usage = (p.get('info') or {}).get('total_token_usage') or {}
                tokens = usage.get('input_tokens', tokens)
                add(row, 'status', compact(p))
            elif typ == 'response_item':
                if k == 'message' and p.get('role') in ('assistant','user'):
                    add(row, 'note' if p['role']=='assistant' else 'user', text_of(p.get('content')), role=p['role'])
                elif k == 'reasoning':
                    add(row, 'thinking', text_of(p.get('summary') or p.get('content')))
                elif k in ('function_call','custom_tool_call','local_shell_call'):
                    calls[p.get('call_id')] = p.get('name') or k
                    add(row, 'call', compact(p.get('arguments') or p.get('input') or p.get('action')),
                        tool=p.get('name') or k, call_id=p.get('call_id'))
                elif k in ('function_call_output','custom_tool_call_output'):
                    add(row, 'result', text_of(p.get('output')), tool=calls.get(p.get('call_id')), call_id=p.get('call_id'))
        elif fmt == 'pi' and typ in ('message_end','message'):
            role = msg.get('role'); timestamp = msg.get('timestamp') or row.get('timestamp')
            row = dict(row, timestamp=timestamp)
            if role == 'assistant': add_usage(msg.get('responseId') or ('row',ri), msg.get('usage') or {}, ('input','cacheRead','cacheWrite'))
            for bi,c in enumerate(msg.get('content') or []):
                if not isinstance(c,dict): continue
                if c.get('type') in ('text','thinking'):
                    kind = 'thinking' if c['type']=='thinking' else 'note' if role=='assistant' else 'result' if role=='toolResult' else 'user'
                    add(row,kind,c.get('text') or c.get('thinking',''),error=bool(msg.get('isError')),block=bi,call_id=msg.get('toolCallId'))
                elif c.get('type')=='toolCall': add(row,'call',compact(c.get('arguments',{})),tool=c.get('name'),call_id=c.get('id'),block=bi)
    if fmt == 'codex-exec':
        for row,item,start_tokens in calls.values():
            e=add(row,'call',compact(item),tool=item.get('type'),call_id=item.get('id'),unfinished=True)
            e['tokens_in']=start_tokens
        events.sort(key=lambda e: (e.get('source_line') or e.get('source_index') or 0))
    if fmt == 'unknown': raise ValueError('Unrecognised trajectory format; provide a native JSONL log')
    times = [stamp(e['timestamp']) for e in events if stamp(e['timestamp']) is not None]
    start = min(times) if times else None
    for i,e in enumerate(events,1):
        now=stamp(e['timestamp']); e.update(id=f'E{i}', t_min=None if now is None or start is None else round((now-start)/60, 2))
    return events, tokens, fmt


def build_timeline(sessions, clean=redact, namespaced=False, links=()):
    timeline, sources, summaries = [], [], []
    ids = [s['id'] for s in sessions]
    if len(ids) != len(set(ids)): raise ValueError('Duplicate session IDs')
    for session in sessions:
        sid=session['id']
        if not re.fullmatch(r'[A-Za-z0-9_-]+',sid): raise ValueError('Session IDs must contain only letters, digits, underscores or hyphens')
        if session.get('actor','main') not in ('main','reviewer','system'): raise ValueError('actor must be main, reviewer or system')
        path=Path(session['path'])
        if session.get('format') == 'review-artifacts':
            if session.get('actor') != 'reviewer': raise ValueError('review-artifacts requires actor=reviewer')
            events,total,source_records=extract_review_artifacts(path)
            fmt='review-artifacts'
        else:
            raw=path.read_bytes(); text=raw.decode(errors='replace')
            events,total,fmt=extract(text)
            source_records=[{'name':path.name,'sha256_original':hashlib.sha256(raw).hexdigest(),'text':text}]
        for e in events:
            e['text']=clean(e['text']); e.update(session_id=sid, actor=session.get('actor','main'))
            if session.get('model'): e['model']=session['model']
            if namespaced: e['id']=sid+':'+e['id']
        timeline.extend(events)
        sources.extend(dict(record,session_id=sid,text=clean(record['text'])) for record in source_records)
        models={e['model'] for e in events if e.get('model')}
        summaries.append({'id':sid,'actor':session.get('actor','main'),'model':session.get('model') or (next(iter(models)) if len(models)==1 else None),'format':fmt,
                          'events':len(events),'tokens_in':total,'minutes':max((e['t_min'] for e in events if e['t_min'] is not None),default=None)})
    known={e['id'] for e in timeline}
    for link in links:
        if link.get('source') not in known or link.get('target') not in known: raise ValueError('Cross-session link references an unknown event')
        if link.get('kind') not in ('review_request','review_return'): raise ValueError('Link kind must be review_request or review_return')
        if not link.get('evidence'): raise ValueError('Cross-session links require an evidence description')
    totals=[s['tokens_in'] for s in summaries]
    return {'format':'multi-session' if namespaced else summaries[0]['format'], 'events':len(timeline),
            'sessions':summaries,'sources':sources,'links':list(links),'timeline':timeline,
            'tokens_in':sum(totals) if all(t is not None for t in totals) else None,
            'tokens_in_known':sum(t for t in totals if t is not None),'tokens_complete':all(t is not None for t in totals),
            'minutes':summaries[0]['minutes'] if len(summaries)==1 else None,
            'tool_calls':sum(e['kind']=='call' for e in timeline)}


def extract_review_artifacts(path):
    """Use recorded review artifacts without inventing an internal reviewer session."""
    names=('request.json','command.json','invocation.json','provider.stdout','provider.stderr','response.md','verdict.json')
    if not (path/'request.json').is_file(): raise ValueError('Review directory must contain request.json')
    sources=[];values={};events=[];total=None
    for name in names:
        p=path/name
        if not p.is_file(): continue
        raw=p.read_bytes(); text=raw.decode(errors='replace');values[name]=text
        sources.append({'name':name,'sha256_original':hashlib.sha256(raw).hexdigest(),'text':text})
    try: provider=json.loads(values.get('provider.stdout','{}'))
    except ValueError: provider={}
    if isinstance(provider,dict):
        usage=provider.get('usage') or {}
        fields=('input_tokens','cache_creation_input_tokens','cache_read_input_tokens')
        if any(isinstance(usage.get(k),(int,float)) for k in fields): total=sum(usage.get(k) or 0 for k in fields)
    try: invocation=json.loads(values.get('invocation.json','{}'))
    except ValueError: invocation={}
    model=invocation.get('model') if isinstance(invocation,dict) else None
    for name in names:
        if name not in values: continue
        kind='user' if name=='request.json' else 'call' if name=='command.json' else 'note' if name in ('response.md','verdict.json') else 'status'
        events.append({'id':f'E{len(events)+1}','kind':kind,'text':values[name],'tool':'review-provider' if kind=='call' else None,
                       'source_file':name,'t_min':None,'tokens_in':total,'error':False,'record_kind':'review-artifact','model':model})
    if 'verdict.json' not in values:
        events.append({'id':f'E{len(events)+1}','kind':'status','text':'NO_RESULT: no verdict.json was recorded; review completion is unknown.',
                       'tool':None,'t_min':None,'tokens_in':total,'error':False,'unfinished':True,'record_kind':'exporter-status'})
    return events,total,sources


def clean_metadata(value, clean):
    if isinstance(value, str): return clean(value)
    if isinstance(value, list): return [clean_metadata(v, clean) for v in value]
    if isinstance(value, dict): return {k:clean_metadata(v, clean) for k,v in value.items()}
    return value


def save(path, text):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    path.write_text(text);path.chmod(0o600)


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('trajectory',type=Path,nargs='?');p.add_argument('--manifest',type=Path)
    p.add_argument('--out',type=Path,required=True);p.add_argument('--no-redact',action='store_true')
    p.add_argument('--secret-file',type=Path,action='append',default=[])
    args=p.parse_args()
    if bool(args.trajectory)==bool(args.manifest): p.error('Use either trajectory or --manifest')
    if args.no_redact and args.secret_file: p.error('--no-redact cannot be combined with --secret-file')
    secrets=[v for path in args.secret_file for v in secret_values(path)]
    clean=(lambda s:s) if args.no_redact else lambda s:redact(s,secrets)
    try:
        if args.manifest:
            manifest=json.loads(args.manifest.read_text());sessions=manifest['sessions']
            for s in sessions: s['path']=str(args.manifest.parent/Path(s['path']))
            if not sessions: raise ValueError('Manifest has no sessions')
            result=build_timeline(sessions,clean,True,manifest.get('links',[]))
        else: result=build_timeline([{'id':'main','path':str(args.trajectory),'actor':'main'}],clean)
        # Scrub all metadata too, including manifest evidence and model names.
        result=clean_metadata(result,clean)
    except (ValueError,KeyError,OSError) as exc:
        print('Extraction failed: '+clean(str(exc)),file=sys.stderr);return 2
    result['redacted']=not args.no_redact
    args.out.mkdir(parents=True,exist_ok=True,mode=0o700);args.out.chmod(0o700)
    save(args.out/'timeline.json',json.dumps(result,ensure_ascii=False,indent=1))
    header=f"# Timeline\n\n{result['events']} events · {result['tool_calls']} tool calls · input tokens: {result['tokens_in']}\n\nTime is relative to each session; cross-session order is not inferred. Full text and complete source logs are retained in timeline.json.\n\n"
    parts=[];current=header
    for e in result['timeline']:
        brief=e['text'].replace('\n',' ⏎ ');limit=BRIEF[e['kind']]
        brief=brief[:limit]+('…' if len(brief)>limit else '')
        line=f"[{e['id']} · {e['actor']} · {e['t_min']} min · {e['tokens_in']} tokens] {e['kind'].upper()} {e.get('tool') or ''}: {brief}\n"
        if len(current)+len(line)>PART_CHARS: parts.append(current);current='# Timeline (continued)\n\n'
        current+=line
    parts.append(current)
    for i,part in enumerate(parts,1): save(args.out/('timeline.md' if i==1 else f'timeline-{i}.md'),part)
    print(json.dumps({k:v for k,v in result.items() if k not in ('sources','timeline','links')},ensure_ascii=False))
    return 0

if __name__=='__main__': sys.exit(main())
