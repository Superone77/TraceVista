import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import {exampleFile} from './example-library.mjs';

const root=new URL('../',import.meta.url);
async function mod(path){
 const code=stripTypeScriptTypes(readFileSync(new URL(path,root),'utf8'));
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const {parseGraph}=await mod('viewer/src/trajectory/model.ts');
const {layoutGraph,semanticProjection}=await mod('viewer/src/trajectory/semantic.ts');
const original=JSON.parse(readFileSync(exampleFile('posttrainbench-fable5-aime.agent-state.json'),'utf8'));
const g=parseGraph(original);
assert.equal(original.language,'en');

// This public archive's embedded bytes are unchanged; extracted event text can
// still have credential-pattern redactions after the native JSON is decoded.
const source=g.timeline.sources.find(s=>s.name==='solve_out.txt');
assert(source,'The complete native source is embedded');
const sourceHash='00754213ac8904206904dae3140aeb46da3e8c54a890d278a6f8222e50593d44';
assert.equal(source.sha256_original,sourceHash);
assert.equal(createHash('sha256').update(source.text).digest('hex'),sourceHash,'The public source bytes are preserved');
assert.deepEqual(g.timeline.sources,original.timeline.sources);
assert.deepEqual(g.timeline.timeline.map(e=>[e.id,e.text,e.call_id,e.event_id]),original.timeline.timeline.map(e=>[e.id,e.text,e.call_id,e.event_id]),'Parsing preserves event text and native identifiers');
assert.equal(g.timeline.timeline.length,905);
assert.equal(g.coverage.raw_events,905);
const main=g.timeline.timeline.filter(e=>e.session_id==='main');
assert.deepEqual(['main','assessment','selection'].map(id=>g.timeline.timeline.filter(e=>e.session_id===id).length),[897,7,1]);
assert.deepEqual(main.map(e=>e.id),Array.from({length:897},(_,i)=>`main:E${i+1}`),'Every extracted source record remains in order');

const sourceLines=source.text.split(/\r?\n/);
const calls=main.filter(e=>e.kind==='call'),results=main.filter(e=>e.kind==='result');
const resultComparisons=[];
assert.equal(calls.length,219);
assert.equal(results.length,219);
assert.equal(new Set(calls.map(e=>e.call_id)).size,219);
assert.equal(new Set(results.map(e=>e.call_id)).size,219);
for(const event of [...calls,...results]){
 assert(Number.isInteger(event.source_line)&&event.source_line>0,`${event.id} retains its source line`);
 const match=sourceLines[event.source_line-1]?.match(/^\[[^\]]+\]\s*(\{.*\})$/);
 assert(match,`${event.id} points to a native JSON record`);
 const native=JSON.parse(match[1]);
 const block=native.message?.content?.[event.block??0];
 assert(block,`${event.id} points to a native message block`);
 assert.equal(event.event_id,native.uuid,`${event.id} retains the native event UUID`);
 assert.equal(block.type,event.kind==='call'?'tool_use':'tool_result');
 assert.equal(event.call_id,event.kind==='call'?block.id:block.tool_use_id,`${event.id} retains the native tool ID`);
 if(event.kind==='call')assert.deepEqual(JSON.parse(event.text),block.input,`${event.id} preserves tool arguments`);
 else if(typeof block.content==='string')resultComparisons.push({event,content:block.content});
 else assert.deepEqual(event.text.split('\n').map(line=>JSON.parse(line)),block.content,`${event.id} preserves structured tool references`);
}
// Apply the converter's existing redaction policy to the decoded source, rather
// than allowing any arbitrary change to a result containing [REDACTED].
const redaction=spawnSync('python3',['-c',
 'import json,sys; sys.path.insert(0,sys.argv[1]); from extract_timeline import redact; json.dump([redact(text) for text in json.load(sys.stdin)],sys.stdout,ensure_ascii=False)',
 fileURLToPath(new URL('skills/tracevista-skill/scripts/',root))],
 {input:JSON.stringify(resultComparisons.map(r=>r.content)),encoding:'utf8',maxBuffer:10*1024*1024});
assert.equal(redaction.status,0,redaction.stderr||'Source redaction comparison failed');
const expectedResults=JSON.parse(redaction.stdout);
const textHash=text=>createHash('sha256').update(text).digest('hex');
resultComparisons.forEach(({event},i)=>assert.equal(textHash(event.text),textHash(expectedResults[i]),`${event.id} preserves its full result subject to credential redaction`));
for(const call of calls){
 const result=results.find(e=>e.call_id===call.call_id);
 assert(result,`${call.id} has its matching result`);
 assert(g.actions.some(a=>a.events.includes(call.id)&&a.events.includes(result.id)),`${call.id} and its result belong to the same action`);
}

// Pin weight ancestry, while allowing the reading-layer grouping to evolve.
const states=new Map(g.states.map(s=>[s.id,s]));
assert(g.states.every(s=>s.assessment?.correctness===undefined),'Task accuracy must not become a binary correctness PASS');
for(const id of ['s0','s2','s4','s5','s6','s7','s8','s9','s10'])assert(states.has(id),`Missing candidate ${id}`);
assert(!states.get('s0').lineage,'The assigned base has no weight parent');
for(const [id,parent] of Object.entries({s4:'s0',s5:'s4',s6:'s5',s7:'s6',s8:'s4',s9:'s4',s10:'s5'})){
 assert.equal(states.get(id).lineage?.parent,parent,`${id} must retain its actual weight parent`);
}
assert.equal(states.get('s10').lineage.relation,'restored','Final packaging restores the existing soup, not the last tested candidate');

const selectionSource=g.timeline.sources.find(s=>s.name==='selection-evidence.json');
assert(selectionSource,'Selection evidence accompanies the public example');
const selectionArtifact=original.artifacts.find(a=>a.name==='selection-evidence.json');
const selectionEvent=g.timeline.timeline.find(e=>e.id==='selection:E1');
assert.equal(selectionArtifact.text,selectionSource.text,'Both source copies use the same redacted manifest');
assert.equal(selectionEvent.text,selectionSource.text,'The raw record uses the same redacted manifest');
assert.equal(selectionArtifact.sha256,textHash(selectionSource.text));
assert.equal(selectionSource.sha256_redacted,selectionArtifact.sha256);
assert.equal(selectionArtifact.sha256_original,selectionSource.sha256_original);
assert.notEqual(selectionSource.sha256_original,selectionSource.sha256_redacted);
const selection=JSON.parse(selectionSource.text);
const collectedSources=[selection.dataset.root_listing,...Object.values(selection.sources).filter(s=>s.local_path)];
assert.equal(collectedSources.length,12);
assert(collectedSources.every(s=>s.local_path.startsWith('source://posttrainbench/')),'Collection paths are portable source references');
assert.equal(selection.dataset.revision,'386b3034fa26f0f1b3ae3bfded99b791f0b254a6');
assert.equal(selection.selection.publicly_available_agent_rank,5,'Highest available agent does not mean current global rank one');
assert.equal(selection.selection.candidate_rank_in_clean_public_same_task,1);
assert(selection.selection.not_claimed.includes('current global PostTrainBench SOTA agent'));
assert(!/\bSOTA\b|state[- ]of[- ]the[- ]art/i.test(`${g.title} ${g.subtitle??''}`),'The example heading must not advertise global SOTA');

const observations=new Map(g.observations.map(o=>[o.id,o]));
for(const [id,value,scope] of [['dev-final',23.333,'development_score'],['archived-final',30,'independent_score'],['v12-cell',21,'other']]){
 const observation=observations.get(id);
 assert(observation,`Missing separately scoped measurement ${id}`);
 assert.equal(observation.kind,'measurement');
 assert.equal(observation.facts.scope,scope,`${id} must retain its evaluation scope`);
 assert(Math.abs(observation.facts.value-value)<.001,`${id} must retain its published value`);
}
const eventById=new Map(g.timeline.timeline.map(e=>[e.id,e]));
assert(observations.get('dev-final').events.some(id=>eventById.get(id)?.session_id==='main'),'Development score cites the training session');
assert(observations.get('archived-final').events.some(id=>eventById.get(id)?.source_file==='metrics.json'),'Archived final score cites the published metrics');
const metrics=JSON.parse(g.timeline.sources.find(s=>s.name==='metrics.json').text);
assert.equal(observations.get('archived-final').facts.value,metrics.accuracy*100);
assert(observations.get('v12-cell').events.some(id=>eventById.get(id)?.session_id==='selection'),'Current aggregate cites the dated selection snapshot');

const projections=[];
for(const mode of ['lineage','chronology'])for(const tier of ['states','branches','actions','raw']){
 const layout=layoutGraph(g,tier,mode),projected=semanticProjection(g,layout,tier);
 assert([layout.width,layout.height].every(Number.isFinite));
 assert(layout.nodes.every(n=>[n.x,n.y,n.width,n.height].every(Number.isFinite)&&n.width>0&&n.height>0),`${mode}/${tier} has valid geometry`);
 const visible=new Set(projected.nodes.map(n=>n.id));
 for(const edge of projected.edges)assert(visible.has(edge.source)&&visible.has(edge.target),`${mode}/${tier} edge ${edge.id} has visible endpoints`);
 projections.push({mode,tier,nodes:projected.nodes.length,edges:projected.edges.length});
}
console.log(JSON.stringify({passed:true,rawEventsPreserved:905,nativeToolPairs:219,measurementScopesPreserved:true,projections}));
