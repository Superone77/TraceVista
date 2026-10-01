"""Validate optional neutral observations. No task-specific inference is performed."""
import math

SPECS = {
    'exploration': {'level': ['work_step', 'hypothesis', 'trial'], 'disposition': ['proposed', 'running', 'retained', 'rejected', 'failed', 'stopped', 'unknown']},
    'skill': {'name': None, 'load_method': ['native_call', 'guide_output', 'source_read'], 'version': None},
    'review': {'stage': ['request', 'feedback', 'revision', 'recheck'], 'outcome': ['requested', 'pass', 'revise', 'blocked', 'unknown'], 'code_change': ['changed', 'unchanged', 'unknown']},
    'knowledge': {'operation': ['write', 'read'], 'resource': None},
    'task': {'operation': ['add', 'reprioritize', 'complete', 'fail', 'stop'], 'task_key': None},
    'measurement': {'metric': None, 'value': None, 'unit': None, 'scope': ['development_score', 'independent_score', 'local_timing', 'end_to_end_timing', 'other'], 'protocol': None, 'baseline': None, 'direction': ['higher', 'lower', 'none'], 'measurement': ['measured', 'historical']},
    'status': {'category': ['review', 'correctness', 'performance', 'submission'], 'outcome': ['pass', 'fail', 'improved', 'regressed', 'completed', 'blocked', 'unknown'], 'scope': None},
}
RELATIONS = ('contains', 'alternative', 'follows', 'requests', 'responds', 'addresses', 'rechecks', 'reads_from', 'updates', 'compares')
OUTCOMES = {'review': ('pass', 'fail', 'blocked', 'unknown'), 'correctness': ('pass', 'fail', 'unknown'), 'performance': ('improved', 'regressed', 'unknown'), 'submission': ('completed', 'blocked', 'unknown')}


def validate_observations(graph, entity_ids, event_ids):
    if 'observations' not in graph and 'observationLinks' not in graph:
        return
    records, links = graph.get('observations'), graph.get('observationLinks', [])
    if not isinstance(records, list) or not isinstance(links, list):
        raise ValueError('Observations and links must be arrays')
    seen = set(entity_ids)
    def refs(value):
        return isinstance(value, list) and value and all(isinstance(e, str) and e in event_ids for e in value)
    for o in records:
        if not isinstance(o, dict) or not isinstance(o.get('id'), str) or not o['id'] or o['id'] in seen or o.get('kind') not in SPECS:
            raise ValueError('Invalid observation identity/kind')
        seen.add(o['id'])
        if not isinstance(o.get('title'), str) or not o['title'].strip() or not isinstance(o.get('summary'), str) or not refs(o.get('events')) or not isinstance(o.get('subjects'), list) or not o['subjects'] or any(s not in entity_ids for s in o['subjects']):
            raise ValueError('Observation needs title, summary, evidence and known subjects')
        facts = o.get('facts')
        if not isinstance(facts, dict) or any(v is not None and not isinstance(v, (str, int, float, bool)) or isinstance(v, float) and not math.isfinite(v) for v in facts.values()):
            raise ValueError('Observation facts must be finite primitives')
        for key, allowed in SPECS[o['kind']].items():
            value = facts.get(key)
            if key not in facts or allowed and value not in allowed or allowed is None and key not in ('value','version') and (not isinstance(value,str) or not value.strip()) or key == 'version' and value is not None and (not isinstance(value,str) or not value.strip()):
                raise ValueError(f"{o['id']}: invalid {key}")
        if o['kind'] == 'measurement' and (type(facts['value']) not in (int,float) or not math.isfinite(facts['value'])):
            raise ValueError('Measurement must be a finite number')
        if o['kind'] == 'review' and facts['code_change'] == 'unchanged' and (not isinstance(facts.get('before_code'),str) or not facts['before_code'] or facts['before_code'] != facts.get('after_code')):
            raise ValueError('Unchanged code requires equal code identities and evidence')
        if o['kind'] == 'task' and facts['operation'] in ('fail','stop') and (not isinstance(facts.get('reason'),str) or not facts['reason'].strip()):
            raise ValueError('Task failure/stopping requires a reason')
        if o['kind'] == 'status' and facts['outcome'] not in OUTCOMES[facts['category']]:
            raise ValueError('Outcome must match status category')
        if 'artifacts' in o and (not isinstance(o['artifacts'],list) or any(a not in {f['name'] for f in graph.get('artifacts',[])} for a in o['artifacts'])):
            raise ValueError('Unknown observation artifact')
    by_id = {o['id']:o for o in records}
    for link in links:
        if not isinstance(link,dict) or link.get('source') not in by_id or link.get('target') not in by_id or link['source'] == link['target'] or link.get('relation') not in RELATIONS or not isinstance(link.get('reason'),str) or not link['reason'].strip() or not refs(link.get('events')):
            raise ValueError('Invalid observation relation/evidence')
        if link['relation'] == 'contains' and any(by_id[link[e]]['kind'] != 'exploration' for e in ('source','target')):
            raise ValueError('Containment connects exploration records only')
        a,b = by_id[link['source']],by_id[link['target']]
        if link['relation'] == 'reads_from' and (a['kind'] != 'knowledge' or b['kind'] != 'knowledge' or a['facts']['operation'] != 'write' or b['facts']['operation'] != 'read' or a['facts']['resource'] != b['facts']['resource']):
            raise ValueError('Knowledge relations must connect a write/read of the same resource')
        if link['relation'] == 'updates' and (a['kind'] != 'task' or b['kind'] != 'task' or a['facts']['task_key'] != b['facts']['task_key']):
            raise ValueError('Task updates must reference the same task identity')
        stages = {'responds': (('request',),('feedback','recheck')), 'addresses': (('feedback',),('revision',)), 'rechecks': (('revision',),('feedback','recheck'))}.get(link['relation'])
        if stages and (a['kind'] != 'review' or b['kind'] != 'review' or a['facts']['stage'] not in stages[0] or b['facts']['stage'] not in stages[1]):
            raise ValueError('Review link has mismatched stages')
        if link['relation'] == 'requests' and (b['kind'] != 'review' or b['facts']['stage'] != 'request'):
            raise ValueError('Requests must point to a review request')
    for relation in ('contains','follows'):
        pending = set(by_id)
        while pending:
            ready = {key for key in pending if not any(l['relation'] == relation and l['target'] == key and l['source'] in pending for l in links)}
            if not ready:
                raise ValueError('Observation hierarchy/order cycle')
            pending -= ready
