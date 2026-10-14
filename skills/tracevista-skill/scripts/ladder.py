#!/usr/bin/env python3
"""Validate the optional reading layer: zoom ladders, epistemic moves, informs links and the journey.

The ladder follows ThoughtDAG's summary ladder (src/lib/ladder.ts): topic ⊂ takeaway ⊂ brief
are written, the abstract is quoted verbatim from cited raw events. Budgets are soft targets
for the writer and hard limits (with a small margin) here, so plaques stay legible at zoom.
"""
import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

MOVES = ('insight', 'ruleout', 'decision', 'pivot', 'open')
BUDGET = {'zh': {'topic': 6, 'takeaway': 28, 'brief': 80, 'journey': 260},
          'en': {'topic': 3, 'takeaway': 14, 'brief': 40, 'journey': 110}}
MARGIN = 1.15
MAX_QUOTES = 3
MAX_QUOTE = {'zh': 160, 'en': 320}
CJK = re.compile(r'[぀-ヿ㐀-鿿]')
LATIN = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.+/-]*')


def size(text, lang):
    """CJK characters plus Latin words (a mixed 'CUDA Graph 缓存' is 2 + 2)."""
    if lang == 'zh':
        return len(CJK.findall(text)) + len(LATIN.findall(text))
    return len(LATIN.findall(text))


def squash(text):
    return re.sub(r'\s+', ' ', text or '').strip()


def compact(text):
    return re.sub(r'[\s　]+', '', text or '')


def language(graph):
    if graph.get('language') in BUDGET:
        return graph['language']
    sample = ' '.join(s.get('title', '') for s in graph.get('states', []))
    return 'zh' if CJK.search(sample) else 'en'


def scopes(graph):
    """Which raw events each entity may quote: its own and those of what it contains."""
    out = {}
    for a in graph.get('actions', []):
        out[a['id']] = set(a['events'])
    for b in graph.get('branches', []):
        out[b['id']] = set(b['events']).union(*(out[a['id']] for a in graph['actions'] if a['branch'] == b['id']))
    for s in graph.get('states', []):
        out[s['id']] = set(s['events']).union(*(out[a['id']] for a in graph['actions'] if a['state'] == s['id']))
    return out


def validate_reading_layer(graph, index):
    """Raise ValueError on the first problem; files without the layer pass unchanged."""
    lang = language(graph)
    b = BUDGET[lang]
    limit = lambda n: math.floor(n * MARGIN + 0.5)
    allowed = scopes(graph)
    for item in [*graph.get('states', []), *graph.get('branches', []), *graph.get('actions', [])]:
        key = item['id']
        move = item.get('move')
        if move is not None and move not in MOVES:
            raise ValueError(f'{key}: move must be one of {", ".join(MOVES)}')
        ladder = item.get('ladder')
        if ladder is None:
            continue
        if not isinstance(ladder, dict):
            raise ValueError(f'{key}: ladder must be an object')
        for field in ('topic', 'takeaway'):
            if not isinstance(ladder.get(field), str) or not ladder[field].strip():
                raise ValueError(f'{key}: ladder.{field} is required')
        reason = ladder.get('reason', '')
        if not isinstance(reason, str):
            raise ValueError(f'{key}: ladder.reason must be text')
        if compact(ladder['topic']) not in compact(ladder['takeaway']):
            raise ValueError(f'{key}: the topic must be copied verbatim from inside the takeaway')
        for field, text in (('topic', ladder['topic']), ('takeaway', ladder['takeaway']),
                            ('brief', ladder['takeaway'] + reason)):
            if size(text, lang) > limit(b[field]):
                raise ValueError(f'{key}: ladder {field} has {size(text, lang)} units, budget {b[field]}')
        quotes = ladder.get('abstract', [])
        if not isinstance(quotes, list) or len(quotes) > MAX_QUOTES:
            raise ValueError(f'{key}: ladder.abstract is a list of at most {MAX_QUOTES} quotes')
        for q in quotes:
            event, quote = (q or {}).get('event'), squash((q or {}).get('quote'))
            if event not in index:
                raise ValueError(f'{key}: abstract cites unknown event {event}')
            if event not in allowed[key]:
                raise ValueError(f'{key}: abstract quotes {event}, which is outside its own evidence')
            if index[event].get('kind') == 'thinking':
                raise ValueError(f'{key}: quote what the agent said or observed, not its thinking ({event})')
            if not quote or len(quote) > MAX_QUOTE[lang]:
                raise ValueError(f'{key}: each abstract quote needs 1-{MAX_QUOTE[lang]} characters')
            if quote not in squash(index[event].get('text')):
                raise ValueError(f'{key}: abstract quote is not verbatim in {event}: {quote[:40]}')
    actions = {a['id']: a for a in graph.get('actions', [])}
    for link in graph.get('links', []):
        if link.get('kind') != 'informs':
            continue
        if link['source'] == link['target']:
            raise ValueError('informs needs two different actions')
        src, dst = actions[link['source']], actions[link['target']]
        if (src.get('t_min') is not None and dst.get('t_min') is not None and src['t_min'] > dst['t_min']):
            raise ValueError(f"informs {link['source']} -> {link['target']}: an observation cannot inform an earlier step")
    journey = graph.get('journey')
    if journey is not None:
        if not isinstance(journey, dict) or not isinstance(journey.get('text'), str) or not journey['text'].strip():
            raise ValueError('journey needs text')
        if size(journey['text'], lang) > limit(b['journey']):
            raise ValueError(f"journey has {size(journey['text'], lang)} units, budget {b['journey']}")
        cites = journey.get('cites', [])
        known = {e['id'] for e in [*graph['states'], *graph['branches'], *graph['actions']]}
        if not cites or any(c not in known for c in cites):
            raise ValueError('journey must cite the states, branches or actions it narrates')


def reading_quality(graph):
    """Structural coverage, not a claim that the analyst's interpretation is correct."""
    groups = {k: graph.get(k, []) for k in ('states', 'branches', 'actions')}
    items = [i for rows in groups.values() for i in rows]
    critical = {a['id'] for a in groups['actions'] if a.get('move')}
    critical.update(t['action'] for t in graph.get('transitions', []))
    informs = [l for l in graph.get('links', []) if l.get('kind') == 'informs']
    critical.update(e for l in informs for e in (l['source'], l['target']))
    required = [*groups['states'], *groups['branches'],
                *(a for a in groups['actions'] if a['id'] in critical)]
    def has_ladder(item):
        return all(isinstance((item.get('ladder') or {}).get(k), str) and item['ladder'][k].strip()
                   for k in ('topic', 'takeaway'))
    missing = [i['id'] for i in required if not has_ladder(i)]
    journey = graph.get('journey') or {}
    has_journey = bool(journey.get('text', '').strip() and journey.get('cites'))
    destinations = {l['target'] for l in informs}
    return {
        'ready': bool(groups['states']) and not missing and has_journey,
        'coverage': {k: {'total': len(rows), 'annotated': sum(has_ladder(i) for i in rows)}
                     for k, rows in groups.items()},
        'missing_ladders': missing,
        'missing_journey': not has_journey,
        'critical_actions': sorted(critical),
        'missing_reasons': [i['id'] for i in required if not (i.get('ladder') or {}).get('reason', '').strip()],
        'missing_quotes': [i['id'] for i in required if not (i.get('ladder') or {}).get('abstract')],
        'decisions_without_informs': [a['id'] for a in groups['actions']
            if a.get('move') in ('decision', 'pivot', 'ruleout') and a['id'] not in destinations],
        'moves': {m: sum(i.get('move') == m for i in items) for m in MOVES},
        'informs': len(informs),
        'interpretation_check': 'Coverage only. Inspect cited evidence and explain unresolved gaps; do not invent links or quotes.'
    }


def write_private_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Set permissions at creation, before any trajectory text is written.
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
        os.chmod(path, 0o600)
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main():
    parser = argparse.ArgumentParser(description='Check a reading-layer patch against a state graph.')
    parser.add_argument('graph', help='a .agent-state.json file')
    parser.add_argument('--patch', help='{"entities": {id: {summary, ladder, move}}, "links": [...], "journey": {...}}')
    parser.add_argument('--out', help='Save the validated graph, including the patch, to a new file')
    parser.add_argument('--quality-report', help='Write the structural coverage and gaps as JSON')
    parser.add_argument('--require-reading-layer', action='store_true', help='Fail if reader-ready coverage is incomplete')
    args = parser.parse_args()
    graph = json.loads(Path(args.graph).read_text())
    if args.patch:
        patch = json.loads(Path(args.patch).read_text())
        apply_patch(graph, patch)
    index = {e['id']: e for e in graph['timeline']['timeline']}
    try:
        validate_reading_layer(graph, index)
    except ValueError as e:
        print(f'FAIL: {e}')
        sys.exit(1)
    report = reading_quality(graph)
    if args.quality_report:
        write_private_json(args.quality_report, report)
    print(json.dumps(report, ensure_ascii=False))
    if args.require_reading_layer and not report['ready']:
        raise SystemExit('FAIL: incomplete reading layer; inspect missing_ladders and missing_journey')
    if args.out:
        write_private_json(args.out, graph)


def apply_patch(graph, patch):
    """Revise authored reading text and links without changing raw evidence or structure."""
    items = {i['id']: i for i in [*graph['states'], *graph['branches'], *graph['actions']]}
    for key, fields in patch.get('entities', {}).items():
        if key not in items:
            raise SystemExit(f'FAIL: unknown entity {key}')
        if 'summary' in fields and (not isinstance(fields['summary'], str) or not fields['summary'].strip()):
            raise SystemExit(f'FAIL: {key}: summary must be nonempty text')
        for field in ('summary', 'ladder', 'move'):
            if field in fields:
                items[key][field] = fields[field]
    actions = {a['id'] for a in graph['actions']}
    index = {e['id'] for e in graph['timeline']['timeline']}
    for link in patch.get('links', []):
        if link.get('kind') != 'informs' or link.get('source') not in actions or link.get('target') not in actions:
            raise SystemExit(f'FAIL: informs links connect two known actions: {link}')
        if not link.get('evidence') or not link.get('events') or any(e not in index for e in link['events']):
            raise SystemExit(f'FAIL: informs links need an explanation and known events: {link}')
        graph['links'].append(link)
    if 'journey' in patch:
        graph['journey'] = patch['journey']
    return graph


if __name__ == '__main__':
    main()
