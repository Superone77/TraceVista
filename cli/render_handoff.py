"""Use the existing viewer import handshake for a full local UI."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skills/tracevista-skill/scripts'))
from create_view import render_view

sys.stdout.write(render_view(sys.stdin.buffer.read(), Path(sys.argv[1]).name, sys.argv[2]).decode('utf8'))
