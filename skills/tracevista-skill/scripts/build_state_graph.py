#!/usr/bin/env python3
"""Compile an evidence-backed state/action graph and a compatible canvas backup."""
import argparse
import copy
import json
import math
from pathlib import Path

from observations import validate_observations
from build_canvas import expand, edge, base_data
from ladder import validate_reading_layer, reading_quality, write_private_json

BEHAVIORS = ('Explore', 'Plan', 'Edit', 'Execute', 'Verify', 'Diagnose')
LINK_KINDS = ('sequence', 'informs', 'review_request', 'review_return')


def validate_state_assessment(state, states):
    """Reject measurements the viewer cannot render, before emitting a file."""
    assessment = state.get('assessment')
    if assessment is None:
        return
    prefix = str(state['id']) + ': '
    if not isinstance(assessment, dict):
        raise ValueError(prefix + 'assessment must be an object')
    if 'comparisonValue' in assessment or 'comparisonState' in assessment:
        raise ValueError(prefix + 'assessment comparison fields must use previous and previousState')
    def finite(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if not finite(assessment.get('value')) or not finite(assessment.get('tolerance')) or assessment['tolerance'] < 0:
        raise ValueError(prefix + 'assessment needs finite value and nonnegative tolerance')
    if assessment.get('previous') is not None and not finite(assessment['previous']):
        raise ValueError(prefix + 'assessment previous must be a finite number')
    previous_state = assessment.get('previousState')
    if previous_state is not None and (not isinstance(previous_state, str) or previous_state and previous_state not in states):
        raise ValueError(prefix + 'assessment previousState must name a known state')
    if 'correctness' in assessment and not isinstance(assessment['correctness'], bool):
        raise ValueError(prefix + 'assessment correctness must be boolean or omitted when unknown')
    if assessment.get('measurement') not in ('measured', 'historical'):
        raise ValueError(prefix + 'assessment measurement must be measured or historical')


def compile_graph(analysis, timeline):
    """Interpretations are supplied by the analyst, never guessed from exit code alone."""
    graph = copy.deepcopy(analysis)
    notes = graph.get('notes')
    if isinstance(notes, str):
        graph['notes'] = [notes]
    elif notes is not None and (not isinstance(notes, list) or
                               not all(isinstance(note, str) for note in notes)):
        raise ValueError('notes must be an array of strings or a single note string')
    index = {e['id']: e for e in timeline['timeline']}
    if len(index) != len(timeline['timeline']):
        raise ValueError('Duplicate evidence IDs')
    seen = set()
    collections = {}
    for name in ('states', 'branches', 'actions'):
        items = graph.get(name, [])
        if not items:
            raise ValueError(f'Missing {name}')
        collections[name] = {}
        for item in items:
            key = item.get('id')
            if not key or key in seen:
                raise ValueError(f'Missing or duplicate ID: {key}')
            seen.add(key)
            collections[name][key] = item
            if not item.get('title') or not item.get('events'):
                raise ValueError(f'{key}: title and evidence are required')
            item['events'] = [e['id'] for e in expand(item['events'], index)]
    states, branches, actions = (collections[n] for n in ('states', 'branches', 'actions'))
    if not graph.get('scope'):
        raise ValueError('State scope must be explicit')
    for state in states.values():
        if not state.get('snapshot'):
            raise ValueError(f"{state['id']}: missing tracked snapshot")
        validate_state_assessment(state, states)
    for branch in branches.values():
        if branch.get('state') not in states:
            raise ValueError(f"{branch['id']}: unknown state")
        if branch.get('status') not in ('attempted', 'retained', 'proposed', 'rejected'):
            raise ValueError(f"{branch['id']}: unknown branch status")
    for action in actions.values():
        aid = action['id']
        branch = branches.get(action.get('branch'))
        if not branch or action.get('state') != branch['state']:
            raise ValueError(f'{aid}: branch/state mismatch')
        if action.get('behavior') not in BEHAVIORS:
            raise ValueError(f'{aid}: unknown behavior')
        if any(b not in BEHAVIORS for b in action.get('secondary', [])):
            raise ValueError(f'{aid}: unknown secondary behavior')
        if not isinstance(action.get('actor'), str) or not action['actor'].strip():
            raise ValueError(f'{aid}: unknown actor')
        if not action.get('classification_reason'):
            raise ValueError(f'{aid}: explain the interpretation')
        action['classification_basis'] = 'analyst'
        action['t_min'] = next((index[e].get('t_min') for e in action['events']
                                if index[e].get('t_min') is not None), None)
        if branch['status'] in ('proposed', 'rejected') and action.get('outcome') != 'proposed':
            raise ValueError(f'{aid}: an untried branch cannot have executed actions')
    for link in graph.get('links', []):
        if link.get('source') not in actions or link.get('target') not in actions:
            raise ValueError('Unknown cross-link endpoint')
        if link.get('kind') not in LINK_KINDS or not link.get('evidence'):
            raise ValueError('Cross-links need a kind and evidence explanation')
        link['events'] = [e['id'] for e in expand(link.get('events', []), index)]
        if not link['events']:
            raise ValueError('Cross-links need raw evidence')
    adjacency = {key: [] for key in states}
    incoming = {key: 0 for key in states}
    for transition in graph.get('transitions', []):
        start, end = transition.get('source'), transition.get('target')
        if start not in states or end not in states or start == end:
            raise ValueError('Invalid state transition endpoints')
        action = actions.get(transition.get('action'))
        if not action or action['state'] != start:
            raise ValueError('Transition action must belong to its source state')
        if action['behavior'] not in ('Edit', 'Execute') or action.get('outcome') != 'success':
            raise ValueError('Only successful Edit/Execute can create a state transition')
        if branches[action['branch']]['status'] in ('proposed', 'rejected'):
            raise ValueError('Untried alternatives cannot create states')
        changes = transition.get('changes', [])
        if not changes:
            raise ValueError('Successful command alone does not establish a state change')
        before, after = states[start]['snapshot'], states[end]['snapshot']
        changed = {k for k in before.keys() | after.keys() if before.get(k) != after.get(k)}
        if changed != {c.get('component') for c in changes}:
            raise ValueError('Every snapshot delta must be explained exactly')
        for change in changes:
            key = change['component']
            if change.get('before') != before.get(key) or change.get('after') != after.get(key):
                raise ValueError('Delta disagrees with snapshot')
            if not change.get('basis') or not change.get('events'):
                raise ValueError('State changes need evidence of their actual effect')
            change['events'] = [e['id'] for e in expand(change['events'], index)]
        adjacency[start].append(end)
        incoming[end] += 1
    queue = [key for key, n in incoming.items() if n == 0]
    order = []
    while queue:
        key = queue.pop(0)
        order.append(key)
        for nxt in adjacency[key]:
            incoming[nxt] -= 1
            if incoming[nxt] == 0:
                queue.append(nxt)
    if len(order) != len(states):
        raise ValueError('State graph contains a cycle; use distinct temporal occurrences')
    graph['states'] = [states[key] for key in order]
    covered = {eid for a in actions.values() for eid in a['events']}
    excluded = {}
    for item in graph.get('excluded', []):
        if not item.get('reason'):
            raise ValueError('Excluded records need a reason')
        for event in expand(item.get('events', []), index):
            excluded[event['id']] = item['reason']
    missing = set(index) - covered - excluded.keys()
    if missing:
        raise ValueError(f'Unaccounted records: {sorted(missing)[:12]}')
    if covered & excluded.keys():
        raise ValueError('An event cannot be both classified and excluded')
    graph.update(format='thoughtdag-state-trajectory', version=1, timeline=timeline)
    graph['coverage'] = {'raw_events': len(index), 'classified_events': len(covered),
                         'excluded_events': len(excluded), 'actions': len(actions),
                         'behaviors': {b: sum(a['behavior'] == b for a in actions.values()) for b in BEHAVIORS}}
    validate_observations(graph, seen, set(index))
    validate_reading_layer(graph, index)
    return graph


def as_canvas(graph):
    """Stock app shows the state overview; the local state view reads the extension."""
    nodes = []
    for i, state in enumerate(graph['states']):
        body = state.get('summary', '') + '\n\n' + '\n'.join(f'{k}: {v}' for k, v in state['snapshot'].items())
        data = base_data(state['title'], body)
        data.update(isCollapsed=False, stepKind='step', summary=state.get('summary', ''),
                    stateRef=state['id'])
        if i == 0:
            # A single copy of the complete graph and redacted source records.
            data['stateTrajectory'] = graph
        nodes.append(dict(id=state['id'], type='thought', position={'x': 100, 'y': i * 460}, data=data))
    edges = [edge(t['source'], t['target'], 'continue') for t in graph['transitions']]
    return dict(version=1, name=graph['title'], nodes=nodes, edges=edges)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('analysis')
    parser.add_argument('--timeline', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--format', choices=('state', 'canvas'), default='state',
                        help='state: standalone JSON for the local viewer; canvas: legacy ThoughtDAG backup')
    parser.add_argument('--require-reading-layer', action='store_true', help='Require reader-ready structural coverage')
    parser.add_argument('--quality-report', help='Write reading-layer coverage and unresolved gaps as JSON')
    args = parser.parse_args()
    graph = compile_graph(json.loads(Path(args.analysis).read_text()), json.loads(Path(args.timeline).read_text()))
    report = reading_quality(graph)
    if args.quality_report:
        write_private_json(args.quality_report, report)
    if args.require_reading_layer and not report['ready']:
        raise SystemExit('Incomplete reading layer: ' + json.dumps(report, ensure_ascii=False))
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.format == 'state':
        graph['format'] = 'coding-agent-state-trajectory'
        payload = graph
    else:
        payload = as_canvas(graph)
    write_private_json(output, payload)
    print(json.dumps({'events': graph['coverage'], 'reading': report}, ensure_ascii=False))


if __name__ == '__main__':
    main()
