import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../viewer/src/trajectory/dataset.ts',import.meta.url),'utf8'));
const {datasetRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
// Routing is a core contract. Full catalog and export validation lives in test:examples.
const catalog=[
 {id:'first-run',title:'First fixture',file:'first-run.agent-state.json',description:'A small route fixture'},
 {id:'second-run',title:'Second fixture',file:'second-run.agent-state.json',description:'Another route fixture'},
];
for(const d of catalog){
 const url=datasetRequest('?example='+d.id,catalog,'./');
 assert.equal(url,'./examples/'+d.file);
}
assert.equal(datasetRequest('?example=first-run',catalog,'/nested/'),'/nested/examples/first-run.agent-state.json');
assert.equal(datasetRequest('?example=second-run',catalog,'/nested/'),'/nested/examples/second-run.agent-state.json');
assert.equal(datasetRequest('?data=my-run',catalog),'./local-data/my-run.json');
assert.equal(datasetRequest('',catalog),null);
assert.equal(datasetRequest('?example=1',catalog),'./examples/first-run.agent-state.json');
assert.throws(()=>datasetRequest('?example=1',[]));
assert.equal(datasetRequest('?demo=1',[],'/nested/'),'/nested/local-data/demo.thoughtdag.json');
for(const s of ['?example=missing','?data=../auth','?data=https://example.com','?data=','?data=%2Fetc%2Fpasswd'])assert.throws(()=>datasetRequest(s,catalog));
assert.throws(()=>datasetRequest('?example=x',[{id:'x',file:'../private.json'}]));
console.log('PASS: example routes, relative base path, local import route and invalid paths');
