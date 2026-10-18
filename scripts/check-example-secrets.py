"""Reject credential patterns and personal local paths in the example library.

Report filenames and structural locations, never matched values or JSON keys.
"""
import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import unquote


CREDENTIAL_PATTERNS = [
    re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(r'\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}'),
    re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}'),
    re.compile(r'\bgithub_pat_[A-Za-z0-9_]{30,}'),
    re.compile(r'\bAKIA[0-9A-Z]{16}\b'),
    re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),
    re.compile(r'(?i)bearer\s+[A-Za-z0-9._-]{20,}'),
]

# Only explicit placeholders are exempt. Ordinary account names remain findings.
PLACEHOLDERS = {
    '<user>', '<username>', '<name>', '<home>', '<redacted>', '<local-user>',
    '[user]', '[username]', '[redacted]', '{user}', '{username}',
    '$user', '${user}', '$username', '${username}', 'redacted',
    'your-username', 'your_username', 'example-user',
}
COMPONENT = r'([^/\s\"\x27`]+)'
WINDOWS_HOME = re.compile(r'(?i)\b[a-z]:/users/' + COMPONENT)
MACOS_HOME = re.compile(r'/Users/' + COMPONENT)
MACOS_TEMP = re.compile(r'/(?:private/)?var/folders/' + COMPONENT)
UNICODE_ESCAPE = re.compile(r'\\u([0-9a-fA-F]{4})')


def normalized_path_text(value):
    """Expose paths inside escaped JSON strings and percent-encoded URLs.

    Decoding only shortens strings, so repeated encoding reaches a fixed point.
    This does not interpret commands or evaluate JSON embedded in log messages.
    """
    while True:
        decoded = unquote(value)
        decoded = UNICODE_ESCAPE.sub(lambda m: chr(int(m[1], 16)), decoded)
        if decoded == value:
            break
        value = decoded
    # Several JSON layers can leave repeated backslashes before a separator.
    return re.sub(r'/+', '/', value.replace('\\', '/'))


def local_path_types(value):
    text = normalized_path_text(value)
    windows = list(WINDOWS_HOME.finditer(text))
    types = set()
    for match in windows:
        if match[1].casefold() not in PLACEHOLDERS:
            types.add('windows_home')
    for match in MACOS_HOME.finditer(text):
        if any(start.start() <= match.start() < start.end() for start in windows):
            continue
        if match[1].casefold() not in PLACEHOLDERS:
            types.add('macos_home')
    for match in MACOS_TEMP.finditer(text):
        if match[1].casefold() not in PLACEHOLDERS:
            types.add('macos_temp')
    return sorted(types)


def string_locations(value, location='$'):
    """Use field ordinals because a JSON key can itself contain private data."""
    if isinstance(value, str):
        yield location, value
    elif isinstance(value, dict):
        for index, (key, child) in enumerate(value.items()):
            field = f'{location}[field:{index}]'
            yield field + '.key', key
            yield from string_locations(child, field + '.value')
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from string_locations(child, f'{location}[{index}]')


def scan_examples(root):
    files = sorted(p for p in (root / 'examples').glob('*.json') if p.is_file())
    credentials, paths, invalid = [], [], []
    for path in files:
        filename = str(path.relative_to(root))
        try:
            text = path.read_text(encoding='utf-8')
        except (OSError, UnicodeError):
            invalid.append(filename)
            continue
        if any(pattern.search(text) for pattern in CREDENTIAL_PATTERNS):
            credentials.append(filename)
        try:
            data = json.loads(text)
        except ValueError:
            invalid.append(filename)
            continue
        for location, value in string_locations(data):
            for kind in local_path_types(value):
                paths.append({'file': filename, 'location': location, 'type': kind})
    return {
        'example_files_scanned': len(files),
        'files_with_credential_patterns': credentials,
        'local_path_findings': paths,
        'invalid_json_files': invalid,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--examples-dir', help='Example repository root, containing examples/index.json; defaults to TRACEVISTA_EXAMPLES_DIR or the sibling TraceVista-examples repository')
    args = parser.parse_args()
    configured = args.examples_dir if args.examples_dir is not None else os.environ.get('TRACEVISTA_EXAMPLES_DIR')
    if configured is not None and not configured.strip():
        parser.error('TRACEVISTA_EXAMPLES_DIR must name an example library directory')
    root = Path(configured).resolve() if configured is not None else Path(__file__).resolve().parents[2] / 'TraceVista-examples'
    directory = root / 'examples'
    catalog_path = directory / 'index.json'
    if not catalog_path.is_file():
        parser.error('Example library not found. Set TRACEVISTA_EXAMPLES_DIR or --examples-dir to the repository root containing examples/index.json')
    try:
        catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError):
        parser.error('Cannot read example catalog as JSON')
    if not isinstance(catalog, list) or not catalog:
        parser.error('The example catalog must contain at least one example')
    for entry in catalog:
        filename = entry.get('file') if isinstance(entry, dict) else None
        if not isinstance(filename, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+\.agent-state\.json', filename):
            parser.error('The example catalog contains an invalid export filename')
        if not (directory / filename).is_file():
            parser.error(f'Example export is missing: {filename}')
    report = scan_examples(root)
    print(json.dumps(report))
    return int(bool(report['files_with_credential_patterns'] or report['local_path_findings'] or report['invalid_json_files']))


if __name__ == '__main__':
    raise SystemExit(main())
