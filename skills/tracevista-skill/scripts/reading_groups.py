"""Validate optional analyst-authored reading groups without changing evidence."""


def validate_reading_groups(graph, entity_ids, event_ids):
    groups = graph.get('readingGroups')
    if groups is None:
        return
    if not isinstance(groups, list) or not groups:
        raise ValueError('Reading groups must partition all states')
    state_ids = {s['id'] for s in graph['states']}
    group_ids, grouped = set(), set()
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError('Invalid reading group')
        if any(not isinstance(group.get(k), str) or not group[k].strip()
               for k in ('id', 'title', 'summary')):
            raise ValueError('Reading groups require IDs, titles and summaries')
        if group['id'] in entity_ids or group['id'] in group_ids:
            raise ValueError('Reading group IDs must be unique')
        group_ids.add(group['id'])
        events = group.get('events')
        if (type(group.get('defaultExpanded')) is not bool
                or not isinstance(events, list) or not events
                or any(not isinstance(e, str) or e not in event_ids for e in events)):
            raise ValueError('Reading groups require disclosure defaults and evidence')
        states = group.get('states')
        if not isinstance(states, list) or not states:
            raise ValueError('Reading groups must partition all states exactly once')
        for state in states:
            if not isinstance(state, str) or state not in state_ids or state in grouped:
                raise ValueError('Reading groups must partition all states exactly once')
            grouped.add(state)
    if grouped != state_ids:
        raise ValueError('Reading groups must partition all states exactly once')
