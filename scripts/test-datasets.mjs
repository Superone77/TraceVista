import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../viewer/src/trajectory/dataset.ts',import.meta.url),'utf8'));
const {datasetRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const catalog=JSON.parse(readFileSync(new URL('../viewer/public/examples/index.json',import.meta.url),'utf8'));
assert.equal(new Set(catalog.map(x=>x.id)).size,catalog.length);
for(const d of catalog){
 const url=datasetRequest('?example='+d.id,catalog,'./');
 assert.equal(url,'./examples/'+d.file);
 const graph=JSON.parse(readFileSync(new URL('../viewer/public/'+url,import.meta.url),'utf8'));
 assert.equal(graph.format,'coding-agent-state-trajectory');
}
assert.equal(datasetRequest('?example=pi-infra-r1',catalog,'/nested/'),'/nested/examples/pi-infra-r1.agent-state.json');
assert.equal(datasetRequest('?data=my-run',catalog),'./local-data/my-run.json');
assert.equal(datasetRequest('',catalog),null);
assert.equal(datasetRequest('?example=1',catalog),'./examples/pi-infra-r1.agent-state.json');
assert.deepEqual(catalog.map(d => d.id), ['pi-infra-r1'], 'Only the approved Pi example ships');
for(const s of ['?example=missing','?data=../auth','?data=https://example.com','?data=','?data=%2Fetc%2Fpasswd'])assert.throws(()=>datasetRequest(s,catalog));
assert.throws(()=>datasetRequest('?example=x',[{id:'x',file:'../private.json'}]));
console.log('PASS: bundled examples, relative base path, local import route and invalid paths');
