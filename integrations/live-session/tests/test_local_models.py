import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_models import command, validate, complete


class LocalModelsTests(unittest.TestCase):
    def test_commands_isolate_analysis_and_do_not_resume_watched_session(self):
        claude = command('claude-code', 'sonnet')
        self.assertEqual(claude[claude.index('--tools')+1], '')
        for flag in ('--safe-mode', '--no-session-persistence', '--strict-mcp-config'):
            self.assertIn(flag, claude)
        codex = command('codex', 'gpt-test')
        for flag in ('--ignore-user-config', '--ephemeral', 'read-only', 'features.shell_tool=false', 'features.apps=false'):
            self.assertIn(flag, codex)
        for args in (claude, codex):
            self.assertNotIn('--resume', args)
            self.assertNotIn('--dangerously-skip-permissions', args)
            self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', args)

    def test_text_validation(self):
        valid = {'provider':'codex', 'model':'gpt-test', 'messages':[{'role':'user','content':'hello'}]}
        self.assertEqual(validate(valid)[0], 'codex')
        for change in ({'provider':'shell'}, {'model':'--unsafe'}, {'model':'$(touch nope)'},
                       {'messages':[{'role':'user','content':['image']}]},
                       {'messages':[{'role':'user','content':'data:image/png;base64,xxx'}]},
                       {'system':'x'*600000}):
            with self.assertRaises(ValueError): validate({**valid, **change})

    def test_cli_results_failure_and_cancel(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp)/'mock.py'
            script.write_text('import sys,json,time\nprompt=sys.stdin.read()\n'
                              'if "SLOW" in prompt: time.sleep(30)\n'
                              'print(json.dumps({"result":"OK"}) if sys.argv[1]=="claude-code" else json.dumps({"type":"item.completed","item":{"type":"agent_message","text":"OK"}}))\n')
            with patch('local_models.shutil.which', return_value='/mock'), patch('local_models.command', side_effect=lambda p,m:[sys.executable,str(script),p]):
                for provider in ('claude-code','codex'):
                    self.assertEqual(complete({'provider':provider,'messages':[{'role':'user','content':'test'}]},threading.Event()), 'OK')
                cancel=threading.Event(); timer=threading.Timer(.2,cancel.set);timer.start()
                started=time.monotonic()
                with self.assertRaisesRegex(ValueError,'cancelled'):
                    complete({'provider':'codex','messages':[{'role':'user','content':'SLOW'}]},cancel)
                timer.join();self.assertLess(time.monotonic()-started,4)

if __name__ == '__main__': unittest.main()
