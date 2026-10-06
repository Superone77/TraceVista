import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
async function mod(path){
 const code=stripTypeScriptTypes(readFileSync(new URL(path,root),'utf8'));
 return import('data:text/javascript;base64,'+Buffer.from(code+`\n//# sourceURL=${path}\n`).toString('base64'));
}
const {parseGraph,stateVisual,observationsFor}=await mod('viewer/src/trajectory/model.ts');
const {layoutGraph,semanticProjection}=await mod('viewer/src/trajectory/semantic.ts');
const original=JSON.parse(readFileSync(new URL('viewer/public/examples/pi-agent-lora.agent-state.json',root),'utf8'));
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

// These hashes predate the name/configuration update. Editorial changes must not
// rewrite the native session, submission receipts, or independent evaluation.
assert.equal(hash(original.timeline.timeline),'3fa37f35f355a18b2d59c12d2a396e735d60a24a9a7b536e869f52e7de56124a','All 556 native and external evidence records remain unchanged');
assert.equal(hash(original.timeline.sources),'601698941bb8d918ad4a36378bfb8b0747f62425c585b9d73cfae50d3e70d25b','Complete source archives remain unchanged');
assert.equal(hash(original.artifacts),'d94a4a62220f1b03773627c3c06e511253cc807684878ee58fba1fa0670972e1','Evidence attachments remain unchanged');
for(const source of original.timeline.sources){
 assert.equal(hash(source.text),source.sha256_original,`${source.name}: the embedded original can be verified without a local experiment directory`);
}
assert.equal(original.language,'en');
function english(value,path=''){
 if(typeof value==='string')assert(!/[\u3400-\u9fff]/u.test(value),`Untranslated annotation: ${path}`);
 else if(Array.isArray(value))value.forEach((v,i)=>english(v,`${path}[${i}]`));
 else if(value&&typeof value==='object')for(const [key,v]of Object.entries(value)){
  if(['timeline','artifacts','quote','i18n'].includes(key))continue; // Preserve the language of verbatim evidence; i18n holds the translations.
  assert(!/[\u3400-\u9fff]/u.test(key),`Untranslated annotation field: ${path}.${key}`);
  english(v,`${path}.${key}`);
 }
}
english(original);
// The Chinese table only translates this file's own English annotations: every key is an annotation, every value a translation.
if(original.i18n){
 const annotations=new Set();
 (function collect(value,key=''){
  if(['timeline','artifacts','quote','i18n'].includes(key))return;
  if(typeof value==='string')annotations.add(value);
  else if(Array.isArray(value))value.forEach(v=>collect(v));
  else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))collect(v,k);
 })(original);
 for(const [lang,table]of Object.entries(original.i18n))for(const [en,text]of Object.entries(table)){
  assert(annotations.has(en),`i18n.${lang}: ${en.slice(0,60)} is not an annotation in this file`);
  assert(typeof text==='string'&&text.trim(),`i18n.${lang}: empty translation for ${en.slice(0,60)}`);
 }
}
const g=parseGraph(original);
assert.match(g.title,/Pi Agent/);
assert(!/Pi Infra Agent/i.test(g.title));
for(const [pattern,field]of [
 [/Pi Agent/i,'agent identity'],[/deepseek[- ]flash/i,'model'],[/high/i,'reasoning setting'],
 [/LoRA/i,'optimization task'],[/shrink/i,'shrink operator'],[/expand/i,'expand operator'],
 [/A100/i,'GPU'],[/40\s*GB/i,'GPU memory'],[/90[- ]minute|90\s*min|5400\s*s/i,'wall-clock budget'],
 [/16/i,'submission budget'],
])assert.match(g.journey?.text??'',pattern,`Run overview explains ${field}`);
assert.deepEqual([g.states.length,g.branches.length,g.actions.length],[6,20,152]);
assert.deepEqual(g.timeline.timeline,original.timeline.timeline,'Import preserves every event field');
assert.deepEqual(g.timeline.sources,original.timeline.sources,'Import preserves every source field');
assert.equal(g.timeline.timeline.length,556);
assert.equal(g.timeline.timeline.filter(e=>e.session_id==='main').length,549);
const byId=new Map(g.timeline.timeline.map(e=>[e.id,e]));
for(const action of g.actions)for(const id of action.events)assert(byId.has(id),`${action.id}: raw evidence remains reachable`);
const states=new Map(g.states.map(s=>[s.id,s]));
assert.equal(states.get('s3').lineage.parent,'s2');
assert.equal(states.get('s4').lineage.parent,'s2','After regression, the next candidate derives from submission 2 rather than submission 3');
assert.equal(states.get('s4').assessment.previousState,'s3','Measured change still compares consecutive submissions');
assert.equal(states.get('s5').lineage.parent,'s4');
assert.equal(states.get('s5').lineage.relation,'retained');
assert.equal(stateVisual(states.get('s3')).label,'Measurement regressed');
assert.equal(stateVisual(states.get('s5')).delta,null,'Selecting the retained candidate is not a new measurement');

for(const [id,value,scope]of [
 ['m-dev1',18.671309,'development_score'],['m-dev2',33.3692,'development_score'],
 ['m-dev3',30.834023,'development_score'],['m-dev4',35.44498,'development_score'],
 ['m-oracle',2.113797510659521,'independent_score'],['m-official',34.588125,'independent_score'],
]){
 const observation=g.observations.find(o=>o.id===id);
 assert(observation,`Reported assessment ${id} exists`);
 assert.equal(observation.facts.scope,scope);
 assert.equal(observation.facts.value,value);
 assert(observation.events.every(event=>byId.has(event)),`${id}: measurement citations resolve`);
 assert(observation.events.every(event=>!event.startsWith('main:')),`${id}: official receipts are distinct from agent statements`);
}
assert(observationsFor(g,'s5').some(o=>o.id==='m-oracle'));
assert(g.observations.some(o=>o.kind==='measurement'&&o.facts.scope==='local_timing'),'Local experiments retain their separate measurement scope');
assert.match(g.observations.find(o=>o.id==='m-oracle').facts.protocol,/AB\s*\/\s*BA\s*\/\s*BA\s*\/\s*AB/i,'The paired evaluation retains its four-block ordering');
const projections=[];
for(const mode of ['lineage','chronology'])for(const tier of ['states','branches','actions','raw']){
 const layout=layoutGraph(g,tier,mode),projected=semanticProjection(g,layout,tier);
 assert(layout.nodes.every(n=>[n.x,n.y,n.width,n.height].every(Number.isFinite)&&n.width>0&&n.height>0));
 const visible=new Set(projected.nodes.map(n=>n.id));
 for(const edge of projected.edges)assert(visible.has(edge.source)&&visible.has(edge.target),`${edge.id}: visible endpoints`);
 if(mode==='lineage')assert.equal(layout.nodes.find(n=>n.id==='s3').y,layout.nodes.find(n=>n.id==='s4').y,'The abandoned candidate and rebased candidate are sibling versions');
 else assert(layout.nodes.find(n=>n.id==='s4').y>layout.nodes.find(n=>n.id==='s3').y,'Chronology preserves the order of submissions');
 projections.push({mode,tier,nodes:projected.nodes.length,edges:projected.edges.length});
}
console.log(JSON.stringify({passed:true,englishAnnotations:true,rawEventsPreserved:556,configurationInOverview:true,projections}));
