"""Reject credential patterns in the bundled research example; print counts, never matches.
Pattern scanning is a guard, not proof that arbitrary logs are safe to publish.
"""
import json
import re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
patterns=[
 re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 re.compile(r'\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}'),
 re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}'),
 re.compile(r'\bgithub_pat_[A-Za-z0-9_]{30,}'),
 re.compile(r'\bAKIA[0-9A-Z]{16}\b'),
 re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),
 re.compile(r'(?i)bearer\s+[A-Za-z0-9._-]{20,}'),
]
files=sorted((root/'viewer/public/examples').glob('*.json'))
failures=[]
for p in files:
 if not p.is_file():continue
 text=p.read_text()
 if any(pattern.search(text) for pattern in patterns): failures.append(str(p.relative_to(root)))
print(json.dumps({'example_files_scanned':len(files),'files_with_credential_patterns':failures}))
if failures: raise SystemExit(1)
