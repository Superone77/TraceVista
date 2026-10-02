#!/usr/bin/env python3
"""Validate an existing self-contained trace without rewriting its raw evidence."""
import argparse
import json
import math
import os
from pathlib import Path

from build_state_graph import BEHAVIORS, compile_graph
from ladder import reading_quality

MAX_BYTES = 64 * 1024 * 1024


class TraceError(ValueError):
    """A fixed public error code; never expose source text in a diagnostic."""

    def __init__(self, code, stage=None):
        super().__init__(code)
        self.stage = stage


def _finite_int(value):
    number = int(value)
    try:
        finite = math.isfinite(number)
    except OverflowError:
        finite = False
    if not finite:
        raise TraceError('invalid-json')
    return number


def _finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise TraceError('invalid-json')
    return number


def _reject_constant(_value):
    raise TraceError('invalid-json')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise TraceError('invalid-json')
        result[key] = value
    return result


def validate_wire_graph(graph):
    """Check original-file fields that the compiler normalizes or does not inspect.

    Match the viewer's parseGraph import contract without changing any source data.
    The compiler below remains responsible for evidence and interpretation checks.
    """
    def require(condition):
        if not condition:
            raise TraceError('invalid-graph', 'import-format')

    def text(value):
        return isinstance(value, str)

    def number(value):
        return type(value) in (int, float) and math.isfinite(value)

    require(isinstance(graph, dict))
    require(graph.get('format') in ('coding-agent-state-trajectory', 'thoughtdag-state-trajectory'))
    require(type(graph.get('version')) is int and graph['version'] == 1)
    require(text(graph.get('title')) and graph['title'].strip())
    require(text(graph.get('scope')) and graph['scope'].strip())
    require(graph.get('subtitle') is None or text(graph['subtitle']))
    notes = graph.get('notes')
    require(notes is None or isinstance(notes, list) and all(text(note) for note in notes))
    for key in ('states', 'branches', 'actions', 'links', 'transitions'):
        require(isinstance(graph.get(key), list))
        require(all(isinstance(item, dict) for item in graph[key]))
    timeline = graph.get('timeline')
    require(isinstance(timeline, dict))
    require(isinstance(timeline.get('timeline'), list) and isinstance(timeline.get('sources'), list))
    events = timeline['timeline']
    require(all(isinstance(event, dict) and text(event.get('id')) for event in events))
    event_ids = {event['id'] for event in events}
    require(len(event_ids) == len(events))
    for event in events:
        for key in ('text', 'kind', 'model', 'actor', 'tool', 'skill'):
            require(event.get(key) is None or text(event[key]))

    def refs(value):
        return isinstance(value, list) and bool(value) and all(text(e) and e in event_ids for e in value)

    entities = [*graph['states'], *graph['branches'], *graph['actions']]
    for item in entities:
        require(text(item.get('id')) and bool(item['id']) and text(item.get('title')))
        require(item.get('summary') is None or text(item['summary']))
        # Range expansion is an authoring convenience, not a viewer import format.
        require(refs(item.get('events')))
    require(len({item['id'] for item in entities}) == len(entities))
    states = {state['id']: state for state in graph['states']}
    parents = {key: set() for key in states}
    for state in states.values():
        snapshot = state.get('snapshot')
        require(isinstance(snapshot, dict) and all(value is None or text(value) for value in snapshot.values()))
        lineage = state.get('lineage')
        if lineage is not None:
            require(isinstance(lineage, dict) and lineage.get('parent') in states)
            require(lineage.get('relation') in ('derived', 'restored', 'retained'))
            require(text(lineage.get('reason')) and lineage['reason'].strip() and refs(lineage.get('events')))
            parents[state['id']].add(lineage['parent'])
        assessment = state.get('assessment')
        if assessment is not None:
            require(isinstance(assessment, dict))
            require(number(assessment.get('value')) and number(assessment.get('tolerance')) and assessment['tolerance'] >= 0)
            require(assessment.get('previous') is None or number(assessment['previous']))
            previous_state = assessment.get('previousState')
            require(previous_state is None or text(previous_state) and
                    (previous_state == '' or previous_state in states))
            require(assessment.get('measurement') in ('measured', 'historical'))
    for action in graph['actions']:
        for key in ('actor', 'outcome', 'classification_reason', 'classification_basis'):
            require(action.get(key) is None or text(action[key]))
        secondary = action.get('secondary', [])
        require(isinstance(secondary, list) and all(value in BEHAVIORS for value in secondary))
    for link in graph['links']:
        require(refs(link.get('events')))
    for transition in graph['transitions']:
        start, end = transition.get('source'), transition.get('target')
        require(start in states and end in states)
        if states[end].get('lineage') is None:
            parents[end].add(start)
        require(isinstance(transition.get('changes'), list))
        for change in transition['changes']:
            require(isinstance(change, dict) and text(change.get('component')))
            component = change['component']
            require(component in states[start]['snapshot'] and component in states[end]['snapshot'])
            require('before' in change and 'after' in change and change['before'] != change['after'])
            require(refs(change.get('events')))
    # The viewer derives ancestry from transitions only when no explicit lineage
    # exists, so check that combined ancestry as well as the compiler's state DAG.
    pending = set(states)
    while pending:
        ready = {key for key in pending if not (parents[key] & pending)}
        require(bool(ready))
        pending -= ready


def load_trace(path):
    """Return original bytes, the parsed graph, and validation results."""
    try:
        with Path(path).open('rb') as source:
            raw = source.read(MAX_BYTES + 1)
    except OSError as exc:
        raise TraceError('unreadable-input') from exc
    if len(raw) > MAX_BYTES:
        raise TraceError('too-large')
    try:
        graph = json.loads(raw.decode('utf-8-sig'), parse_float=_finite_float, parse_int=_finite_int,
                           parse_constant=_reject_constant, object_pairs_hook=_unique_object)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise TraceError('invalid-json') from exc
    try:
        validate_wire_graph(graph)
        # compile_graph checks every evidence reference, state delta, branch/action,
        # observation, reading-layer quote and event's classified/excluded coverage.
        # It works on a deep copy; only the original bytes are ever exported.
        compiled = compile_graph(graph, graph['timeline'])
        report = reading_quality(compiled)
        counts = {key: len(compiled.get(key, []))
                  for key in ('states', 'branches', 'actions', 'transitions')}
        counts['events'] = len(compiled['timeline']['timeline'])
    except TraceError:
        raise
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, RecursionError) as exc:
        raise TraceError('invalid-graph', 'graph-structure') from exc
    return raw, graph, report, counts


def private_directory(path):
    """Give every newly created directory mode 700, including missing parents."""
    path = Path(path)
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o700)
    if not path.is_dir():
        raise TraceError('invalid-output')


def ensure_distinct(source, outputs):
    source = Path(source).resolve()
    for output in outputs:
        output = Path(output)
        if output.resolve() == source or (output.exists() and os.path.samefile(output, source)):
            raise TraceError('output-overwrites-input')


def write_private(path, payload):
    """Create a new private file; refuse overwrite and symlink destinations."""
    path = Path(path)
    private_directory(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(payload)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graph', help='A .agent-state.json file (up to 64 MiB of UTF-8 JSON)')
    parser.add_argument('--require-reading-layer', action='store_true')
    parser.add_argument('--quality-report', help='Create a new private JSON quality report')
    args = parser.parse_args()
    try:
        source = Path(args.graph).resolve()
        _raw, _graph, report, counts = load_trace(source)
        quality_path = Path(args.quality_report).resolve() if args.quality_report else None
        if quality_path:
            ensure_distinct(source, [quality_path])
            write_private(quality_path, json_bytes(report))
        result = {'valid': True, 'graph': str(source), 'counts': counts, 'reading': report,
                  'quality_report': str(quality_path) if quality_path else None}
        if args.require_reading_layer and not report['ready']:
            result.update(valid=False, error='incomplete-reading-layer')
        print(json.dumps(result, ensure_ascii=True, allow_nan=False))
        return 0 if result['valid'] else 1
    except TraceError as exc:
        print(json.dumps({'valid': False, 'error': str(exc), **({'stage': exc.stage} if exc.stage else {})}))
    except (OSError, ValueError):
        print(json.dumps({'valid': False, 'error': 'unwritable-output'}))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
