import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const hash=text=>createHash('sha256').update(text).digest('hex');
async function mod(path){
 const code=stripTypeScriptTypes(readFileSync(new URL(path,root),'utf8'));
 return import('data:text/javascript;base64,'+Buffer.from(code+`\n//# sourceURL=${path}\n`).toString('base64'));
}
const {parseGraph}=await mod('viewer/src/trajectory/model.ts');
const {layoutGraph,semanticProjection}=await mod('viewer/src/trajectory/semantic.ts');
const catalog=JSON.parse(readFileSync(new URL('viewer/public/examples/index.json',root),'utf8'));
const examples=Array.isArray(catalog)?catalog:catalog.examples;
assert(Array.isArray(examples),'The example catalog contains a list');

function extractNative(source){
 const result=spawnSync('python3',['-c',
  'import json,sys; sys.path.insert(0,sys.argv[1]); from extract_timeline import extract,redact,clean_metadata; events,tokens,fmt=extract(sys.stdin.read()); json.dump({"events":clean_metadata(events,redact),"tokens":tokens,"format":fmt},sys.stdout,ensure_ascii=False)',
  fileURLToPath(new URL('skills/tracevista-skill/scripts/',root))],
  {input:source.text,encoding:'utf8',maxBuffer:64*1024*1024});
 assert.equal(result.status,0,result.stderr||'Embedded native source must be extractable');
 return JSON.parse(result.stdout);
}

function verifyArchive(g,original,config){
 const source=g.timeline.sources.find(s=>s.sha256_original===config.sha);
 assert(source,`${config.id}: complete pinned native source is embedded`);
 assert.equal(hash(source.text),config.sha,`${config.id}: native source bytes are unchanged`);
 assert.deepEqual(g.timeline.sources,original.timeline.sources,'Parsing preserves all archived fields');
 assert.deepEqual(g.timeline.timeline,original.timeline.timeline,'Parsing preserves every native and attached evidence record');
 assert.equal(g.coverage.raw_events,g.timeline.timeline.length,'Coverage counts include attached context records');
 const extracted=extractNative(source);
 assert.equal(extracted.format,config.format);
 assert.equal(extracted.events.length,config.count);
 const main=g.timeline.timeline.filter(e=>e.session_id==='main');
 assert.equal(main.length,config.count,`${config.id}: native records are neither dropped nor replaced by context artifacts`);
 const namespace=main[0].id==='E1'?'':'main:';
 const fields=['text','kind','tool','error','call_id','event_id','source_line','source_index','source_pointer','record_type','block','timestamp','t_min','tokens_in'];
 main.forEach((event,i)=>{
  const expected=extracted.events[i];
  assert.equal(event.id,`${namespace}${expected.id}`,`${config.id}: native source order remains stable`);
  for(const field of fields){
   assert.deepEqual(event[field]??null,expected[field]??null,`${config.id}/${event.id}: source-derived ${field} is preserved`);
  }
 });
 assert.equal(new Set(main.map(e=>e.source_index)).size,config.sourceRecords,'Every native source record is reachable');
 assert.equal(main.filter(e=>e.kind==='call').length,config.calls);
 assert.equal(main.filter(e=>e.kind==='result').length,config.results);
 assert.equal(g.timeline.sessions.find(s=>s.id==='main').tokens_in,extracted.tokens,'Missing native usage is not replaced by an estimate');
 return {source,main};
}

function verifyViews(g,id){
 const projections=[];
 for(const mode of ['lineage','chronology'])for(const tier of ['states','branches','actions','raw']){
  const layout=layoutGraph(g,tier,mode),projected=semanticProjection(g,layout,tier);
  assert([layout.width,layout.height].every(Number.isFinite),`${id}/${mode}/${tier}: finite viewport`);
  assert(layout.nodes.length>0,`${id}/${mode}/${tier}: visible content`);
  assert(layout.nodes.every(n=>[n.x,n.y,n.width,n.height].every(Number.isFinite)&&n.width>0&&n.height>0),`${id}/${mode}/${tier}: valid node geometry`);
  const visible=new Set(projected.nodes.map(n=>n.id));
  for(const edge of projected.edges)assert(visible.has(edge.source)&&visible.has(edge.target),`${id}/${mode}/${tier}: ${edge.id} has visible endpoints`);
  projections.push({mode,tier,nodes:projected.nodes.length,edges:projected.edges.length});
 }
 return projections;
}

function measurement(g,id,value,scope){
 const observation=g.observations.find(o=>o.id===id);
 assert(observation,`Missing independently scoped evidence: ${id}`);
 assert.equal(observation.kind,'measurement');
 assert(Math.abs(observation.facts.value-value)<1e-10,`${id}: preserve the reported value`);
 if(scope)assert.equal(observation.facts.scope,scope,`${id}: preserve the evaluation scope`);
 const byId=new Map(g.timeline.timeline.map(e=>[e.id,e]));
 assert(observation.events.length>0,`${id}: evidence is cited`);
 assert(observation.events.every(id=>byId.has(id)),`${id}: citations resolve`);
 return {observation,events:observation.events.map(id=>byId.get(id))};
}

// Selection-specific assertions below pin source identity and evidence boundaries,
// while leaving editorial labels and reading-layer groupings free to evolve.
const configs=[
 {id:'inferencebench-serving-recovery',format:'inferencebench',
  sha:'bf5cb937a03dab763e37b17a013cb9771febfd55b24297d6e9d8aff598101c89',
  count:650,sourceRecords:650,calls:269,results:269,
  overview:[[/Codex/i,'agent harness'],[/GPT[- ]?5\.5/i,'agent model'],[/Mistral[- /]?7B/i,'served base model'],[/Scenario D/i,'assigned task'],[/H100/i,'GPU'],[/2[- ]hour|two[- ]hour|120[- ]minute/i,'time budget']]},
 {id:'swe-rebench-kafka-retry',format:'swe-rebench',
  sha:'8040ab07d8439e79cc0b2e40db0c56284e1aaa2ef97d2581f88ab8c59774a5e9',
  count:233,sourceRecords:169,calls:84,results:83,
  overview:[[/OpenHands/i,'agent harness'],[/Qwen3[- ]Coder/i,'agent model'],[/Kafka/i,'target project'],[/connection|retry/i,'assigned bug'],[/Python/i,'runtime configuration']]},
];
const reports=[];
const selected=new Set(process.argv.slice(2));
for(const id of selected)assert(configs.some(c=>c.id===id),`Unknown example: ${id}`);
for(const config of configs.filter(c=>!selected.size||selected.has(c.id))){
 const entry=examples.find(e=>e.id===config.id);
 assert(entry,`${config.id}: example is discoverable in the catalog`);
 const original=JSON.parse(readFileSync(new URL(`viewer/public/examples/${entry.file}`,root),'utf8'));
 const g=parseGraph(original);
 assert.equal(g.language,'en');
 for(const [pattern,field] of config.overview)assert.match(g.journey?.text??'',pattern,`${config.id}: Run overview explains ${field}`);
 const {source,main}=verifyArchive(g,original,config);
 if(config.format==='inferencebench'){
  assert(main.every(e=>e.call_id==null),'The normalized trace has no native call IDs; adjacency must not invent them');
  const dev=measurement(g,'dev-warm',130.7557499185844,'development_score');
  const flash=measurement(g,'dev-flash',130.8847324404538,'development_score');
  const final=measurement(g,'final-throughput',144.5143282098839,'independent_score');
  const quality=measurement(g,'final-quality',32,'independent_score');
  assert(dev.events.every(e=>e.session_id==='main'));
  assert(flash.events.every(e=>e.session_id==='main'));
  assert(final.events.every(e=>e.session_id!=='main'),'Published external evaluation must not become agent-reported development evidence');
  assert(quality.events.every(e=>e.session_id!=='main'));
  assert.match(dev.observation.facts.protocol,/concurrency\s*4/i);
  assert.match(final.observation.facts.protocol,/concurrency\s*1/i);
  const finalBaseline=final.observation.facts.baseline;
  assert(finalBaseline==null||typeof finalBaseline==='string'&&/not|unknown|unavailable/i.test(finalBaseline),'Different concurrency protocols must not produce an asserted speedup');
  const metrics=JSON.parse(g.timeline.sources.find(s=>s.name==='metrics.json').text);
  assert.equal(final.observation.facts.value,metrics.profiles.burst.generation_throughput_tokens_per_s);
  assert.equal(quality.observation.facts.value,metrics.quality_check.datasets.mmlu_pro.observed_accuracy*100);
 }else{
  const row=JSON.parse(source.text);
  assert.equal(row.instance_id,'dpkp__kafka-python-1312');
  assert.equal(row.resolved,0,'The archived repair is unresolved');
  assert.equal(row.gen_tests_correct,0,'The generated tests are not accepted as correct');
  assert.equal(row.pred_passes_gen_tests,1,'Passing generated tests does not establish resolution');
  const resolved=measurement(g,'external-resolved',row.resolved,'independent_score');
  const own=measurement(g,'own-tests',row.pred_passes_gen_tests);
  const testQuality=measurement(g,'test-quality',row.gen_tests_correct);
  for(const assessment of [resolved,own,testQuality])assert(assessment.events.some(e=>e.session_id!=='main'),'Published assessment flags must cite the external dataset record');
  const calls=main.filter(e=>e.kind==='call'),results=main.filter(e=>e.kind==='result');
  assert.equal(new Set(calls.map(e=>e.call_id)).size,84);
  assert.equal(new Set(results.map(e=>e.call_id)).size,83);
  for(const result of results)assert(calls.some(c=>c.call_id===result.call_id),`${result.id}: native result has its native call`);
  const withoutResult=calls.filter(c=>!results.some(r=>r.call_id===c.call_id));
  assert.equal(withoutResult.length,1);
  assert.equal(withoutResult[0].tool,'finish','The export must not fabricate a result for the terminal finish call');
  const states=new Map(g.states.map(s=>[s.id,s]));
  const testingStates=['s3','s4','s5','s6'].map(id=>states.get(id));
  assert(testingStates.every(Boolean),'Keep the separate implementation and verification-harness changes');
  assert(testingStates.every(s=>s.snapshot.implementation===testingStates[0].snapshot.implementation),'Passing self-tests must not be presented as additional implementation fixes');
  assert(new Set(testingStates.map(s=>s.snapshot.verification_harness)).size>1,'Verification-harness modifications remain visible');
 }
 const projections=verifyViews(g,config.id);
 reports.push({id:config.id,nativeEvents:main.length,totalEvents:g.timeline.timeline.length,projections});
}
console.log(JSON.stringify({passed:true,sourceArchivesPreserved:true,examples:reports}));
