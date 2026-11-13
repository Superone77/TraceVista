import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const urls = new Map();
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let code = stripTypeScriptTypes(readFileSync(new URL(`../src/trajectory/${name}.ts`, import.meta.url), 'utf8'));
  for (const match of code.matchAll(/from '(\.\/([^']+))'/g)) code = code.replaceAll(`'${match[1]}'`, JSON.stringify(moduleUrl(match[2])));
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  urls.set(name, url); return url;
}
const { appendLiveRecords, nextSummaryBatch, summaryRequest, applySummary, liveGraph, emptyAnnotations, eventId, summarizeLiveBatch } = await import(moduleUrl('live'));
const rows = Array.from({ length: 70 }, (_, i) => ({ id: String(i), agent: 'codex', session_id: 'fixture', byte_start: i * 100, byte_end: (i + 1) * 100,
  record: { type: 'response_item', payload: {type:'message',role:'assistant',content:[{text:`Read paper section ${i}`}] } }, raw_text: `record ${i}\n`, tool_links: [] }));
const initial = emptyAnnotations();
assert.equal(liveGraph(rows,initial,false),null);
assert.equal(appendLiveRecords(rows.slice(0,5),rows.slice(0,5)).length,5);
assert.throws(()=>appendLiveRecords(rows.slice(0,5),[rows[6]]), /Missing/);
const batch=nextSummaryBatch(rows,initial);
assert.equal(batch.length,32);
assert.equal(batch[0].id,'E3800');
assert.equal(batch.at(-1).id,'E6900');
function answer(batch,id) {
 const events=batch.flatMap(u=>u.events);
 return {overview:{title:'Codex paper review',summary:'The agent checks paper claims.',events},
 states:id==='new'?[{id:'s1',title:'Paper analysis',summary:'Read the paper.',events,snapshot:{artifact:'paper'}}]:[],
 phases:[{id:'p'+id,state:'s1',title:'Check evidence',summary:'Inspect claims.',events,status:'attempted'}],
 actions:[{id:'a'+id,state:'s1',branch:'p'+id,title:'Compare claims',summary:'Read and compare evidence.',behavior:'Explore',outcome:'observed',events,units:batch.map(u=>u.id)}],excluded:[]};
}
const annotated=applySummary(JSON.stringify(answer(batch,'new')),batch,initial);
const older=nextSummaryBatch(rows,annotated);
assert.equal(older.at(-1).id,'E3700');
const next=applySummary(JSON.stringify(answer(older,'old')),older,annotated);
assert.deepEqual(next.actions.map(a=>a.id),['aold','anew'],'backfill sorts by source chronology');
assert.equal(nextSummaryBatch([...rows,{...rows[0],id:'70',byte_start:7000,byte_end:7100}],next).at(-1).id,'E7000','new arrivals take precedence over old backlog');
const graph=liveGraph(rows,next,false);
assert.equal(graph.timeline.timeline.length,70);
assert.equal(graph.timeline.sources[0].text,rows.map(r=>r.raw_text).join(''));
const bad=answer(batch,'new');bad.actions[0].events=['invalid'];
assert.throws(()=>applySummary(JSON.stringify(bad),batch,initial),/evidence/);
const missing=answer(batch,'new');missing.actions[0].units.pop();
assert.throws(()=>applySummary(JSON.stringify(missing),batch,initial),/omitted/);
const metadata={...rows[0],record:{type:'turn_context'}};
assert.equal(nextSummaryBatch([metadata],initial).length,0);
const call={...rows[0],tool_links:[{call_id:'c1',kind:'call',status:'pending'}]};
const result={...rows[1],tool_links:[{call_id:'c1',kind:'result',status:'done'}]};
const pair=nextSummaryBatch([call,result],initial);
assert.equal(pair.length,1);assert.equal(pair[0].events.length,2);
const callBatch=nextSummaryBatch([call],initial);
const callGraph=applySummary(JSON.stringify(answer(callBatch,'new')),callBatch,initial);
assert.equal(nextSummaryBatch([call,result],callGraph).length,1,'late results are analyzed again');
const late={...result,id:'late',byte_start:7000,byte_end:7100};
assert(nextSummaryBatch([call,...rows.slice(1),late],callGraph).some(u=>u.id==='E0'),'late tool results take priority over older backlog');
const settings={};let calls=0;
await summarizeLiveBatch(settings,rows,batch,initial,new AbortController().signal,async(_s,_sys,_msg,receive)=>{calls++;receive(JSON.stringify(answer(batch,'new')));});
const cancelled=new AbortController();cancelled.abort();
await assert.rejects(summarizeLiveBatch(settings,rows,batch,initial,cancelled.signal,async()=>calls++));
assert.equal(calls,1);
console.log('PASS: latest-first batches, chronological backfill, new-arrival priority, semantic grouping, raw preservation, runtime exclusion, tool pairing, late results, citation validation and cancellation');

const {stateConnections}=await import(moduleUrl('semantic'));
const statesGraph={...graph,states:[{...graph.states[0],id:'later',events:['E6900']},{...graph.states[0],id:'earlier',events:['E0']}],actions:[],transitions:[]};
assert.deepEqual(stateConnections(statesGraph,'chronology').map(e=>[e.source,e.target,e.kind]),[['earlier','later','chronology']]);
assert.deepEqual(stateConnections(statesGraph,'lineage'),[],'time order is not claimed ancestry');
assert.deepEqual(stateConnections({...statesGraph,liveCapture:undefined},'chronology'),[],'ordinary traces retain explicit transition semantics');
console.log('PASS: live chronological state edges, source ordering, and no fabricated lineage');
