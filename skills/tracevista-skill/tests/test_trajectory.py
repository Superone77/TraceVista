import json
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import extract_timeline as extract
import build_canvas as build


def jsonl(rows): return '\n'.join(json.dumps(r) for r in rows)


def example_timeline():
    return {'timeline':[
        {'id':'main:E1','kind':'call','actor':'main','session_id':'main','tool':'shell','text':'pytest','tokens_in':None,'t_min':None},
        {'id':'main:E2','kind':'result','actor':'main','session_id':'main','tool':'shell','text':'2 tests passed','tokens_in':None,'t_min':None},
        {'id':'review:E1','kind':'note','actor':'reviewer','session_id':'review','tool':None,'text':'PASS','tokens_in':42,'t_min':None}],
        'sources':[{'name':'original.log','text':'complete source'}],
        'links':[{'source':'main:E1','target':'review:E1','kind':'review_request','evidence':'recorded invocation ID'}]}


def example_analysis():
    return {'title':'Task','language':'zh','overview':'An example','phases':[{'id':'P1','title':'Verify'}],
            'steps':[{'id':'S1','phase':'P1','kind':'observation','category':'tool','title':'Tests passed','events':['main:E1-E2'],'informs':['S2'],'analyst':'Only two tests.'},
                     {'id':'S2','phase':'P1','kind':'decision','title':'Accept','body':'Accept after review','events':['main:E2','review:E1']},
                     {'id':'S3','phase':'P1','kind':'result','title':'Review','body':'PASS','actor':'reviewer','events':['review:E1'],'after':'S2'}]}


class TimelineTests(unittest.TestCase):
    def test_codex_final_usage_and_unfinished(self):
        events,tokens,fmt=extract.extract(jsonl([
            {'type':'item.started','item':{'id':'x','type':'command_execution','command':'sleep 10'}},
            {'type':'item.completed','item':{'id':'m','type':'agent_message','text':'Done'}},
            {'type':'turn.completed','usage':{'input_tokens':1234}},
            {'type':'turn.completed','usage':{'input_tokens':66}},
        ]))
        self.assertEqual(tokens,1300)
        self.assertEqual(events[-1]['tokens_in'],1300)
        self.assertTrue(events[0]['unfinished'])
        self.assertEqual(events[0]['source_line'],1)

    def test_claude_full_text_thinking_call_ids_and_incremental_usage(self):
        long='x'*20001
        events,tokens,_=extract.extract(jsonl([
            {'type':'assistant','message':{'id':'m1','usage':{'input_tokens':10},'content':[
                {'type':'thinking','thinking':'Observed latency'},
                {'type':'tool_use','id':'tool-1','name':'Bash','input':{'command':'echo ok'}}]}},
            {'type':'user','message':{'content':[{'type':'tool_result','tool_use_id':'tool-1','content':long}]}},
            {'type':'assistant','message':{'id':'m1','usage':{'input_tokens':12,'cache_read_input_tokens':30},'content':[{'type':'text','text':'Done'}]}}
        ]))
        self.assertEqual(tokens,42)
        self.assertEqual(events[0]['kind'],'thinking')
        self.assertEqual(events[2]['text'],long)
        self.assertEqual(events[1]['call_id'],events[2]['call_id'])
        self.assertEqual(events[2]['tool'],'Bash')

    def test_timestamped_claude_preserves_runner_provenance_and_native_records(self):
        rows=[
            'runner starting',
            '[2026-06-12T09:03:00Z] '+json.dumps({'type':'system','subtype':'init'}),
            '[2026-06-12T09:03:01Z] '+json.dumps({'type':'assistant','uuid':'message-1','message':{
                'id':'m1','model':'recorded-model','content':[
                    {'type':'thinking','thinking':'A recorded reasoning block'},
                    {'type':'tool_use','id':'call-1','name':'Bash','input':{'command':'echo done'}}]}}),
            '[2026-06-12T09:03:02Z] '+json.dumps({'type':'rate_limit_event','rate_limit_info':{'status':'allowed'}}),
            '[2026-06-12T09:03:03Z]   runner progress',
            '[2026-06-12T09:03:04Z] '+json.dumps({'type':'user','message':{'content':[
                {'type':'tool_result','tool_use_id':'call-1','content':'full result','is_error':True}]}}),
            '[2026-06-12T09:03:05Z] '+json.dumps({'type':'result','subtype':'success','result':'finished'}),
            'Terminated',
        ]
        original='\n'.join(rows)+'\n'
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'runner.log';path.write_text(original)
            result=extract.build_timeline([{'id':'main','path':str(path)}],namespaced=True)
        events=result['timeline']
        self.assertEqual(result['sessions'][0]['format'],'claude-code')
        self.assertEqual([e['source_line'] for e in events],[1,2,3,3,4,5,6,7,8])
        self.assertEqual([e['id'] for e in events],[f'main:E{i}' for i in range(1,10)])
        self.assertEqual(events[2]['kind'],'thinking')
        self.assertEqual(events[2]['text'],'A recorded reasoning block')
        self.assertEqual(events[3]['call_id'],events[6]['call_id'])
        self.assertEqual(events[6]['tool'],'Bash');self.assertTrue(events[6]['error'])
        self.assertEqual(events[2]['event_id'],'message-1')
        self.assertEqual(events[2]['timestamp'],'2026-06-12T09:03:01Z')
        self.assertEqual(events[2]['source_timestamp'],events[2]['timestamp'])
        self.assertEqual(events[7]['t_min'],round(5/60,2))
        self.assertEqual(json.loads(events[4]['text'])['type'],'rate_limit_event')
        self.assertEqual(events[5]['text'],'  runner progress')
        self.assertEqual(events[-1]['record_type'],'runner')
        self.assertIsNone(events[-1]['timestamp']);self.assertIsNone(events[-1]['t_min'])
        self.assertIsNone(result['tokens_in'])
        self.assertEqual(result['sources'][0]['text'],original)
        self.assertEqual(result['sources'][0]['sha256_original'],hashlib.sha256(original.encode()).hexdigest())

    def test_timestamped_claude_native_time_wins_and_usage_is_not_duplicated(self):
        message={'id':'m','usage':{'input_tokens':7,'cache_read_input_tokens':12},
                 'content':[{'type':'text','text':'one'}]}
        original='\n'.join([
            '[2026-06-12T11:00:00+02:00] '+json.dumps({'type':'assistant','timestamp':'2026-06-12T09:00:01Z','message':message}),
            '[2026-06-12T11:01:00+02:00] '+json.dumps({'type':'assistant','message':message}),
        ])
        events,tokens,_=extract.extract(original)
        self.assertEqual(tokens,19)
        self.assertEqual(events[0]['timestamp'],'2026-06-12T09:00:01Z')
        self.assertEqual(events[0]['source_timestamp'],'2026-06-12T11:00:00+02:00')
        self.assertEqual(events[1]['t_min'],round(59/60,2))

    def test_timestamped_claude_does_not_drop_empty_or_unknown_native_records(self):
        original='\n'.join([
            '[2026-06-12T09:00:00.125Z] '+json.dumps({'type':'assistant','message':{'content':[]}}),
            '[2026-06-12T09:00:01Z] '+json.dumps({'type':'assistant','message':{'content':[{'type':'future_block','data':'kept'}]}}),
            '[2026-06-12T09:00:02Z] '+json.dumps({'type':'tool_progress','tool_use_id':'call-1','elapsed_time_seconds':2}),
            '[2026-06-12T09:00:03Z] {malformed native JSON',
        ])
        events,tokens,_=extract.extract(original)
        self.assertEqual(len(events),4);self.assertIsNone(tokens)
        self.assertTrue(all(e['kind']=='status' for e in events))
        self.assertIn('future_block',events[1]['text'])
        self.assertEqual(json.loads(events[2]['text'])['tool_use_id'],'call-1')
        self.assertEqual(events[3]['record_type'],'runner')
        self.assertEqual(events[3]['text'],'{malformed native JSON')

    def test_timestamped_runner_text_is_not_an_agent_format(self):
        for original in (
            '[2026-06-12T09:00:00Z] runner starting\nTerminated',
            '[2026-06-12T09:00:00Z] {"unknown":"record"}',
            '[not-a-timestamp] {"type":"assistant","message":{"content":[]}}',
            '[2026-99-12T09:00:00Z] {"type":"assistant","message":{"content":[]}}',
            '[2026-06-12T09:00:00Z] {"type":"item.completed","item":{"type":"agent_message","text":"hi"}}',
        ):
            with self.subTest(original=original),self.assertRaises(ValueError): extract.extract(original)

    def test_long_runner_preamble_and_zero_native_timestamp(self):
        original='\n'.join(['runner setup']*450+[
            '[2026-06-12T09:00:00Z] '+json.dumps({'type':'assistant','timestamp':0,'message':{
                'content':[{'type':'text','text':'recorded message'}]}})])
        events,tokens,fmt=extract.extract(original)
        self.assertEqual(fmt,'claude-code');self.assertEqual(len(events),451)
        self.assertEqual(events[-1]['source_line'],451)
        self.assertEqual(events[-1]['timestamp'],0)
        self.assertEqual(events[-1]['source_timestamp'],'2026-06-12T09:00:00Z')
        self.assertEqual(events[-1]['t_min'],0)
        self.assertIsNone(tokens)

    def test_missing_usage_is_unknown(self):
        events,tokens,_=extract.extract(jsonl([{'type':'item.completed','item':{'type':'agent_message','text':'hi'}}]))
        self.assertIsNone(tokens);self.assertIsNone(events[0]['tokens_in'])

    def test_rollout_keeps_context_and_final_usage(self):
        events,tokens,_=extract.extract(jsonl([
            {'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'<instructions>real task</instructions>'}]}},
            {'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':99}}}}
        ]))
        self.assertEqual(tokens,99);self.assertIn('real task',events[0]['text'])

    def test_multi_session_sources_and_redaction(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'trace.jsonl';secret='example_private_credential_12345'
            p.write_text(jsonl([{'type':'item.completed','item':{'type':'agent_message','text':secret}}]))
            result=extract.build_timeline([{'id':'main','path':str(p)},{'id':'review','actor':'reviewer','path':str(p)}],
                lambda s:extract.redact(s,[secret]),True,[{'source':'main:E1','target':'review:E1','kind':'review_request','evidence':'trace ID'}])
            self.assertNotIn(secret,json.dumps(result));self.assertEqual(len(result['sources']),2)
            self.assertEqual(result['timeline'][1]['actor'],'reviewer')
            self.assertIsNone(result['tokens_in'])
            with self.assertRaises(ValueError):
                extract.build_timeline([{'id':'main','path':str(p)}],namespaced=True,links=[{'source':'bad','target':'main:E1'}])

    def test_review_artifacts_and_no_result(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'request.json').write_text('{"prompt":"review"}')
            result=extract.build_timeline([{'id':'review','actor':'reviewer','format':'review-artifacts','path':d}],namespaced=True)
            self.assertTrue(result['timeline'][-1]['unfinished'])
            (p/'verdict.json').write_text('{"verdict":"PASS"}')
            result=extract.build_timeline([{'id':'review','actor':'reviewer','format':'review-artifacts','path':d}],namespaced=True)
            self.assertEqual(result['timeline'][-1]['kind'],'note')
            self.assertEqual(len(result['sources']),2)


class CanvasTests(unittest.TestCase):
    def test_missing_or_invalid_evidence_rejected(self):
        for refs in ([],['E999'],['bad'],['main:E1-E999'],['main:E1-review:E1']):
            a=example_analysis();a['steps'][0]['events']=refs
            with self.subTest(refs=refs):
                self.assertTrue(build.problems_of(a,example_timeline()))
                with self.assertRaises(ValueError):build.build(a,example_timeline())

    def test_complete_combined_canvas(self):
        timeline=example_timeline();canvas,warnings=build.build(example_analysis(),timeline,True)
        self.assertEqual(warnings,[])
        nodes={n['id']:n for n in canvas['nodes']}
        self.assertEqual(len(nodes),len(canvas['nodes']))
        self.assertEqual(json.loads(nodes['root']['data']['attachments'][0]['content']),timeline)
        self.assertTrue(nodes['raw-review:E1']['data']['isEvaluator'])
        self.assertEqual(nodes['raw-main:E1']['data']['traceExport']['category'],'tool')
        self.assertEqual(nodes['S3']['data']['stepKind'],'review')
        self.assertIn('Only two tests.',nodes['note-S1']['data']['question'])
        for e in canvas['edges']:
            self.assertIn(e['source'],nodes);self.assertIn(e['target'],nodes)
            self.assertNotEqual(nodes[e['target']]['data'].get('stepKind'),'note')
        self.assertEqual(len({e['id'] for e in canvas['edges']}),len(canvas['edges']))
        self.assertTrue(all(not n['data']['autoRerun'] for n in nodes.values()))

    def test_bad_structure_rejected_before_layout(self):
        a=example_analysis();a['steps'][1]['after']='S3'
        self.assertTrue(build.problems_of(a,example_timeline()))

    def test_original_single_session_schema(self):
        timeline={'timeline':[dict(example_timeline()['timeline'][0],id='E1')]}
        a={'phases':[{'id':'P1','title':'Phase'}],'steps':[{'id':'S1','title':'Action','kind':'action','phase':'P1','events':['E1']}]}
        canvas,warnings=build.build(a,timeline)
        self.assertEqual(warnings,[])
        self.assertIn('S1',{n['id'] for n in canvas['nodes']})

if __name__=='__main__':unittest.main()
