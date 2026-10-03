import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
async function mod(p){return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync(new URL(p,root),'utf8'))).toString('base64'));}
const {parseGraph,stateVisual,observationsFor}=await mod('viewer/src/trajectory/model.ts');
const {layoutGraph,semanticProjection}=await mod('viewer/src/trajectory/semantic.ts');
const original=JSON.parse(readFileSync(new URL('viewer/public/examples/kda-w8a16-r1.agent-state.json',root),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Pinned to the already reviewed export before translating any analyst annotations.
assert.equal(hash(original.timeline.timeline),'e48e6a988cd7ba4d40bc39cad797b131a2d4f0c93be2cb9e6f1a4e7a9e2d7e6d','Raw events must remain unchanged');
assert.equal(hash(original.timeline.sources),'1e698aa5951b320d000de3f20626e1012b7c98418e1f670efd00feb9f2824b9d','Source archives must remain unchanged');
assert.equal(hash(original.artifacts),'dc6ef4ad0e991ff10425744254f165390440c49c8c23e7ec3888ab2008421ca9','Evidence attachments must remain unchanged');
assert.equal(original.language,'en');
function english(value,path=''){
 if(typeof value==='string') assert(!/[\u3400-\u9fff]/u.test(value),`Untranslated annotation: ${path}`);
 else if(Array.isArray(value)) value.forEach((v,i)=>english(v,`${path}[${i}]`));
 else if(value&&typeof value==='object') for(const [k,v] of Object.entries(value)){
  if(['timeline','artifacts','quote'].includes(k)) continue; // Verbatim evidence retains its source language.
  english(v,`${path}.${k}`);
 }
}
english(original);
const g=parseGraph(original);
assert.deepEqual([g.states.length,g.branches.length,g.actions.length],[8,25,99]);
assert.equal(g.states.find(s=>s.id==='s5').snapshot.product,g.states.find(s=>s.id==='s6').snapshot.product,'Submission 6 repeats the same code');
assert.equal(g.states.find(s=>s.id==='s7').lineage.parent,'s5');
assert.equal(stateVisual(g.states.find(s=>s.id==='s6')).label,'Measurement regressed');
assert.equal(stateVisual(g.states.find(s=>s.id==='s7')).delta,null,'Final selection is not a new measurement');
assert(observationsFor(g,'s7').some(o=>o.kind==='measurement'&&o.facts.scope==='independent_score'&&Math.abs(o.facts.value-2.2152048391234413)<1e-9));
assert(g.observations.some(o=>o.kind==='review'&&o.facts.stage==='feedback'&&o.facts.outcome==='revise'));
assert(g.observations.some(o=>o.kind==='skill'&&o.facts.load_method==='native_call'));
assert(g.observations.some(o=>o.kind==='skill'&&o.facts.load_method==='source_read'));
assert.deepEqual(g.timeline.sources,original.timeline.sources);
assert.deepEqual(g.timeline.timeline.map(e=>[e.id,e.text,e.call_id]),original.timeline.timeline.map(e=>[e.id,e.text,e.call_id]));
assert.deepEqual(['main','review1','review2','controller'].map(id=>g.timeline.timeline.filter(e=>e.session_id===id).length),[1919,21,42,20]);
const raw=new Set(g.timeline.timeline.map(e=>e.id));
for(const a of g.actions)for(const id of a.events)assert(raw.has(id));
const projections=[];
for(const mode of ['lineage','chronology'])for(const tier of ['states','branches','actions','raw']){
 const l=layoutGraph(g,tier,mode),p=semanticProjection(g,l,tier);
 assert(l.nodes.every(n=>[n.x,n.y,n.width,n.height].every(Number.isFinite)));
 if(mode==='lineage')assert.equal(l.nodes.find(n=>n.id==='s6').y,l.nodes.find(n=>n.id==='s7').y);
 else assert(l.nodes.find(n=>n.id==='s7').y>l.nodes.find(n=>n.id==='s6').y);
 for(const e of p.edges)assert(p.nodes.some(n=>n.id===e.source)&&p.nodes.some(n=>n.id===e.target));
 projections.push({mode,tier,nodes:p.nodes.length,edges:p.edges.length});
}
console.log(JSON.stringify({passed:true,englishAnnotations:true,rawEventsPreserved:2002,projections}));
