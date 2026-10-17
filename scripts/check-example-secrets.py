"""Reject credential patterns in the external example library; print counts, never matches.
Pattern scanning is a guard, not proof that arbitrary logs are safe to publish.
"""
import argparse
import json
import os
import re
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--examples-dir', help='Example repository root, containing examples/index.json; defaults to TRACEVISTA_EXAMPLES_DIR or the sibling TraceVista-examples repository')
args=parser.parse_args()
configured=args.examples_dir if args.examples_dir is not None else os.environ.get('TRACEVISTA_EXAMPLES_DIR')
if configured is not None and not configured.strip():
 parser.error('TRACEVISTA_EXAMPLES_DIR must name an example library directory')
root=Path(configured).resolve() if configured is not None else Path(__file__).resolve().parents[2]/'TraceVista-examples'
directory=root/'examples'
catalog_path=directory/'index.json'
if not catalog_path.is_file():
 parser.error(f'Example library not found at {root}. Set TRACEVISTA_EXAMPLES_DIR or --examples-dir to the repository root containing examples/index.json')
try:
 catalog=json.loads(catalog_path.read_text())
except (OSError, ValueError) as error:
 parser.error(f'Cannot read example catalog: {error}')
if not isinstance(catalog,list) or not catalog:
 parser.error('The example catalog must contain at least one example')
for entry in catalog:
 filename=entry.get('file') if isinstance(entry,dict) else None
 if not isinstance(filename,str) or not re.fullmatch(r'[a-zA-Z0-9_-]+\.agent-state\.json',filename):
  parser.error('The example catalog contains an invalid export filename')
 if not (directory/filename).is_file():
  parser.error(f'Example export is missing: {filename}')

patterns=[
 re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 re.compile(r'\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}'),
 re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}'),
 re.compile(r'\bgithub_pat_[A-Za-z0-9_]{30,}'),
 re.compile(r'\bAKIA[0-9A-Z]{16}\b'),
 re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),
 re.compile(r'(?i)bearer\s+[A-Za-z0-9._-]{20,}'),
]
files=sorted(p for p in directory.glob('*.json') if p.is_file())
failures=[]
for p in files:
 text=p.read_text()
 if any(pattern.search(text) for pattern in patterns): failures.append(str(p.relative_to(root)))
print(json.dumps({'example_files_scanned':len(files),'files_with_credential_patterns':failures}))
if failures: raise SystemExit(1)
