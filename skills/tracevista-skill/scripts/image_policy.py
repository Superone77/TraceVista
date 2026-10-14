#!/usr/bin/env python3
"""Apply an explicit image choice to a timeline or complete TraceVista export."""
import argparse
import copy
import hashlib
import json
import os
import re
from pathlib import Path

URI = re.compile(r'data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/_=-]+)')
START = re.compile(r'[\[{]')
DECODER = json.JSONDecoder()


def marker(mime, data):
    digest = hashlib.sha256(data.encode()).hexdigest()
    return f'[Image omitted by user choice; mime={mime}; base64_chars={len(data)}; sha256_base64={digest}]'


def omit_text(text):
    text = URI.sub(lambda m: marker(m[1], m[2]), text)
    # Source archives can contain JSONL, provider image blocks and serialized JSON
    # inside text. Only reserialize an object when a known image payload changed.
    if 'image/' not in text:
        return text
    parts, cursor, search = [], 0, 0
    while True:
        match = START.search(text, search)
        if not match:
            break
        start = match.start()
        try:
            value, end = DECODER.raw_decode(text, start)
        except ValueError:
            search = start + 1
            continue
        cleaned = omit_value(value)
        if cleaned != value:
            parts.extend([text[cursor:start], json.dumps(cleaned, ensure_ascii=False)])
            cursor = end
        search = end
    return ''.join(parts) + text[cursor:]


def omit_value(value):
    if isinstance(value, str):
        return omit_text(value)
    if isinstance(value, list):
        return [omit_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    out = {key: omit_value(item) for key, item in value.items()}
    # Anthropic source blocks and MCP image blocks carry MIME and payload together.
    mime = value.get('media_type') or value.get('mimeType')
    data = value.get('data')
    if isinstance(mime, str) and mime.startswith('image/') and isinstance(data, str) and not data.startswith('[Image omitted'):
        out['data'] = marker(mime, data)
    return out


def apply_image_policy(value, mode):
    if mode not in ('keep', 'omit'):
        raise ValueError('Image policy must be keep or omit')
    if mode == 'keep':
        return copy.deepcopy(value)
    out = omit_value(value)
    out['image_policy'] = {'mode': 'omit', 'note': 'Embedded image payloads omitted by user choice; text, IDs and image markers retained. Source archives are image-omitted derivatives.'}
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('file', type=Path)
    p.add_argument('--images', choices=('keep', 'omit'), required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    os.umask(0o077)
    out = apply_image_policy(json.loads(args.file.read_text()), args.images)
    args.out.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    args.out.chmod(0o600)
    print(json.dumps({'out': str(args.out.resolve()), 'images': args.images, 'bytes': args.out.stat().st_size}))


if __name__ == '__main__':
    main()
