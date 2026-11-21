"""Reuse the shared validator without printing source data on errors."""
import json
import hashlib
from pathlib import Path
import sys

if sys.version_info < (3, 10):
    sys.exit('Python 3.10+ is required.')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skills/tracevista-skill/scripts'))
from validate_trace import TraceError, load_trace

try:
    raw, _, report, counts = load_trace(sys.argv[1])
    print(json.dumps({'quality': report, 'counts': counts, 'sha256': hashlib.sha256(raw).hexdigest()}))
except TraceError as error:
    sys.exit('Trace validation failed: ' + str(error))
