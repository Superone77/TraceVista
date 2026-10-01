import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
async function mod(p){return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync(new URL(p,root),'utf8'))).toString('base64'));}
const {parseGraph,stateVisual,observationsFor}=await mod('viewer/src/trajectory/model.ts');
const {layoutGraph,semanticProjection,recordsForAction}=await mod('viewer/src/trajectory/semantic.ts');
const original=JSON.parse(readFileSync(new URL('viewer/public/examples/pi-infra-r1.agent-state.json',root),'utf8'));
const g=parseGraph(original);
assert.equal(g.states.find(s=>s.id==='s4').lineage.parent,'s2');
assert.equal(stateVisual(g.states.find(s=>s.id==='s3')).label,'测量值退化');
assert.equal(stateVisual(g.states.find(s=>s.id==='s4')).label,'测量值改善');
assert.equal(stateVisual(g.states.find(s=>s.id==='s5')).delta,null);
const projections=[];
for(const mode of ['lineage','chronology']) for(const tier of ['states','branches','actions','raw']){
 const l=layoutGraph(g,tier,mode),p=semanticProjection(g,l,tier);
 assert(l.nodes.every(n=>[n.x,n.y,n.width,n.height].every(Number.isFinite)));
 if(mode==='lineage')assert.equal(l.nodes.find(n=>n.id==='s3').y,l.nodes.find(n=>n.id==='s4').y);
 else assert(l.nodes.find(n=>n.id==='s4').y>l.nodes.find(n=>n.id==='s3').y);
 for(const e of p.edges)assert(p.nodes.some(n=>n.id===e.source)&&p.nodes.some(n=>n.id===e.target));
 projections.push({mode,tier,nodes:p.nodes.length,edges:p.edges.length});
}
assert.equal(g.actions.flatMap(a=>recordsForAction(g,a)).filter(e=>e.kind==='call').length,150);
assert.equal(g.timeline.timeline.filter(e=>e.session_id==='main').length,549);
// The sole shipped Pi artifact is self-contained: each classified event resolves
// to retained source evidence, and parsing does not mutate any raw text.
assert.deepEqual(g.timeline,original.timeline);
assert(g.timeline.sources.some(s=>s.name==='session.jsonl'&&s.text.includes('"type":"session"')));
const raw=new Set(g.timeline.timeline.map(e=>e.id));
for(const a of g.actions)for(const id of a.events)assert(raw.has(id));
assert(!g.observations.some(o=>o.kind==='skill'||o.kind==='review'));
assert(observationsFor(g,'a505').some(o=>o.kind==='measurement'&&o.facts.value===35.44498));
assert.equal(JSON.stringify(g.timeline.sources),JSON.stringify(original.timeline.sources));
const report={passed:true,raw_texts_unchanged:549,self_contained_sources:true,tool_calls:150,coverage:g.coverage,projections,
 verified:['v4 derives from v2','v3 regression color','v4 improvement color','final not a new dev measurement','submit action has score evidence','no fabricated skill or review']};
console.log(JSON.stringify(report));
