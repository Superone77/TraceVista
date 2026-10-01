#!/usr/bin/env python3
"""Build a ThoughtDAG canvas (.thoughtdag.json) from a trajectory analysis.

    python3 build_canvas.py <analysis.json> --timeline <timeline.json> --out <name>.thoughtdag.json

analysis.json follows references/analysis-schema.md. The canvas uses ThoughtDAG's own vocabulary:

  - the main line runs down one column (purple "continue" wires, bottom -> top);
  - a fork leaves its parent through the right-hand "branch" handle (orange, animated) into a
    lane of its own; lanes are reused once the chain that held them has ended, so the canvas does
    not grow wider with every sweep;
  - observations become NOTES (canvas material) left of the step they led to, wired to it with a
    dashed reference: "saw X" -> "so did Y" reads directly off the canvas; several observations
    behind one step share one note;
  - every phase is a FRAME around the nodes drawn in its band, and every step carries a one-line
    takeaway, a short topic and an epistemic type (decision / pivot / ruleout / open), so zooming
    out shows phases and plaques instead of text;
  - each step gets the raw events it cites (from timeline.json) as a text attachment.

Exits 1 with a list of problems when the analysis does not fit the schema; prints warnings (for
example overlapping frames) without failing.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

KINDS = ("observation", "decision", "pivot", "action", "result", "dead_end", "open")
TYPE = {"decision": "decision", "pivot": "pivot", "dead_end": "ruleout", "open": "open"}
BADGE = {"observation": "观察", "decision": "决策", "pivot": "转向", "action": "行动", "result": "结果",
         "dead_end": "死路", "open": "未决"}
BADGE_EN = {"observation": "Observed", "decision": "Decision", "pivot": "Pivot", "action": "Action",
            "result": "Result", "dead_end": "Dead end", "open": "Open"}
COLORS = ("violet", "sky", "green", "amber", "rose", "gray")
ACCENT, WARM = "#6B5CE7", "#E08A3C"
LANE_W, ROW_H, NOTE_DX, NOTE_W, NODE_W, PHASE_GAP, PAD = 1180, 230, 560, 480, 520, 150, 40


def problems_of(analysis: dict, timeline=None) -> list:
    out = []
    if timeline is not None:
        event_ids = [e.get('id') for e in timeline.get('timeline', [])]
        if len(event_ids) != len(set(event_ids)): out.append('duplicate timeline event ids')
    phases = {p.get("id") for p in analysis.get("phases", [])}
    steps = analysis.get("steps", [])
    ids = [s.get("id") for s in steps]
    if not phases:
        out.append("no phases")
    if len(phases) != len(analysis.get('phases', [])):
        out.append('duplicate phase ids')
    if len(ids) != len(set(ids)):
        out.append("duplicate step ids")
    known = set(ids)
    for s in steps:
        sid = s.get("id")
        if s.get("kind") not in KINDS:
            out.append(f"{sid}: kind must be one of {', '.join(KINDS)}")
        if s.get("phase") not in phases:
            out.append(f"{sid}: unknown phase {s.get('phase')}")
        if not s.get("title"):
            out.append(f"{sid}: missing title")
        if not isinstance(sid, str) or sid == 'root' or sid.startswith(('frame-', 'note-', 'raw-')):
            out.append(f'{sid}: missing or reserved step id')
        if not s.get('events'):
            out.append(f'{sid}: missing evidence event references')
        if timeline is not None:
            try: expand(s.get('events'), {e['id']:e for e in timeline.get('timeline', [])})
            except ValueError as exc: out.append(f'{sid}: {exc}')
        if s.get('actor', 'main') not in ('main', 'reviewer', 'system'):
            out.append(f'{sid}: unknown actor')
        if s.get('category', 'agent') not in CATEGORY:
            out.append(f'{sid}: unknown category')
        if s.get("after") and s["after"] not in known:
            out.append(f"{sid}: after refers to unknown step {s['after']}")
        for ref in (s.get("informs") or []) + (s.get("refs") or []):
            if ref not in known:
                out.append(f"{sid}: refers to unknown step {ref}")
        if s.get("kind") == "observation" and s.get("branch"):
            out.append(f"{sid}: an observation cannot open a branch; branch from the decision it led to")
    by_id = {s.get("id"): s for s in steps}
    ranks = {p.get('id'):i for i,p in enumerate(analysis.get('phases', []))}
    order = {s.get('id'):(ranks.get(s.get('phase'), -1), s.get('t0') if s.get('t0') is not None else float('inf'), i)
             for i,s in enumerate(steps)}
    for s in steps:
        parent = by_id.get(s.get('after'))
        if parent:
            if parent.get('kind') == 'dead_end': out.append(f"{s['id']}: dead_end cannot have a continuation")
            if order[parent['id']] >= order[s['id']]: out.append(f"{s['id']}: parent must appear earlier in phase/time order")
            if parent.get('kind') == 'observation' and parent.get('informs'):
                out.append(f"{s['id']}: cannot continue from a source-only observation note")
        for target in s.get('informs') or []:
            t = by_id.get(target)
            if t and t.get('kind') == 'observation' and t.get('informs'):
                out.append(f"{s['id']}: observation target must be a card, not another source-only note")
    for s in steps:  # the structural parents must form a tree
        seen, cursor = set(), s
        while cursor and cursor.get("after"):
            if cursor["id"] in seen:
                out.append(f"{s['id']}: 'after' forms a cycle")
                break
            seen.add(cursor["id"])
            cursor = by_id.get(cursor["after"])
    return out


def expand(refs: list, index: dict) -> list:
    """'E3-E9' and 'E12' -> event dicts, in timeline order."""
    picked = []
    for ref in refs or []:
        match = re.fullmatch(r"(?:(?P<session>[A-Za-z0-9_-]+):)?E(?P<lo>\d+)(?:\s*[-–]\s*(?:(?P<end_session>[A-Za-z0-9_-]+):)?E?(?P<hi>\d+))?", str(ref).strip())
        if not match: raise ValueError(f'invalid event reference: {ref}')
        session = match['session']
        if match['end_session'] and match['end_session'] != session:
            raise ValueError(f'ranges cannot cross sessions: {ref}')
        lo, hi = int(match['lo']), int(match['hi'] or match['lo'])
        if hi < lo: raise ValueError(f'reversed event range: {ref}')
        if hi - lo + 1 > len(index): raise ValueError(f'event range exceeds timeline: {ref}')
        for number in range(lo, hi + 1):
            key = (session + ':' if session else '') + f'E{number}'
            if key not in index: raise ValueError(f'unknown event reference: {key}')
            picked.append(key)
    selected = set(picked)
    return [event for key,event in index.items() if key in selected]


def raw_attachment(att_id: str, name: str, events: list) -> dict:
    lines = []
    for e in events:
        at = "" if e.get("t_min") is None else f" · {e['t_min']:.2f} min"
        tokens = e.get('tokens_in')
        token_label = 'unknown tokens' if tokens is None else f'{tokens / 1e6:.2f}M tokens'
        head = f"[{e['id']}{at} · {e.get('actor', 'main')} · {token_label}]"
        label = {"user": "USER", "note": "AGENT", "call": f"CALL {e.get('tool') or ''}".strip(),
                 "result": "RESULT" + (" (error)" if e.get("error") else "")}.get(e["kind"], e["kind"].upper())
        lines.append(f"{head} {label}\n{e.get('text', '')}")
    content = "\n\n".join(lines)
    return {"id": att_id, "name": name, "type": "text/plain", "size": len(content.encode()), "content": content}


def base_data(question: str, response: str) -> dict:
    return {"question": question, "response": response, "responses": [response] if response else [],
            "responseIndex": 0 if response else -1, "isCollapsed": True, "isEditing": False,
            "isEditingResponse": False, "isLoading": False, "tokenCount": (len(question) + len(response)) // 4,
            "highlights": [], "highlightMode": "tag", "attachments": [], "excludedAttachmentIds": [],
            "includedAttachmentIds": [], "roleMode": "inherit", "isRoot": False, "isBranch": False,
            "autoRerun": False}


CATEGORY = {'agent': ('主 agent', '#2563eb'), 'tool': ('工具', '#d97706'),
            'review': ('Review', '#dc2626'), 'thinking': ('可见思考', '#9333ea'),
            'input': ('输入', '#059669'), 'status': ('状态', '#64748b')}


def decorate(node, actor='main', category='agent', provenance=None, zh=True):
    """Actor/event category is independent of epistemic summaryTypes."""
    label, color = CATEGORY[category]
    if not zh: label = category.title()
    d = node['data']
    d['question'] = f'[{actor} / {label}] ' + d['question']
    d['traceExport'] = dict(provenance or {}, actor=actor, category=category)
    if category == 'review' and d.get('stepKind') != 'note':
        d.update(stepKind='review', isEvaluator=True, evaluatorTrigger='manual')
    node['style'] = {'borderRadius': 14, 'boxShadow': f'0 0 0 3px {color}'}


def event_category(event):
    return {'call':'tool', 'result':'tool', 'thinking':'thinking', 'user':'input', 'status':'status'}.get(
        event['kind'], 'review' if event.get('actor') == 'reviewer' else 'agent')


def edge(source: str, target: str, style: str) -> dict:
    branch, ref = style == "branch", style == "ref"
    color = WARM if branch else ACCENT
    return {"id": f"e-{source}-{target}", "source": source, "target": target, "type": "smoothstep",
            "sourceHandle": "branch" if branch or ref else "continue", "targetHandle": "left" if branch or ref else "top",
            "animated": branch or ref,
            "style": {"stroke": color, "strokeWidth": 2, **({"strokeDasharray": "8 4"} if ref else {})},
            "markerEnd": {"type": "arrowclosed", "color": color, "width": 18, "height": 18},
            "data": {"isBranchFromSelection": True} if branch else {"isCrossLink": True} if ref else {}}


def topic_of(s: dict) -> str:
    """The short plaque label: the step's own topic, else its title cut at a word boundary."""
    if s.get("topic"):
        return s["topic"]
    title = s.get("title") or ""
    if len(title) <= 14 or not re.search(r"[A-Za-z]", title):
        return title[:14]
    cut = title[:24].rsplit(" ", 1)[0]
    return cut if len(cut) >= 6 else title[:24]


def when(s: dict) -> str:
    t0, t1 = s.get("t0"), s.get("t1")
    if t0 is None:
        return ""
    return f"{t0:.1f}′ " if t1 is None or abs(t1 - t0) < 0.05 else f"{t0:.1f}–{t1:.1f}′ "


def build(analysis: dict, timeline: dict, with_event_graph=False) -> tuple:
    errors = problems_of(analysis, timeline)
    if errors: raise ValueError('; '.join(errors))
    zh = str(analysis.get("language", "zh")).lower().startswith("zh")
    badge = BADGE if zh else BADGE_EN
    evidence_word, analyst_word = ("依据", "分析者注") if zh else ("Evidence", "Analyst's note")
    colon = "：" if zh else ": "
    index = {e["id"]: e for e in timeline.get("timeline", [])}
    phases = analysis["phases"]
    phase_rank = {p["id"]: i for i, p in enumerate(phases)}
    steps = [dict(s, _order=i) for i, s in enumerate(analysis["steps"])]
    by_id = {s["id"]: s for s in steps}
    observations = [s for s in steps if s["kind"] == "observation" and s.get("informs")]
    note_ids = {s["id"] for s in observations}
    line = [s for s in steps if s["id"] not in note_ids]  # everything drawn as a card on a lane
    line.sort(key=lambda s: (phase_rank[s["phase"]], s.get("t0") if s.get("t0") is not None else float("inf"), s["_order"]))

    nodes, edges, warnings = [], [], []
    root_id = "root"
    root = base_data(analysis.get("title") or "Trajectory", analysis.get("overview", ""))
    root.update({"isRoot": True, "summaries": [analysis.get("outcome") or analysis.get("title")],
                 "summaryTopics": [topic_of({"title": analysis.get("title") or ""})], "summaryTypes": [None]})
    complete = json.dumps(timeline, ensure_ascii=False, indent=1)
    root['attachments'] = [{'id':'complete-timeline', 'name':'complete-timeline.json', 'type':'text/plain',
                            'size':len(complete.encode()), 'content':complete}]
    root['excludedAttachmentIds'] = ['complete-timeline']
    nodes.append({"id": root_id, "type": "thought", "position": {"x": 0, "y": 0}, "dragHandle": ".drag-handle", "data": root})

    # rows: phase by phase, time order inside a phase (PHASE_GAP separates the phase frames)
    row_of, row = {root_id: 0}, 1
    for s in line:
        s["_parent"] = s.get("after") if s.get("after") in by_id and s.get("after") not in note_ids else root_id
        row_of[s["id"]] = row
        row += 1

    # lanes: the first non-branch child inherits its parent's lane (the line goes on down the column);
    # every other child opens a lane, reusing the leftmost lane whose previous chain has already ended
    kids = {}
    for s in line:
        kids.setdefault(s["_parent"], []).append(s["id"])
    heir = {parent: next((k for k in members if not by_id[k].get("branch")), None) for parent, members in kids.items()}

    def chain_end(node_id: str) -> int:
        end = row_of[node_id]
        while heir.get(node_id):
            node_id = heir[node_id]
            end = row_of[node_id]
        return end

    lane_of, busy = {root_id: 0}, {0: float("inf")}
    for s in line:
        parent = s["_parent"]
        if heir.get(parent) == s["id"]:
            lane_of[s["id"]] = lane_of[parent]
            continue
        lane = 1
        while busy.get(lane, -1) >= row_of[s["id"]] or lane == lane_of[parent]:
            lane += 1
        lane_of[s["id"]] = lane
        busy[lane] = chain_end(s["id"])

    def y_of(node_id: str) -> float:
        return row_of[node_id] * ROW_H + phase_rank[by_id[node_id]["phase"]] * PHASE_GAP

    band = {}  # the phase whose frame a node is drawn in
    for s in line:
        body = s.get("body") or ""
        if s.get("analyst"):
            body += f"\n\n> **{analyst_word}**{colon}{s['analyst']}"
        cited = expand(s.get("events"), index)
        if cited:
            body += f"\n\n*{evidence_word}{colon}{', '.join(s.get('events'))}*"
        data = base_data(f"{badge[s['kind']]} · {when(s)}{s['title']}", body)
        data.update({"isBranch": heir.get(s["_parent"]) != s["id"], "summaries": [s.get("takeaway") or s["title"]],
                     "summaryTopics": [topic_of(s)], "summaryTypes": [TYPE.get(s["kind"])]})
        if cited:
            data["attachments"] = [raw_attachment(f"{s['id']}-raw", f"{s['id']} raw events.txt", cited)]
        n = {"id": s["id"], "type": "thought", "dragHandle": ".drag-handle", "data": data,
             "position": {"x": lane_of[s["id"]] * LANE_W, "y": y_of(s["id"])}}
        decorate(n, s.get('actor','main'), s.get('category','review' if s.get('actor')=='reviewer' else 'agent'),
                 {'layer':'analysis','kind':s['kind'],'events':[e['id'] for e in cited]}, zh)
        nodes.append(n)
        band[s["id"]] = s["phase"]
        edges.append(edge(s["_parent"], s["id"], "continue" if heir.get(s["_parent"]) == s["id"] else "branch"))
        for ref in s.get("refs") or []:
            if ref in by_id and ref not in note_ids and ref != s['_parent']:
                edges.append(edge(ref, s["id"], "ref"))

    # observations: one note beside the first step they led to (observations behind the same step share
    # it), wired to every step each observation informed
    grouped = {}
    for s in observations:
        targets = [t for t in s["informs"] if t in row_of and t not in note_ids]
        if not targets:
            warnings.append(f"{s['id']}: informs no drawn step, left out")
            continue
        grouped.setdefault((min(targets, key=lambda t: row_of[t]), s['phase']), []).append((s, targets))
    for (first, _phase), group in grouped.items():
        note_id = "note-" + "-".join(s["id"] for s, _ in group)
        parts, cited = [], []
        for s, _ in group:
            text = f"**{badge['observation']}{colon}{s['title']}**" + (f" — {s['takeaway']}" if s.get("takeaway") else "")
            if s.get("body"):
                body = s["body"]
                text += "\n" + body
            if s.get('analyst'):
                text += f"\n\n> **{analyst_word}**{colon}{s['analyst']}"
            if s.get("events"):
                text += f"\n*{evidence_word}{colon}{', '.join(s['events'])}*"
            parts.append(text)
            cited += expand(s.get("events"), index)
        data = base_data("\n\n".join(parts), "")
        data.update({"stepKind": "note"})
        if cited:
            selected = {e['id'] for e in cited}
            unique = [e for e in index.values() if e['id'] in selected]
            data["attachments"] = [raw_attachment(f"{note_id}-raw", f"{note_id} raw events.txt", unique)]
        # a note stays in its observation's own phase frame: beside the step when that step is in the same
        # phase, otherwise at the last row of the observation's phase, wired down into the later step
        own = group[0][0]["phase"]
        anchor = first
        if by_id[first]["phase"] != own:
            same_phase = [s["id"] for s in line if s["phase"] == own]
            if same_phase:
                anchor = max(same_phase, key=lambda k: row_of[k])
        nodes.append({"id": note_id, "type": "thought", "dragHandle": ".drag-handle", "data": data, "width": NOTE_W,
                      "position": {"x": lane_of[first] * LANE_W - NOTE_DX, "y": y_of(anchor)}})
        actors = {s.get('actor','main') for s,_ in group}
        categories = {s.get('category','review' if s.get('actor')=='reviewer' else 'agent') for s,_ in group}
        decorate(nodes[-1], next(iter(actors)) if len(actors)==1 else 'mixed',
                 next(iter(categories)) if len(categories)==1 else 'status',
                 {'layer':'analysis','kind':'observation','events':[e['id'] for e in cited]}, zh)
        band[note_id] = by_id[anchor]["phase"]
        wired = set()
        for s, targets in group:
            for t in targets:
                if t not in wired:
                    edges.append(edge(note_id, t, "ref"))
                    wired.add(t)
        if len(group) > 3:
            warnings.append(f"{first}: {len(group)} observations share one note; consider merging some")

    # phases: one frame per phase around the nodes drawn in its band
    frames = []
    for i, p in enumerate(phases):
        members = [n for n in nodes if band.get(n["id"]) == p["id"]]
        if not members:
            warnings.append(f"phase {p['id']} has no card of its own (only observations), so it gets no frame; "
                            "move them into a neighbouring phase or give the phase a step")
            continue
        x0 = min(n["position"]["x"] for n in members) - PAD
        x1 = max(n["position"]["x"] + n.get("width", NODE_W) for n in members) + PAD
        y0 = min(n["position"]["y"] for n in members) - 70
        y1 = max(n["position"]["y"] for n in members) + ROW_H - 40
        label = f"{i + 1}. {p['title']}" + (f" — {p['takeaway']}" if p.get("takeaway") else "")
        data = base_data(label, "")
        data.update({"stepKind": "frame", "frameColor": p.get("color") if p.get("color") in COLORS else COLORS[i % len(COLORS)],
                     "frameCarry": True})
        frames.append({"id": f"frame-{p['id']}", "type": "thought", "dragHandle": ".drag-handle", "zIndex": -1,
                       "position": {"x": x0, "y": y0}, "width": x1 - x0, "height": y1 - y0, "data": data})

    def overlaps(a, b):
        return (a["position"]["x"] < b["position"]["x"] + b["width"] and b["position"]["x"] < a["position"]["x"] + a["width"]
                and a["position"]["y"] < b["position"]["y"] + b["height"] and b["position"]["y"] < a["position"]["y"] + a["height"])
    for a in range(len(frames)):
        for b in range(a + 1, len(frames)):
            if overlaps(frames[a], frames[b]):
                warnings.append(f"frames {frames[a]['id']} and {frames[b]['id']} overlap")
    if with_event_graph:
        append_event_graph(nodes, edges, frames, timeline, zh)
    canvas = {"version": 1, "name": analysis.get("title") or "Trajectory",
              "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "nodes": frames + nodes, "edges": edges}
    return canvas, warnings


def append_event_graph(nodes, edges, frames, timeline, zh):
    """Complete per-session logs beside the decision graph, linked only by evidence."""
    start_x = max(n['position']['x'] + n.get('width', NODE_W) for n in nodes + frames) + LANE_W
    sessions = {}
    for e in timeline.get('timeline', []): sessions.setdefault(e.get('session_id','main'), []).append(e)
    event_nodes = {}
    for column, (sid, events) in enumerate(sessions.items()):
        x = start_x + column * LANE_W; previous = None
        for row,e in enumerate(events,1):
            node_id = 'raw-' + e['id']; event_nodes[e['id']] = node_id
            category = event_category(e); title = f"{e['id']} · {e.get('tool') or e['kind']}"
            data = base_data(title,e['text'])
            data.update(summaries=[title],summaryTopics=[category])
            if e.get('model'): data['generatedBy'] = [e['model']]
            n = {'id':node_id,'type':'thought','dragHandle':'.drag-handle','position':{'x':x,'y':row*ROW_H},'data':data}
            decorate(n,e.get('actor','main'),category,{'layer':'events', **{k:v for k,v in e.items() if k!='text'}},zh)
            nodes.append(n)
            if previous: edges.append(edge(previous,node_id,'continue'))
            previous = node_id
        frame = base_data(('完整轨迹 · ' if zh else 'Full trajectory · ') + sid,'')
        frame.update(stepKind='frame',frameColor='gray')
        frames.append({'id':'raw-frame-'+sid,'type':'thought','zIndex':-1,'position':{'x':x-PAD,'y':ROW_H-70},
                       'width':NODE_W+2*PAD,'height':len(events)*ROW_H+80,'data':frame})
    for link in timeline.get('links', []):
        if link['source'] not in event_nodes or link['target'] not in event_nodes:
            raise ValueError('Unknown cross-session event link')
        e = edge(event_nodes[link['source']],event_nodes[link['target']],'ref')
        e['label'] = link['kind'];e['data']['evidence'] = link['evidence'];edges.append(e)


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("analysis", type=Path)
    parser.add_argument("--timeline", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument('--with-event-graph', action='store_true', help='Include complete main/reviewer event graphs in this canvas')
    args = parser.parse_args()
    analysis = json.loads(args.analysis.read_text())
    timeline = json.loads(args.timeline.read_text())
    problems = problems_of(analysis, timeline)
    if problems:
        print("analysis.json does not fit the schema:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    canvas, warnings = build(analysis, timeline, args.with_event_graph)
    args.out.write_text(json.dumps(canvas, ensure_ascii=False, indent=1))
    args.out.chmod(0o600)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    steps = analysis["steps"]
    lanes = {round(n["position"]["x"] / LANE_W) for n in canvas["nodes"] if n["data"].get("stepKind") not in ("frame", "note")}
    print(json.dumps({"out": str(args.out), "nodes": len(canvas["nodes"]), "edges": len(canvas["edges"]),
                      "phases": len(analysis["phases"]), "lanes": len(lanes),
                      "branches": sum(bool(s.get("branch")) for s in steps),
                      "observations": sum(s["kind"] == "observation" for s in steps),
                      "decisions": sum(s["kind"] in ("decision", "pivot") for s in steps),
                      "dead_ends": sum(s["kind"] == "dead_end" for s in steps), "warnings": len(warnings)},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
