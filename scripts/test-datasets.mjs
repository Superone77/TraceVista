import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
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
assert.equal(datasetRequest('?example=pi-agent-lora',catalog,'/nested/'),'/nested/examples/pi-agent-lora.agent-state.json');
assert.equal(datasetRequest('?example=posttrainbench-fable5-aime',catalog,'/nested/'),'/nested/examples/posttrainbench-fable5-aime.agent-state.json');
assert.equal(datasetRequest('?data=my-run',catalog),'./local-data/my-run.json');
assert.equal(datasetRequest('',catalog),null);
assert.equal(datasetRequest('?example=1',catalog),'./examples/pi-agent-lora.agent-state.json');
assert.throws(()=>datasetRequest('?example=1',[]));
assert.deepEqual(catalog.map(d => d.id), ['pi-agent-lora','posttrainbench-fable5-aime','inferencebench-serving-recovery','swe-rebench-kafka-retry','literesearcher-affiliations'], 'Only the five approved examples ship, with Pi Agent first');
assert.deepEqual(readdirSync(new URL('../viewer/public/examples/',import.meta.url)).sort(),
 ['index.json',...catalog.map(d=>d.file)].sort(), 'No unlisted files may ship with the public examples');
assert.throws(()=>datasetRequest('?example=kda-w8a16-r1',catalog), 'The replaced KDA example is not served');
assert.throws(()=>datasetRequest('?example=pi-infra-r1',catalog), 'The former Pi Infra slug is not served');
for(const s of ['?example=missing','?data=../auth','?data=https://example.com','?data=','?data=%2Fetc%2Fpasswd'])assert.throws(()=>datasetRequest(s,catalog));
assert.throws(()=>datasetRequest('?example=x',[{id:'x',file:'../private.json'}]));
console.log('PASS: bundled examples, relative base path, local import route and invalid paths');
