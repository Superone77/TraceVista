#!/usr/bin/env python3
"""Show complete cited events, including namespaced main:E1-E3 references.

Single-session timelines use plain IDs such as E37; a main: prefix is accepted there too."""
import argparse
import json
from pathlib import Path
from build_canvas import expand


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('timeline',type=Path)
    parser.add_argument('events',nargs='+')
    parser.add_argument('--max',type=int,help='Optional display limit; full text is the default')
    args=parser.parse_args()
    data=json.loads(args.timeline.read_text())
    index={e['id']:e for e in data['timeline']}
    refs=args.events
    if not any(':' in key for key in index):
        refs=[ref.replace('main:','') if ref.startswith('main:') else ref for ref in refs]
    try: events=expand(refs,index)
    except ValueError as exc: parser.error(str(exc))
    for e in events:
        print(f"=== {e['id']} · {e.get('actor','main')} · {e['kind']} · {e.get('tool') or ''} · {e.get('t_min')} min")
        print(e['text'] if args.max is None else e['text'][:args.max])
        print()

if __name__=='__main__': main()
